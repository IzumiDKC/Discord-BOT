const youtubeDl = require('youtube-dl-exec');
const { QueryType, Track, Util } = require('discord-player');
const { YoutubeiExtractor } = require('discord-player-youtubei');
const { findBestCandidate, rankCandidates } = require('./musicMatcher');

const BRIDGED_SOURCES = new Set(['apple_music', 'spotify']);
const SEARCH_LIMIT = 15;
const SEARCH_TIMEOUT_MS = 20_000;
const matchCache = new Map();

function withTimeout(promise, timeoutMs, message, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function searchQuery(track) {
  const title = track.cleanTitle || track.title;
  return `${track.author || ''} - ${title} official audio`.trim();
}

function ytDlpTrack(player, extractor, requestedBy, entry) {
  const url = entry.webpage_url || entry.url || (entry.id
    ? `https://www.youtube.com/watch?v=${entry.id}`
    : null);
  if (!url) return null;

  const durationSeconds = Number(entry.duration) || 0;
  const track = new Track(player, {
    title: entry.title || 'Unknown title',
    cleanTitle: entry.title || 'Unknown title',
    author: entry.uploader || entry.channel || 'Unknown artist',
    url,
    duration: Util.buildTimeCode(Util.parseMS(durationSeconds * 1_000)),
    thumbnail: entry.thumbnail || entry.thumbnails?.at(-1)?.url || null,
    requestedBy,
    source: 'youtube',
    queryType: QueryType.YOUTUBE_VIDEO,
    engine: entry,
    metadata: {
      duration_ms: durationSeconds * 1_000,
      live: Boolean(entry.is_live),
    },
  });
  track.extractor = extractor;
  return track;
}

async function searchWithYoutubei(track, extractor) {
  const result = await withTimeout(
    extractor.handle(searchQuery(track), {
      requestedBy: track.requestedBy,
      type: QueryType.YOUTUBE_SEARCH,
    }),
    SEARCH_TIMEOUT_MS,
    'YouTube search timed out.'
  );
  return result.tracks || [];
}

async function searchWithYtDlp(track, player, extractor) {
  const process = youtubeDl.exec(`ytsearch${SEARCH_LIMIT}:${searchQuery(track)}`, {
    dumpSingleJson: true,
    flatPlaylist: true,
    noWarnings: true,
    playlistEnd: SEARCH_LIMIT,
    skipDownload: true,
  });
  const execution = await withTimeout(
    process,
    SEARCH_TIMEOUT_MS,
    'yt-dlp search timed out.',
    () => process.kill()
  );
  const result = typeof execution === 'string'
    ? JSON.parse(execution)
    : typeof execution?.stdout === 'string'
      ? JSON.parse(execution.stdout)
      : execution;

  return (result.entries || [])
    .map(entry => ytDlpTrack(player, extractor, track.requestedBy, entry))
    .filter(Boolean);
}

function logRanking(track, ranked) {
  const preview = ranked.slice(0, 3).map(match => ({
    score: match.score,
    title: match.candidate.title,
    author: match.candidate.author,
    durationDelta: match.durationDifferenceSeconds,
  }));
  console.log(`[Music Match] Candidates for "${track.title}" by ${track.author}:`, preview);
}

async function resolveBestTrack(track, player) {
  const extractor = player.extractors.resolve(YoutubeiExtractor.identifier);
  if (!extractor) throw new Error('YouTube extractor is unavailable for catalog track matching.');

  let candidates = [];
  try {
    candidates = await searchWithYtDlp(track, player, extractor);
  } catch (error) {
    console.warn('[Music Match] yt-dlp search failed, trying YouTubei:', error.message);
  }

  let match = findBestCandidate(track, candidates);
  if (!match) {
    try {
      const youtubeiCandidates = await searchWithYoutubei(track, extractor);
      candidates = [...candidates, ...youtubeiCandidates];
      match = findBestCandidate(track, candidates);
    } catch (error) {
      console.warn('[Music Match] YouTubei search failed:', error.message);
    }
  }

  const ranked = rankCandidates(track, candidates);
  logRanking(track, ranked);

  if (!match) {
    throw new Error(`No confident audio match for "${track.title}" by ${track.author}.`);
  }

  const bridgedTrack = match.candidate;
  return { bridgedTrack, extractor, score: match.score };
}

async function getCachedMatch(track, player) {
  const cacheKey = `${track.source}:${track.url}`;
  if (!matchCache.has(cacheKey)) {
    const pending = resolveBestTrack(track, player).catch(error => {
      matchCache.delete(cacheKey);
      throw error;
    });
    matchCache.set(cacheKey, pending);
  }
  return matchCache.get(cacheKey);
}

async function smartMusicBridge(track, _queryType, queue) {
  if (!BRIDGED_SOURCES.has(track.source)) return null;

  const { bridgedTrack, extractor, score } = await getCachedMatch(track, queue.player);
  track.bridgedTrack = bridgedTrack;
  track.bridgedExtractor = extractor;
  console.log(
    `[Music Match] ${track.source} -> youtube (${score}): `
    + `${track.title} -> ${bridgedTrack.title}`
  );

  return extractor.stream(bridgedTrack);
}

async function preloadSmartMatches(tracks, player, limit = 5) {
  const candidates = tracks
    .filter(track => BRIDGED_SOURCES.has(track.source))
    .slice(0, limit);

  for (let index = 0; index < candidates.length; index += 2) {
    const batch = candidates.slice(index, index + 2);
    await Promise.allSettled(batch.map(track => getCachedMatch(track, player)));
  }
}

function playbackSourceLabel(track) {
  if (track?.source === 'spotify') {
    return track.bridgedTrack
      ? 'Spotify catalog → matched YouTube audio'
      : 'Spotify catalog';
  }
  if (track?.source === 'apple_music') {
    return track.bridgedTrack
      ? 'Apple Music catalog → matched YouTube audio'
      : 'Apple Music catalog';
  }
  if (track?.source === 'soundcloud') return 'SoundCloud audio';
  if (track?.source === 'youtube') return 'YouTube audio';
  return `${track?.source || 'unknown'} audio`;
}

module.exports = {
  playbackSourceLabel,
  preloadSmartMatches,
  smartMusicBridge,
};
