const { SlashCommandBuilder } = require('discord.js');
const { QueueRepeatMode } = require('discord-player');
const { alternativesMenu, musicControls, nowPlayingEmbed, queueEmbed } = require('../../utils/musicUi');
const { AUDIO_PRESETS, getAudioPreset, setAudioPreset } = require('../../utils/musicAudio');
const { getMusicHealth } = require('../../utils/musicHealth');
const { findAlternateTracks } = require('../../utils/smartMusicBridge');
const { createAlternativeSession } = require('../../utils/musicAlternatives');

function replyWithPreset(interaction, queue, preset) {
  setAudioPreset(queue, preset);
  const label = preset === AUDIO_PRESETS.BALANCED ? 'Balanced' : 'Natural';
  return interaction.reply(`Sound preset: **${label}**. It takes effect on the next track; the current track keeps playing.`);
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
    .addSubcommand(s =>
      s.setName('preset')
        .setDescription('Choose the sound preset for upcoming tracks')
        .addStringOption(o => o.setName('mode')
          .setDescription('Natural keeps the source sound; Balanced evens out volume')
          .setRequired(true)
          .addChoices(
            { name: 'Natural', value: AUDIO_PRESETS.NATURAL },
            { name: 'Balanced', value: AUDIO_PRESETS.BALANCED }
          ))
    )
    .addSubcommand(s => s.setName('queue').setDescription('Xem hàng chờ nhạc'))
    .addSubcommand(s => s.setName('nowplaying').setDescription('Xem bài đang phát'))
    .addSubcommand(s => s.setName('health').setDescription('Check voice ping and recent audio underruns'))
    .addSubcommand(s => s.setName('alternatives').setDescription('Choose a different YouTube audio version of the current track'))
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

    const readOnlySubcommands = new Set(['queue', 'nowplaying', 'health']);
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
        client.smartDj.stop(interaction.guildId);
        await client.musicLibrary.clearQueue(interaction.guildId)
          .catch(error => console.error('[Music Library]', error));
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
        const enabled = option ?? getAudioPreset(queue) !== AUDIO_PRESETS.BALANCED;
        return replyWithPreset(interaction, queue, enabled ? AUDIO_PRESETS.BALANCED : AUDIO_PRESETS.NATURAL);
      }

      case 'preset': {
        const preset = interaction.options.getString('mode', true);
        return replyWithPreset(interaction, queue, preset);
      }

      case 'queue': {
        return interaction.reply({
          embeds: [queueEmbed(queue)],
          components: musicControls(),
        });
      }

      case 'nowplaying': {
        const track = queue.currentTrack;
        if (!track) return interaction.reply({ content: 'Hiện không có bài nào đang phát.', ephemeral: true });

        return interaction.reply({ embeds: [nowPlayingEmbed(queue, track)], components: musicControls() });
      }

      case 'health': {
        const health = getMusicHealth(queue);
        if (!health) return interaction.reply({ content: 'Audio monitoring is starting. Try again shortly.', ephemeral: true });
        const ping = value => value === null ? 'n/a' : `${value} ms`;
        return interaction.reply({
          content: `Audio: **${health.status}** (${health.source})\n`
            + `Voice ping: UDP **${ping(health.udpPingMs)}**, WS **${ping(health.wsPingMs)}**\n`
            + `Last 30s: **${health.underrunStreaks}** underrun streaks, `
            + `max **${health.maxMissedFrames}** missed frames, `
            + `event-loop lag **${health.maxEventLoopLagMs} ms**`,
          ephemeral: true,
        });
      }

      case 'alternatives': {
        await interaction.deferReply({ ephemeral: true });
        const currentTrack = queue.currentTrack;
        if (!currentTrack) return interaction.editReply('No track is playing right now.');
        const candidates = await findAlternateTracks(currentTrack, client.player);
        if (queue.currentTrack !== currentTrack) return interaction.editReply('The playing track changed. Run this command again.');
        if (!candidates.length) return interaction.editReply('No alternate audio versions were found.');
        const sessionId = createAlternativeSession({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          currentTrack,
          candidates,
        });
        return interaction.editReply({
          content: `Choose a replacement for **${currentTrack.cleanTitle || currentTrack.title}**. This menu expires in 2 minutes.`,
          components: alternativesMenu(sessionId, candidates),
          allowedMentions: { parse: [] },
        });
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
