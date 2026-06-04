const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QueueRepeatMode } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Dieu khien nhac')
    .addSubcommand(s => s.setName('skip').setDescription('Bo qua bai hien tai'))
    .addSubcommand(s => s.setName('stop').setDescription('Dung va xoa hang cho'))
    .addSubcommand(s => s.setName('pause').setDescription('Tam dung'))
    .addSubcommand(s => s.setName('resume').setDescription('Tiep tuc phat'))
    .addSubcommand(s => s.setName('loop').setDescription('Bat/tat lap lai bai hien tai'))
    .addSubcommand(s => s.setName('queue').setDescription('Xem hang cho'))
    .addSubcommand(s => s.setName('nowplaying').setDescription('Xem bai dang phat'))
    .addSubcommand(s =>
      s.setName('volume')
        .setDescription('Chinh am luong (0-100)')
        .addIntegerOption(o =>
          o.setName('level').setDescription('Muc am luong').setRequired(true).setMinValue(0).setMaxValue(100)
        )
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const queue = client.player.nodes.get(interaction.guildId);

    if (!queue || (!queue.currentTrack && queue.isEmpty())) {
      return interaction.reply({ content: 'Khong co nhac nao dang phat.', ephemeral: true });
    }

    switch (sub) {
      case 'skip': {
        const skipped = queue.node.skip();
        return interaction.reply(skipped ? 'Da bo qua bai hien tai.' : 'Khong the skip luc nay.');
      }

      case 'stop':
        queue.delete();
        return interaction.reply('Da dung nhac va xoa hang cho.');

      case 'pause': {
        const paused = queue.node.pause();
        return interaction.reply(paused ? 'Da tam dung.' : 'Khong the tam dung luc nay.');
      }

      case 'resume': {
        const resumed = queue.node.resume();
        return interaction.reply(resumed ? 'Tiep tuc phat.' : 'Khong the tiep tuc luc nay.');
      }

      case 'loop': {
        const nextMode = queue.repeatMode === QueueRepeatMode.TRACK
          ? QueueRepeatMode.OFF
          : QueueRepeatMode.TRACK;
        queue.setRepeatMode(nextMode);
        return interaction.reply(nextMode === QueueRepeatMode.TRACK ? 'Da bat lap lai bai hien tai.' : 'Da tat lap lai.');
      }

      case 'queue': {
        const tracks = queue.tracks.toArray();
        const list = tracks
          .slice(0, 10)
          .map((t, i) => `\`${i + 1}.\` ${t.cleanTitle || t.title} - \`${t.duration || 'Khong ro'}\``)
          .join('\n') || '_Khong co bai nao_';

        const current = queue.currentTrack;
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Hang cho nhac')
          .addFields(
            { name: 'Dang phat', value: current ? `${current.cleanTitle || current.title}` : '_Khong co_', inline: false },
            { name: `Tiep theo (${tracks.length} bai)`, value: list, inline: false },
          );

        return interaction.reply({ embeds: [embed] });
      }

      case 'nowplaying': {
        const track = queue.currentTrack;
        if (!track) return interaction.reply({ content: 'Khong co gi dang phat.', ephemeral: true });

        const timestamp = queue.node.getTimestamp();
        const progress = queue.node.createProgressBar({ length: 14 }) || '';
        const embed = new EmbedBuilder()
          .setColor(0x1DB954)
          .setTitle('Dang phat')
          .setDescription(`**[${track.cleanTitle || track.title}](${track.url})**`)
          .addFields(
            { name: 'Tien do', value: timestamp ? `${progress}\n${timestamp.current.label} / ${timestamp.total.label}` : 'Khong ro', inline: false },
            { name: 'Yeu cau boi', value: track.requestedBy?.username || '?', inline: true },
            { name: 'Loop', value: queue.repeatMode === QueueRepeatMode.TRACK ? 'Bat' : 'Tat', inline: true },
          )
          .setThumbnail(track.thumbnail || null);

        return interaction.reply({ embeds: [embed] });
      }

      case 'volume': {
        const level = interaction.options.getInteger('level', true);
        queue.node.setVolume(level);
        return interaction.reply(`Am luong: ${level}%`);
      }
    }
  },
};
