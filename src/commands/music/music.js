const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QueueRepeatMode } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Control music playback')
    .addSubcommand(s => s.setName('skip').setDescription('Skip the current track'))
    .addSubcommand(s => s.setName('stop').setDescription('Stop playback and clear the queue'))
    .addSubcommand(s => s.setName('pause').setDescription('Pause playback'))
    .addSubcommand(s => s.setName('resume').setDescription('Resume playback'))
    .addSubcommand(s => s.setName('loop').setDescription('Toggle repeat for the current track'))
    .addSubcommand(s => s.setName('queue').setDescription('Show the music queue'))
    .addSubcommand(s => s.setName('nowplaying').setDescription('Show the current track'))
    .addSubcommand(s =>
      s.setName('volume')
        .setDescription('Set the volume (0-100)')
        .addIntegerOption(o =>
          o.setName('level').setDescription('Volume level').setRequired(true).setMinValue(0).setMaxValue(100)
        )
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const queue = client.player.nodes.get(interaction.guildId);

    if (!queue || (!queue.currentTrack && queue.isEmpty())) {
      return interaction.reply({ content: 'There is no music playing right now.', ephemeral: true });
    }

    switch (sub) {
      case 'skip': {
        const skipped = queue.node.skip();
        return interaction.reply(skipped ? 'Skipped the current track.' : 'Unable to skip right now.');
      }

      case 'stop':
        queue.delete();
        return interaction.reply('Stopped playback and cleared the queue.');

      case 'pause': {
        const paused = queue.node.pause();
        return interaction.reply(paused ? 'Playback paused.' : 'Unable to pause right now.');
      }

      case 'resume': {
        const resumed = queue.node.resume();
        return interaction.reply(resumed ? 'Playback resumed.' : 'Unable to resume right now.');
      }

      case 'loop': {
        const nextMode = queue.repeatMode === QueueRepeatMode.TRACK
          ? QueueRepeatMode.OFF
          : QueueRepeatMode.TRACK;
        queue.setRepeatMode(nextMode);
        return interaction.reply(nextMode === QueueRepeatMode.TRACK ? 'Current track repeat is now enabled.' : 'Current track repeat is now disabled.');
      }

      case 'queue': {
        const tracks = queue.tracks.toArray();
        const list = tracks
          .slice(0, 10)
          .map((t, i) => `\`${i + 1}.\` ${t.cleanTitle || t.title} - \`${t.duration || 'Unknown'}\``)
          .join('\n') || '_No tracks queued_';

        const current = queue.currentTrack;
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Music queue')
          .addFields(
            { name: 'Now playing', value: current ? `${current.cleanTitle || current.title}` : '_Nothing_', inline: false },
            { name: `Up next (${tracks.length} tracks)`, value: list, inline: false },
          );

        return interaction.reply({ embeds: [embed] });
      }

      case 'nowplaying': {
        const track = queue.currentTrack;
        if (!track) return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });

        const timestamp = queue.node.getTimestamp();
        const progress = queue.node.createProgressBar({ length: 14 }) || '';
        const embed = new EmbedBuilder()
          .setColor(0x1DB954)
          .setTitle('Now playing')
          .setDescription(`**[${track.cleanTitle || track.title}](${track.url})**`)
          .addFields(
            { name: 'Progress', value: timestamp ? `${progress}\n${timestamp.current.label} / ${timestamp.total.label}` : 'Unknown', inline: false },
            { name: 'Requested by', value: track.requestedBy?.username || '?', inline: true },
            { name: 'Loop', value: queue.repeatMode === QueueRepeatMode.TRACK ? 'On' : 'Off', inline: true },
          )
          .setThumbnail(track.thumbnail || null);

        return interaction.reply({ embeds: [embed] });
      }

      case 'volume': {
        const level = interaction.options.getInteger('level', true);
        queue.node.setVolume(level);
        const warning = level > 75 ? ' Higher volume can cause clipping; 40-70% is usually cleaner.' : '';
        return interaction.reply(`Volume set to ${level}%.${warning}`);
      }
    }
  },
};
