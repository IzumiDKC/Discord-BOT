const { PassThrough } = require('node:stream');
const youtubeDl = require('youtube-dl-exec');
const { Playlist, QueryType, Track, Util } = require('discord-player');
const { YoutubeiExtractor } = require('discord-player-youtubei');
const { findBestCandidate, rankCandidates } = require('./musicMatcher');
const { keyForSong } = require('./musicLibrary');
const { extractYoutubeVideoId, isSafePublicUrl } = require('./musicSource');

const BRIDGED_SOURCES = new Set(['apple_music', 'spotify']);
const SEARCH_LIMIT = 15;
const SEARCH_TIMEOUT_MS = 20_000;
const STREAM_STARTUP_TIMEOUT_MS = 20_000;
const MATCH_CACHE_MAX = 500;
const MATCH_CACHE_TTL_MS = 6 * 60 * 60_000;
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

function ytDlpBaseOptions() {
  return {
    jsRuntimes: 'node',
    noWarnings: true,
    ...(process.env.YOUTUBE_COOKIES_PATH ? { cookies: process.env.YOUTUBE_COOKIES_PATH } : {}),
  };
}

function parseYtDlpOutput(execution) {
  if (typeof execution === 'string') return JSON.parse(execution);
  if (typeof execution?.stdout === 'string') return JSON.parse(execution.stdout);
  return execution;
}

function trackArtists(track) {
  const rawArtists = track?.metadata?.source?.artists;
  if (Array.isArray(rawArtists) && rawArtists.length) {
    const names = rawArtists.map(a => a?.name || a).filter(Boolean).join(', ');
    if (names) return names;
  }
  return track?.author || '';
}

function searchQueries(track) {
  const title = (track.cleanTitle || track.title || '').trim();
  const author = trackArtists(track).trim();
  const isrc = track?.metadata?.source?.external_ids?.isrc || track?.metadata?.source?.isrc || track?.raw?.isrc;
  const queries = [];

  if (isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc)) {
    queries.push(`"${isrc}"`);
  }
  queries.push(`${author} - ${title} official audio`.trim());

  const strippedTitle = title
    .replace(/\s*[-–—]\s*(remaster(ed)?(\s+\d{4})?|single|version|edit).*$/i, '')
    .replace(/\s*\((feat\.?|ft\.?|with)\s+[^)]+\)/gi, '')
    .trim();
  if (strippedTitle && strippedTitle !== title) {
    queries.push(`${author} - ${strippedTitle}`.trim());
  }
  return [...new Set(queries.filter(Boolean))];
}

function ytDlpTrack(player, extractor, requestedBy, entry, overrides = {}) {
  const videoId = extractYoutubeVideoId(entry.webpage_url || entry.url || '')
    || (/^[A-Za-z0-9_-]{11}$/.test(entry.id || '') && (entry.ie_key?.toLowerCase?.().includes('youtube') || entry.extractor_key?.toLowerCase?.().includes('youtube') || overrides.source === 'youtube')
      ? entry.id
      : null);
  const rawUrl = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : entry.webpage_url || entry.url;
  const url = /^https?:\/\//i.test(rawUrl || '') ? rawUrl : null;
  if (!url || !isSafePublicUrl(url)) return null;

  const durationSeconds = Number(entry.duration) || 0;
  const isLive = Boolean(entry.is_live);
  const source = overrides.source || (videoId ? 'youtube' : 'direct');
  const queryType = overrides.queryType || (videoId ? QueryType.YOUTUBE_VIDEO : QueryType.AUTO);
  const author = entry.artist || entry.uploader || entry.channel || entry.creator || 'Unknown artist';
  const title = entry.track || entry.title || 'Unknown title';

  const track = new Track(player, {
    title,
    cleanTitle: title,
    author,
    url,
    duration: Util.buildTimeCode(Util.parseMS(durationSeconds * 1_000)),
    thumbnail: entry.thumbnail || entry.thumbnails?.at(-1)?.url || null,
    requestedBy,
    source,
    queryType,
    live: isLive,
    engine: entry,
    playlist: overrides.playlist || null,
    metadata: {
      duration_ms: durationSeconds * 1_000,
      live: isLive,
      directStream: source === 'direct',
    },
  });
  if (extractor) track.extractor = extractor;
  return track;
}

