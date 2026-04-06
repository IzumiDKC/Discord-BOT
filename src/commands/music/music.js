const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { queues } = require('../../utils/musicQueue');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Điều khiển nhạc')
    .addSubcommand(s => s.setName('skip').setDescription('Bỏ qua bài hiện tại'))
    .addSubcommand(s => s.setName('stop').setDescription('Dừng và xóa hàng chờ'))
    .addSubcommand(s => s.setName('pause').setDescription('Tạm dừng'))
    .addSubcommand(s => s.setName('resume').setDescription('Tiếp tục phát'))
    .addSubcommand(s => s.setName('loop').setDescription('Bật/tắt lặp lại'))
    .addSubcommand(s => s.setName('queue').setDescription('Xem hàng chờ'))
    .addSubcommand(s => s.setName('nowplaying').setDescription('Xem bài đang phát'))
    .addSubcommand(s =>
      s.setName('volume')
        .setDescription('Chỉnh âm lượng (0-100)')
        .addIntegerOption(o =>
          o.setName('level').setDescription('Mức âm lượng').setRequired(true).setMinValue(0).setMaxValue(100)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const queue = queues.get(interaction.guildId);

    if (!queue) {
      return interaction.reply({ content: '❌ Không có nhạc nào đang phát.', ephemeral: true });
    }

    switch (sub) {
      case 'skip':
        queue.skip();
        return interaction.reply('⏭️ Đã bỏ qua bài hiện tại.');

      case 'stop':
        queue.stop();
        return interaction.reply('⏹️ Đã dừng nhạc và xóa hàng chờ.');

      case 'pause':
        queue.pause();
        return interaction.reply('⏸️ Đã tạm dừng.');

      case 'resume':
        queue.resume();
        return interaction.reply('▶️ Tiếp tục phát.');

      case 'loop':
        queue.loop = !queue.loop;
        return interaction.reply(queue.loop ? '🔁 Bật lặp lại.' : '➡️ Tắt lặp lại.');

      case 'queue': {
        const list = queue.tracks
          .slice(0, 10)
          .map((t, i) => `\`${i + 1}.\` ${t.title} — \`${t.durationString}\``)
          .join('\n') || '_Không có bài nào_';

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📋 Hàng chờ nhạc')
          .addFields(
            { name: '▶️ Đang phát', value: queue.current ? `${queue.current.title}` : '_Không có_' },
            { name: `Tiếp theo (${queue.tracks.length} bài)`, value: list },
          );
        return interaction.reply({ embeds: [embed] });
      }

      case 'nowplaying': {
        if (!queue.current) return interaction.reply({ content: '❌ Không có gì đang phát.', ephemeral: true });
        const t = queue.current;
        const embed = new EmbedBuilder()
          .setColor(0x1DB954)
          .setTitle('🎵 Đang phát')
          .setDescription(`**[${t.title}](${t.url})**`)
          .addFields(
            { name: 'Thời lượng', value: t.durationString, inline: true },
            { name: 'Yêu cầu bởi', value: t.requester || '?', inline: true },
            { name: 'Loop', value: queue.loop ? '🔁 Bật' : '➡️ Tắt', inline: true },
          )
          .setThumbnail(t.thumbnail || null);
        return interaction.reply({ embeds: [embed] });
      }

      case 'volume': {
        const level = interaction.options.getInteger('level');
        return interaction.reply(`🔊 Âm lượng: chức năng sẽ có ở bài kế tiếp sau khi thêm vào queue.`);
      }
    }
  },
};

