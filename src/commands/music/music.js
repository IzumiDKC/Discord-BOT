const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QueueRepeatMode } = require('discord-player');

const NORMALIZATION_FILTERS = ['normalizer2', 'softlimiter'];

function trackTitle(track) {
  return track?.cleanTitle || track?.title || 'Unknown track';
}

function trackLine(track, index) {
  const title = trackTitle(track);
  const duration = track.duration || 'Unknown';
  return `\`${String(index + 1).padStart(2, '0')}\` [${title}](${track.url}) - \`${duration}\``;
}

function loopLabel(queue) {
  return queue.repeatMode === QueueRepeatMode.TRACK ? 'Track' : 'Off';
}

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
    .setDescription('Control music playback')
    .addSubcommand(s => s.setName('skip').setDescription('Skip the current track'))
    .addSubcommand(s => s.setName('stop').setDescription('Stop playback and clear the queue'))
    .addSubcommand(s => s.setName('pause').setDescription('Pause playback'))
    .addSubcommand(s => s.setName('resume').setDescription('Resume playback'))
    .addSubcommand(s => s.setName('loop').setDescription('Toggle repeat for the current track'))
    .addSubcommand(s =>
      s.setName('normalize')
        .setDescription('Toggle loudness normalization')
        .addBooleanOption(o =>
          o.setName('enabled').setDescription('Enable or disable loudness normalization')
        )
    )
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

      case 'normalize': {
        const option = interaction.options.getBoolean('enabled');
        const enabled = option ?? !isNormalizationEnabled(queue);
        await interaction.deferReply();
        await setNormalization(queue, enabled);
        return interaction.editReply(enabled
          ? 'Loudness normalization is now enabled.'
          : 'Loudness normalization is now disabled.');
      }

      case 'queue': {
        const tracks = queue.tracks.toArray();
        const current = queue.currentTrack;
        const list = tracks
          .slice(0, 10)
          .map(trackLine)
          .join('\n') || '_No tracks queued. Add one with `/play`._';

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setAuthor({ name: 'Music Queue' })
          .setTitle(current ? trackTitle(current) : 'Nothing playing')
          .setDescription(current ? `[Open track](${current.url})` : '_Nothing is playing right now._')
          .addFields(
            { name: 'Duration', value: current?.duration || 'Unknown', inline: true },
            { name: 'Volume', value: `${queue.node.volume}%`, inline: true },
            { name: 'Loop', value: loopLabel(queue), inline: true },
            { name: 'Normalize', value: isNormalizationEnabled(queue) ? 'On' : 'Off', inline: true },
            { name: `Up next (${tracks.length})`, value: list, inline: false },
          )
          .setFooter({ text: tracks.length > 10 ? `Showing 10 of ${tracks.length} queued tracks` : 'Use /music skip, pause, resume, volume, or stop' })
          .setThumbnail(current?.thumbnail || null);

        return interaction.reply({ embeds: [embed] });
      }

      case 'nowplaying': {
        const track = queue.currentTrack;
        if (!track) return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });

        const timestamp = queue.node.getTimestamp();
        const progress = queue.node.createProgressBar({ length: 14 }) || '';
        const embed = new EmbedBuilder()
          .setColor(0x1DB954)
          .setAuthor({ name: 'Now Playing' })
          .setTitle(trackTitle(track))
          .setURL(track.url)
          .addFields(
            { name: 'Progress', value: timestamp ? `${progress}\n${timestamp.current.label} / ${timestamp.total.label}` : 'Unknown', inline: false },
            { name: 'Volume', value: `${queue.node.volume}%`, inline: true },
            { name: 'Requested by', value: track.requestedBy?.username || '?', inline: true },
            { name: 'Loop', value: loopLabel(queue), inline: true },
            { name: 'Normalize', value: isNormalizationEnabled(queue) ? 'On' : 'Off', inline: true },
          )
          .setFooter({ text: `${track.source || 'unknown'} source` })
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