// Wait for first audio chunk from yt-dlp stdout so upstream 403/unavailable errors surface cleanly before playback starts.
async function createYoutubeDlStream(trackOrUrl) {
  const rawUrl = typeof trackOrUrl === 'string' ? trackOrUrl : trackOrUrl?.url;
  const videoId = extractYoutubeVideoId(rawUrl);
  const targetUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : rawUrl;
  if (!targetUrl || !isSafePublicUrl(targetUrl)) {
    throw new Error('Invalid or unsafe media stream URL.');
  }

  const isLive = Boolean(trackOrUrl?.live || trackOrUrl?.metadata?.live);
  const child = youtubeDl.exec(targetUrl, {
    ...ytDlpBaseOptions(),
    format: isLive ? 'best[height<=360]/best' : 'bestaudio[acodec=opus]/bestaudio/best',
    noPlaylist: true,
    noProgress: true,
    output: '-',
  });

  let stderrTail = '';
  child.stderr?.on('data', chunk => {
    stderrTail = (stderrTail + chunk.toString()).slice(-400);
  });
  child.catch(() => {});

  const stdout = child.stdout;
  if (!stdout) {
    try { child.kill(); } catch {}
    throw new Error('yt-dlp did not expose an audio stream.');
  }

  const output = new PassThrough({ highWaterMark: 1 << 20 });
  const killChild = () => {
    if (!child.killed) {
      try { child.kill(); } catch {}
    }
  };

  output.once('close', killChild);
  output.once('error', killChild);

  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killChild();
      reject(new Error('Audio stream timed out before first byte.'));
    }, STREAM_STARTUP_TIMEOUT_MS);
    timer.unref?.();

    const cleanupStartup = () => {
      clearTimeout(timer);
      stdout.off('data', onFirstChunk);
      stdout.off('end', onEarlyEnd);
      stdout.off('error', onEarlyError);
      child.off?.('exit', onEarlyExit);
    };

    const onFirstChunk = chunk => {
      if (settled) return;
      settled = true;
      cleanupStartup();
      output.write(chunk);
      stdout.pipe(output);
      stdout.once('error', err => output.destroy(err));
      resolve();
    };

    const failStartup = message => {
      if (settled) return;
      settled = true;
      cleanupStartup();
      killChild();
      output.destroy();
      reject(new Error(stderrTail.trim() || message));
    };

    const onEarlyEnd = () => failStartup('Audio stream ended before producing data.');
    const onEarlyError = err => failStartup(err?.message || 'Audio stream failed.');
    const onEarlyExit = code => {
      if (code && code !== 0) failStartup(`yt-dlp exited with code ${code}.`);
    };

    stdout.once('data', onFirstChunk);
    stdout.once('end', onEarlyEnd);
    stdout.once('error', onEarlyError);
    child.once?.('exit', onEarlyExit);
  });

  return output;
}

// Resolve a YouTube video strictly by its 11-char ID without calling YoutubeiExtractor's broken format selector or falling back to keyword search.
async function resolveYoutubeVideoTrack(videoId, player, requestedBy, { fetchFn = fetch } = {}) {
  const extractor = player.extractors?.resolve?.(YoutubeiExtractor.identifier) || null;
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  if (extractor?.innerTube?.getBasicInfo) {
    try {
      const info = await withTimeout(
        extractor.innerTube.getBasicInfo(videoId),
        10_000,
        'YouTube basic info timed out.'
      );
      const basic = info?.basic_info;
      if (basic?.id === videoId && basic.title) {
        const durationSeconds = Number(basic.duration) || 0;
        const isLive = Boolean(basic.is_live);
        const track = new Track(player, {
          title: basic.title,
          cleanTitle: basic.title,
          author: basic.channel?.name || basic.author || 'YouTube',
          url: canonicalUrl,
          duration: Util.buildTimeCode(Util.parseMS(durationSeconds * 1_000)),
          thumbnail: basic.thumbnail?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          views: Number(basic.view_count) || 0,
          requestedBy,
          source: 'youtube',
          queryType: QueryType.YOUTUBE_VIDEO,
          live: isLive,
          metadata: {
            duration_ms: durationSeconds * 1_000,
            live: isLive,
          },
        });
        track.extractor = extractor;
        return track;
      }
    } catch (error) {
      console.warn(`[YouTube Direct] InnerTube basicInfo failed for ${videoId}:`, error.message);
    }
  }

  try {
    const child = youtubeDl.exec(canonicalUrl, {
      ...ytDlpBaseOptions(),
      dumpSingleJson: true,
      noPlaylist: true,
      skipDownload: true,
    });
    const execution = await withTimeout(
      child,
      SEARCH_TIMEOUT_MS,
      'yt-dlp direct video lookup timed out.',
      () => child.kill()
    );
    const entry = parseYtDlpOutput(execution);
    if (entry && (!entry.id || entry.id === videoId)) {
      const track = ytDlpTrack(player, extractor, requestedBy, { ...entry, id: videoId }, {
        source: 'youtube',
        queryType: QueryType.YOUTUBE_VIDEO,
      });
      if (track) return track;
    }
  } catch (error) {
    console.warn(`[YouTube Direct] yt-dlp metadata failed for ${videoId}:`, error.message);
  }

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
  const response = await fetchFn(oembedUrl, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) {
    throw new Error(`YouTube video ${videoId} is unavailable (HTTP ${response.status}).`);
  }
  const oembed = await response.json();
  const track = new Track(player, {
    title: oembed.title || 'YouTube Video',
    cleanTitle: oembed.title || 'YouTube Video',
    author: oembed.author_name || 'YouTube',
    url: canonicalUrl,
    duration: '0:00',
    thumbnail: oembed.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    requestedBy,
    source: 'youtube',
    queryType: QueryType.YOUTUBE_VIDEO,
    live: false,
    metadata: { duration_ms: 0, live: false },
  });
  if (extractor) track.extractor = extractor;
  return track;
}

