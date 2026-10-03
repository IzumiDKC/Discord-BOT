const { QueryType } = require('discord-player');
const { resolveMusicInput } = require('./musicSource');
const { preloadSmartMatches, smartMusicBridge } = require('./smartMusicBridge');

const DEFAULT_MUSIC_VOLUME = 55;
const NORMALIZATION_FILTERS = ['normalizer2', 'softlimiter'];

function shuffleTracks(tracks) {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function playMusicRequest({ client, voiceChannel, textChannel, requester, query, shouldShuffle = false }) {
  const resolvedInput = resolveMusicInput(query);
  const playResult = await client.player.play(voiceChannel, resolvedInput.query, {
    requestedBy: requester,
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
      if (result.playlist) result.playlist.tracks = shuffledTracks;
      return result;
    },
    nodeOptions: {
      metadata: {
        channel: textChannel,
        requestedBy: requester,
        normalizationEnabled: true,
      },
      selfDeaf: false,
      volume: DEFAULT_MUSIC_VOLUME,
      defaultFFmpegFilters: NORMALIZATION_FILTERS,
      leaveOnEmpty: true,
      leaveOnEmptyCooldown: 60_000,
      leaveOnEnd: false,
      leaveOnStop: true,
      leaveOnStopCooldown: 10_000,
      bufferingTimeout: 30_000,
      onBeforeCreateStream: smartMusicBridge,
      preferBridgedMetadata: true,
    },
  });

  const queue = client.player.nodes.get(voiceChannel.guild.id);
  if (queue) {
    try {
      queue.setMetadata({
        channel: textChannel,
        requestedBy: requester,
        normalizationEnabled: queue.metadata?.normalizationEnabled ?? true,
      });
    } catch (error) {
      console.warn('[Music Request] Metadata update failed:', error.message);
    }
  }

  return { ...playResult, resolvedInput };
}

module.exports = { playMusicRequest };
