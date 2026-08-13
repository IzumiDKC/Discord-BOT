const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QueryType } = require('discord-player');
const { platformLabel, resolveMusicInput } = require('../../utils/musicSource');
const { preloadSmartMatches, smartMusicBridge } = require('../../utils/smartMusicBridge');

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
        .setDescription('Song, playlist or album from YouTube, SoundCloud or Spotify')
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
    const resolvedInput = resolveMusicInput(query);
    const shouldShuffle = interaction.options.getBoolean('shuffle') ?? false;

    try {
      const { track, searchResult } = await client.player.play(voiceChannel, resolvedInput.query, {
        requestedBy: interaction.user,
        searchEngine: resolvedInput.searchEngine,
        fallbackSearchEngine: QueryType.YOUTUBE_SEARCH,
        afterSearch: async result => {
          if (result.tracks.length > 1) {
            void preloadSmartMatches(result.tracks, client.player).catch(error => {
              console.warn('[Music Match] Preload failed:', error.message);
            });
          }

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
          onBeforeCreateStream: smartMusicBridge,
          preferBridgedMetadata: true,
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

      const collection = searchResult?.playlist;
      const trackCount = searchResult?.tracks?.length || 1;
      const isCollection = Boolean(collection);
      const sourceName = platformLabel(resolvedInput.platform);
      const playbackDescription = resolvedInput.directAudio
        ? `Direct ${sourceName} audio`
        : `${sourceName} catalog; each track is matched to the closest playable YouTube audio`;
      const notice = resolvedInput.automaticMixRemoved
        ? 'YouTube auto-generated Mix parameters were ignored, so only the shared video was queued.'
        : null;

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: isCollection ? `${collection.type === 'album' ? 'Album' : 'Playlist'} Added${shouldShuffle ? ' (Shuffled)' : ''}` : 'Added to Queue' })
        .setTitle(isCollection ? collection.title : (track.cleanTitle || track.title))
        .setURL(isCollection ? collection.url : track.url)
        .addFields(
          { name: isCollection ? 'Tracks' : 'Duration', value: isCollection ? String(trackCount) : (track.duration || 'Unknown'), inline: true },
          { name: 'Catalog source', value: sourceName, inline: true },
          { name: 'Requested by', value: interaction.user.username, inline: true },
          { name: 'Playback route', value: playbackDescription, inline: false },
        )
        .setFooter({ text: notice || (shouldShuffle ? 'Playlist/list order was shuffled before adding' : 'Use /music queue to see what is coming up next') })
        .setThumbnail((isCollection ? collection.thumbnail : track.thumbnail) || null);

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/play Error]', err);
      return interaction.editReply('Could not find or play this track. Try another YouTube/SoundCloud link or a clearer song name.');
    }
  },
};