async function resolveYoutubePlaylistTracks(playlistUrl, player, requestedBy) {
  const extractor = player.extractors?.resolve?.(YoutubeiExtractor.identifier) || null;
  const child = youtubeDl.exec(playlistUrl, {
    ...ytDlpBaseOptions(),
    dumpSingleJson: true,
    flatPlaylist: true,
    playlistEnd: 100,
    skipDownload: true,
  });
  const execution = await withTimeout(
    child,
    SEARCH_TIMEOUT_MS,
    'yt-dlp playlist lookup timed out.',
    () => child.kill()
  );
  const data = parseYtDlpOutput(execution);
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  if (!entries.length) throw new Error('Playlist is empty or unavailable.');

  const playlist = new Playlist(player, {
    title: data.title || 'YouTube Playlist',
    description: data.description || data.title || '',
    thumbnail: data.thumbnails?.at(-1)?.url || entries[0]?.thumbnails?.at(-1)?.url || null,
    type: 'playlist',
    source: 'youtube',
    author: {
      name: data.uploader || data.channel || 'YouTube',
      url: data.uploader_url || data.channel_url || '',
    },
    tracks: [],
    id: data.id || playlistUrl,
    url: data.webpage_url || playlistUrl,
  });

  playlist.tracks = entries
    .map(entry => ytDlpTrack(player, extractor, requestedBy, entry, {
      source: 'youtube',
      queryType: QueryType.YOUTUBE_VIDEO,
      playlist,
    }))
    .filter(Boolean);

  if (!playlist.tracks.length) throw new Error('No playable videos found in playlist.');
  return playlist;
}

async function resolveDirectUrlTrack(url, player, requestedBy) {
  if (!isSafePublicUrl(url)) throw new Error('Unsafe URL rejected.');
  const extractor = player.extractors?.resolve?.(YoutubeiExtractor.identifier) || null;
  const child = youtubeDl.exec(url, {
    ...ytDlpBaseOptions(),
    dumpSingleJson: true,
    noPlaylist: true,
    skipDownload: true,
  });
  const execution = await withTimeout(
    child,
    SEARCH_TIMEOUT_MS,
    'Direct URL metadata lookup timed out.',
    () => child.kill()
  );
  const entry = parseYtDlpOutput(execution);
  if (!entry) throw new Error('No playable media at URL.');

  const videoId = extractYoutubeVideoId(entry.webpage_url || entry.url || url);
  const track = ytDlpTrack(player, videoId ? extractor : null, requestedBy, {
    ...entry,
    webpage_url: entry.webpage_url || url,
  }, {
    source: videoId ? 'youtube' : 'direct',
    queryType: videoId ? QueryType.YOUTUBE_VIDEO : QueryType.AUTO,
  });
  if (!track) throw new Error('Unsupported direct URL.');
  return track;
}

async function searchWithYoutubei(query, requestedBy, extractor) {
  const result = await withTimeout(
    extractor.handle(query, {
      requestedBy,
      type: QueryType.YOUTUBE_SEARCH,
    }),
    SEARCH_TIMEOUT_MS,
    'YouTube search timed out.'
  );
  return result.tracks || [];
}

