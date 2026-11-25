const { QueryType } = require('discord-player');
const { prepareMusicInput } = require('./musicSource');
const { rankSearchTracks } = require('./musicMatcher');
const {
  preloadSmartMatches,
  resolveDirectUrlTrack,
  resolveYoutubePlaylistTracks,
  resolveYoutubeVideoTrack,
  smartMusicBridge,
} = require('./smartMusicBridge');
const { filtersForPreset, getAudioPreset } = require('./musicAudio');

const DEFAULT_MUSIC_VOLUME = 55;

function shuffleTracks(tracks) {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function resolvePlayableQuery(client, resolvedInput, requester) {
  if (resolvedInput.unsupportedUrl) {
    throw new Error(`Unsupported or invalid music URL: ${resolvedInput.query}`);
  }

  const hasLiveExtractors = typeof client.player.extractors?.resolve === 'function';
  if (!hasLiveExtractors) return resolvedInput.query;

  if (resolvedInput.platform === 'youtube' && resolvedInput.videoId && resolvedInput.collectionType === 'track') {
    return resolveYoutubeVideoTrack(resolvedInput.videoId, client.player, requester);
  }

  if (resolvedInput.platform === 'youtube' && resolvedInput.collectionType === 'playlist' && typeof client.player.search === 'function') {
    const searchResult = await client.player.search(resolvedInput.query, {
      requestedBy: requester,
      searchEngine: QueryType.YOUTUBE_PLAYLIST,
    }).catch(() => null);
    if (searchResult?.hasTracks?.()) return searchResult;
    return resolveYoutubePlaylistTracks(resolvedInput.query, client.player, requester);
  }

  if (resolvedInput.platform === 'direct') {
    return resolveDirectUrlTrack(resolvedInput.query, client.player, requester);
  }

  if (resolvedInput.isUrl && resolvedInput.directAudio && typeof client.player.search === 'function') {
    const searchResult = await client.player.search(resolvedInput.query, {
      requestedBy: requester,
      searchEngine: resolvedInput.searchEngine,
    }).catch(() => null);
    if (searchResult?.hasTracks?.()) return searchResult;
    return resolveDirectUrlTrack(resolvedInput.query, client.player, requester);
  }

  return resolvedInput.query;
}

async function playMusicRequest({ client, voiceChannel, textChannel, requester, query, shouldShuffle = false }) {
  const resolvedInput = await prepareMusicInput(query);
  const playableQuery = await resolvePlayableQuery(client, resolvedInput, requester);
  const existingQueue = client.player.nodes.get(voiceChannel.guild.id);
  const audioPreset = getAudioPreset(existingQueue);

  const playOptions = {
    requestedBy: requester,
    searchEngine: resolvedInput.searchEngine,
    ...(resolvedInput.isUrl ? {} : { fallbackSearchEngine: QueryType.YOUTUBE_SEARCH }),
    afterSearch: async result => {
      if (!resolvedInput.isUrl && resolvedInput.collectionType === 'search' && result.tracks.length > 1) {
        result.setTracks(rankSearchTracks(resolvedInput.query, result.tracks));
      }

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
        audioPreset,
      },
      selfDeaf: false,
      volume: DEFAULT_MUSIC_VOLUME,
      defaultFFmpegFilters: filtersForPreset(audioPreset),
      leaveOnEmpty: true,
      leaveOnEmptyCooldown: 60_000,
      leaveOnEnd: false,
      leaveOnStop: true,
      leaveOnStopCooldown: 10_000,
      bufferingTimeout: 1_000,
      disableFallbackStream: true,
      onBeforeCreateStream: smartMusicBridge,
      preferBridgedMetadata: true,
    },
  };

  const playResult = await client.player.play(voiceChannel, playableQuery, playOptions);

  const queue = client.player.nodes.get(voiceChannel.guild.id);
  if (queue) {
    try {
      queue.setMetadata({
        ...queue.metadata,
        channel: textChannel,
        requestedBy: requester,
        audioPreset: getAudioPreset(queue),
      });
    } catch (error) {
      console.warn('[Music Request] Metadata update failed:', error.message);
    }
  }

  return { ...playResult, resolvedInput };
}

module.exports = { playMusicRequest };
