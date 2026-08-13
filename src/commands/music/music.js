const { SlashCommandBuilder } = require('discord.js');
const { QueueRepeatMode } = require('discord-player');
const { musicControls, nowPlayingEmbed, queueEmbed } = require('../../utils/musicUi');

const NORMALIZATION_FILTERS = ['normalizer2', 'softlimiter'];

function isNormalizationEnabled(queue) {
  return NORMALIZATION_FILTERS.every(filter => queue.filters.ffmpeg.filters.includes(filter));
}

async function setNormalization(queue, enabled) {
  const currentFilters = queue.filters.ffmpeg.filters.filter(filter => !NORMALIZATION_FILTERS.includes(filter));
  const nextFilters = enabled ? [...currentFilters, ...NORMALIZATION_FILTERS] : currentFilters;
  await queue.filters.ffmpeg.setFilters(nextFilters);
  queue.setMetadata({
    ...queue.metadata,
    normalizationEnabled: enabled,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Điều khiển trình phát nhạc')
    .addSubcommand(s => s.setName('skip').setDescription('Chuyển sang bài tiếp theo'))
    .addSubcommand(s => s.setName('stop').setDescription('Dừng nhạc và xóa hàng chờ'))
    .addSubcommand(s => s.setName('pause').setDescription('Tạm dừng phát nhạc'))
    .addSubcommand(s => s.setName('resume').setDescription('Tiếp tục phát nhạc'))
    .addSubcommand(s => s.setName('loop').setDescription('Bật hoặc tắt lặp lại bài hiện tại'))
    .addSubcommand(s =>
      s.setName('shuffle')
        .setDescription('Bật hoặc tắt phát ngẫu nhiên')
        .addBooleanOption(o =>
          o.setName('enabled').setDescription('Bật hoặc tắt shuffle')
        )
    )
    .addSubcommand(s =>
      s.setName('normalize')
        .setDescription('Bật hoặc tắt cân bằng âm lượng')
        .addBooleanOption(o =>
          o.setName('enabled').setDescription('Bật hoặc tắt cân bằng âm lượng')
        )
    )
    .addSubcommand(s => s.setName('queue').setDescription('Xem hàng chờ nhạc'))
    .addSubcommand(s => s.setName('nowplaying').setDescription('Xem bài đang phát'))
    .addSubcommand(s =>
      s.setName('volume')
        .setDescription('Đặt âm lượng từ 0 đến 100')
        .addIntegerOption(o =>
          o.setName('level').setDescription('Mức âm lượng').setRequired(true).setMinValue(0).setMaxValue(100)
        )
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const queue = client.player.nodes.get(interaction.guildId);

    if (!queue || (!queue.currentTrack && queue.isEmpty())) {
      return interaction.reply({ content: '🌙 Hiện không có nhạc trong hàng chờ.', ephemeral: true });
    }

    const readOnlySubcommands = new Set(['queue', 'nowplaying']);
    if (!readOnlySubcommands.has(sub)) {
      const memberVoiceId = interaction.member.voice?.channelId;
      const botVoiceId = interaction.guild.members.me?.voice?.channelId;
      if (!memberVoiceId || (botVoiceId && memberVoiceId !== botVoiceId)) {
        return interaction.reply({
          content: '🎧 Bạn cần ở cùng kênh voice với Momoka để điều khiển nhạc.',
          ephemeral: true,
        });
      }
    }

    switch (sub) {
      case 'skip': {
        const skipped = queue.node.skip();
        return interaction.reply(skipped ? '⏭️ Đã chuyển bài.' : 'Không thể chuyển bài lúc này.');
      }

      case 'stop':
        queue.delete();
        return interaction.reply('⏹️ Đã dừng nhạc và xóa hàng chờ.');

      case 'pause': {
        const paused = queue.node.pause();
        return interaction.reply(paused ? '⏸️ Đã tạm dừng.' : 'Không thể tạm dừng lúc này.');
      }

      case 'resume': {
        const resumed = queue.node.resume();
        return interaction.reply(resumed ? '▶️ Đã tiếp tục phát.' : 'Không thể tiếp tục lúc này.');
      }

      case 'loop': {
        const nextMode = queue.repeatMode === QueueRepeatMode.TRACK
          ? QueueRepeatMode.OFF
          : QueueRepeatMode.TRACK;
        queue.setRepeatMode(nextMode);
        return interaction.reply(nextMode === QueueRepeatMode.TRACK ? '🔂 Đã bật lặp lại bài hiện tại.' : '➡️ Đã tắt lặp lại.');
      }

      case 'shuffle': {
        const option = interaction.options.getBoolean('enabled');
        const enabled = option ?? !queue.isShuffling;

        if (enabled) {
          queue.enableShuffle(true);
          const note = queue.tracks.size < 2 ? ' Hãy thêm vài bài nữa để shuffle có tác dụng.' : '';
          return interaction.reply(`🔀 Đã bật phát ngẫu nhiên.${note}`);
        }

        queue.disableShuffle();
        return interaction.reply('➡️ Đã tắt phát ngẫu nhiên.');
      }

      case 'normalize': {
        const option = interaction.options.getBoolean('enabled');
        const enabled = option ?? !isNormalizationEnabled(queue);
        await interaction.deferReply();
        await setNormalization(queue, enabled);
        return interaction.editReply(enabled
          ? '🎚️ Đã bật cân bằng âm lượng.'
          : '🎚️ Đã tắt cân bằng âm lượng.');
      }

      case 'queue': {
        return interaction.reply({
          embeds: [queueEmbed(queue, isNormalizationEnabled)],
          components: musicControls(),
        });
      }

      case 'nowplaying': {
        const track = queue.currentTrack;
        if (!track) return interaction.reply({ content: 'Hiện không có bài nào đang phát.', ephemeral: true });

        return interaction.reply({ embeds: [nowPlayingEmbed(queue, track)], components: musicControls() });
      }

      case 'volume': {
        const level = interaction.options.getInteger('level', true);
        queue.node.setVolume(level);
        const warning = level > 75 ? ' Âm lượng cao có thể gây vỡ tiếng; mức 40–70% thường nghe sạch hơn.' : '';
        return interaction.reply(`🔊 Đã đặt âm lượng **${level}%**.${warning}`);
      }
    }
  },
};