async function searchWithYtDlp(query, requestedBy, player, extractor) {
  const child = youtubeDl.exec(`ytsearch${SEARCH_LIMIT}:${query}`, {
    ...ytDlpBaseOptions(),
    dumpSingleJson: true,
    flatPlaylist: true,
    playlistEnd: SEARCH_LIMIT,
    skipDownload: true,
  });
  const execution = await withTimeout(
    child,
    SEARCH_TIMEOUT_MS,
    'yt-dlp search timed out.',
    () => child.kill()
  );
  const result = parseYtDlpOutput(execution);

  return (result.entries || [])
    .map(entry => ytDlpTrack(player, extractor, requestedBy, entry, {
      source: 'youtube',
      queryType: QueryType.YOUTUBE_VIDEO,
    }))
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

  const queries = searchQueries(track);
  const enrichedTarget = { ...track, author: trackArtists(track) || track.author };
  let candidates = [];
  let match = null;

  for (const query of queries) {
    try {
      const batch = await searchWithYtDlp(query, track.requestedBy, player, extractor);
      candidates.push(...batch);
      match = findBestCandidate(enrichedTarget, candidates);
      if (match) break;
    } catch (error) {
      console.warn('[Music Match] yt-dlp search failed, trying fallback:', error.message);
    }

    try {
      const youtubeiBatch = await searchWithYoutubei(query, track.requestedBy, extractor);
      candidates.push(...youtubeiBatch);
      match = findBestCandidate(enrichedTarget, candidates);
      if (match) break;
    } catch (error) {
      console.warn('[Music Match] YouTubei search failed:', error.message);
    }
  }

  const ranked = rankCandidates(enrichedTarget, candidates);
  logRanking(track, ranked);

  if (!match) {
    throw new Error(`No confident audio match for "${track.title}" by ${track.author}.`);
  }

  return { bridgedTrack: match.candidate, extractor, score: match.score };
}

async function findAlternateTracks(track, player) {
  const extractor = player.extractors.resolve(YoutubeiExtractor.identifier);
  if (!extractor) throw new Error('YouTube extractor is unavailable.');

  const [primaryQuery] = searchQueries(track);
  let candidates = [];
  try {
    candidates = await searchWithYtDlp(primaryQuery, track.requestedBy, player, extractor);
  } catch (error) {
    console.warn('[Music Alternatives] yt-dlp search failed:', error.message);
  }
  if (!candidates.length) {
    candidates = await searchWithYoutubei(primaryQuery, track.requestedBy, extractor);
  }

  const playingKey = keyForSong(track.bridgedTrack || track);
  const seen = new Set([playingKey]);
  return rankCandidates({ ...track, author: trackArtists(track) || track.author }, candidates)
    .filter(match => match.titleCoverage >= 0.35)
    .map(match => match.candidate)
    .filter(candidate => {
      const key = keyForSong(candidate);
      if (!candidate.url || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function pruneMatchCache(now = Date.now()) {
  for (const [key, entry] of matchCache) {
    if (entry.expiresAt <= now) matchCache.delete(key);
  }
  while (matchCache.size >= MATCH_CACHE_MAX) {
    matchCache.delete(matchCache.keys().next().value);
  }
}

async function getCachedMatch(track, player) {
  const cacheKey = `${track.source}:${track.url}`;
  const now = Date.now();
  const cached = matchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  pruneMatchCache(now);
  const promise = resolveBestTrack(track, player).catch(error => {
    matchCache.delete(cacheKey);
    throw error;
  });
  matchCache.set(cacheKey, { promise, expiresAt: now + MATCH_CACHE_TTL_MS });
  return promise;
}

async function smartMusicBridge(track, _queryType, queue) {
  if (track?.source === 'direct' || track?.metadata?.directStream) {
    return createYoutubeDlStream(track);
  }
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
  if (track?.source === 'direct') return 'Direct link audio';
  return `${track?.source || 'unknown'} audio`;
}

module.exports = {
  createYoutubeDlStream,
  findAlternateTracks,
  playbackSourceLabel,
  preloadSmartMatches,
  resolveDirectUrlTrack,
  resolveYoutubePlaylistTracks,
  resolveYoutubeVideoTrack,
  searchQueries,
  smartMusicBridge,
};
