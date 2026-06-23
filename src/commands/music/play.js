const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const DEFAULT_MUSIC_VOLUME = 55;
const MUSIC_BITRATE = 128_000;
const NORMALIZATION_FILTERS = ['normalizer2', 'softlimiter'];

function shuffleTracks(tracks) {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music from a song name or link')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Song name, YouTube link, SoundCloud link, Spotify link...')
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('shuffle')
        .setDescription('Shuffle playlist/list results before adding them')
    ),

  async execute(interaction, client) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: 'You need to join a voice channel first.', ephemeral: true });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query', true);
    const shouldShuffle = interaction.options.getBoolean('shuffle') ?? false;

    try {
      const { track, searchResult } = await client.player.play(voiceChannel, query, {
        requestedBy: interaction.user,
        afterSearch: async result => {
          if (!shouldShuffle || result.tracks.length < 2) return result;

          const shuffledTracks = shuffleTracks(result.tracks);
          result.setTracks(shuffledTracks);
          if (result.playlist) {
            result.playlist.tracks = shuffledTracks;
          }

          return result;
        },
        nodeOptions: {
          metadata: {
            channel: interaction.channel,
            requestedBy: interaction.user,
            normalizationEnabled: true,
          },
          selfDeaf: true,
          volume: DEFAULT_MUSIC_VOLUME,
          defaultFFmpegFilters: NORMALIZATION_FILTERS,
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 60_000,
          leaveOnEnd: true,
          leaveOnEndCooldown: 60_000,
          leaveOnStop: true,
          leaveOnStopCooldown: 10_000,
          bufferingTimeout: 30_000,
        },
      });

      const queue = client.player.nodes.get(interaction.guildId);
      if (queue) {
        queue.setMetadata({
          channel: interaction.channel,
          requestedBy: interaction.user,
          normalizationEnabled: queue.metadata?.normalizationEnabled ?? true,
        });
        queue.node.setBitrate(MUSIC_BITRATE);
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: searchResult?.playlist ? `Playlist Added${shouldShuffle ? ' (Shuffled)' : ''}` : 'Added to Queue' })
        .setTitle(track.cleanTitle || track.title)
        .setURL(track.url)
        .addFields(
          { name: 'Duration', value: track.duration || 'Unknown', inline: true },
          { name: 'Source', value: track.source || 'unknown', inline: true },
          { name: 'Requested by', value: interaction.user.username, inline: true },
        )
        .setFooter({ text: shouldShuffle ? 'Playlist/list order was shuffled before adding' : 'Use /music queue to see what is coming up next' })
        .setThumbnail(track.thumbnail || null);

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/play Error]', err);
      return interaction.editReply('Could not find or play this track. Try another YouTube/SoundCloud link or a clearer song name.');
    }
  },
};
