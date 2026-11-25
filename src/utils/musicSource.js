const net = require('node:net');
const { QueryType } = require('discord-player');

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'gaming.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const SHORTENER_HOSTS = new Set([
  'spotify.link',
  'spotify.app.link',
  'on.soundcloud.com',
  'soundcloud.app.goo.gl',
  'vt.tiktok.com',
  'vm.tiktok.com',
]);

const SOUNDCLOUD_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
]);

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const EMBEDDED_URL_RE = /https?:\/\/[^\s<>]+/i;
const TRAILING_PUNCTUATION_RE = /[).,;!?\]>'"]+$/;

function unwrapDiscordUrl(value) {
  const query = String(value || '').trim();
  if (query.startsWith('<') && query.endsWith('>')) {
    return query.slice(1, -1).trim();
  }
  return query;
}

function extractUrlFromText(value) {
  const unwrapped = unwrapDiscordUrl(value);
  if (/^https?:\/\/\S+$/i.test(unwrapped)) {
    return unwrapped.replace(TRAILING_PUNCTUATION_RE, '');
  }
  const match = unwrapped.match(EMBEDDED_URL_RE);
  return match ? match[0].replace(TRAILING_PUNCTUATION_RE, '') : null;
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  return false;
}

function isSafePublicUrl(input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(String(input));
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return !isPrivateIpv4(host);
  if (ipVersion === 6) {
    if (host === '::' || host === '::1') return false;
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
    if (host.startsWith('::ffff:')) {
      const mapped = host.slice('::ffff:'.length);
      if (net.isIP(mapped) === 4) return !isPrivateIpv4(mapped);
    }
  }
  return true;
}

function isYoutubeAutoMix(playlistId) {
  if (typeof playlistId !== 'string') return false;
  const upper = playlistId.toUpperCase();
  return upper.startsWith('RD') || upper.startsWith('UL');
}

function validVideoId(candidate) {
  return typeof candidate === 'string' && YOUTUBE_VIDEO_ID_RE.test(candidate) ? candidate : null;
}

function extractYoutubeVideoId(input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(unwrapDiscordUrl(input));
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    return validVideoId(segments[0]);
  }

  const fromQuery = validVideoId(url.searchParams.get('v'));
  if (fromQuery) return fromQuery;

  if (['shorts', 'live', 'embed', 'v'].includes(segments[0])) {
    return validVideoId(segments[1]);
  }

  const list = url.searchParams.get('list');
  if (isYoutubeAutoMix(list) && list.length >= 13) {
    const tail = list.slice(-11);
    return validVideoId(tail);
  }

  return null;
}

function resolveYoutubeInput(url) {
  const searchQuery = url.pathname === '/results' ? url.searchParams.get('search_query')?.trim() : null;
  if (searchQuery) {
    return {
      query: searchQuery,
      searchEngine: QueryType.YOUTUBE_SEARCH,
      platform: 'youtube',
      collectionType: 'search',
      automaticMixRemoved: false,
      directAudio: true,
      isUrl: false,
    };
  }

  const playlistId = url.searchParams.get('list');
  const videoId = extractYoutubeVideoId(url);
  const rawWatchId = url.pathname === '/watch' ? url.searchParams.get('v') : null;
  const fallbackWatchId = !videoId && typeof rawWatchId === 'string' && /^[A-Za-z0-9_-]{3,32}$/.test(rawWatchId)
    ? rawWatchId
    : null;
  const targetId = videoId || fallbackWatchId;

  if (targetId && isYoutubeAutoMix(playlistId)) {
    return {
      query: `https://www.youtube.com/watch?v=${targetId}`,
      searchEngine: QueryType.YOUTUBE_VIDEO,
      platform: 'youtube',
      collectionType: 'track',
      automaticMixRemoved: true,
      directAudio: true,
      isUrl: true,
      ...(videoId ? { videoId } : {}),
    };
  }

  if (playlistId && !isYoutubeAutoMix(playlistId)) {
    return {
      query: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
      searchEngine: QueryType.YOUTUBE_PLAYLIST,
      platform: 'youtube',
      collectionType: 'playlist',
      automaticMixRemoved: false,
      directAudio: true,
      isUrl: true,
      playlistId,
    };
  }

  if (targetId) {
    return {
      query: `https://www.youtube.com/watch?v=${targetId}`,
      searchEngine: QueryType.YOUTUBE_VIDEO,
      platform: 'youtube',
      collectionType: 'track',
      automaticMixRemoved: false,
      directAudio: true,
      isUrl: true,
      ...(videoId ? { videoId } : {}),
    };
  }

  return {
    query: url.toString(),
    searchEngine: QueryType.YOUTUBE_VIDEO,
    platform: 'youtube',
    collectionType: 'unknown',
    automaticMixRemoved: false,
    directAudio: true,
    isUrl: true,
    unsupportedUrl: true,
  };
}

function resolveSpotifyInput(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const offset = parts[0]?.startsWith('intl-') ? 1 : 0;
  const userOffset = parts[offset] === 'user' && parts[offset + 2] ? offset + 2 : offset;
  const type = parts[userOffset];
  const id = parts[userOffset + 1];

  if (!id || !['track', 'album', 'playlist'].includes(type)) {
    return {
      query: url.toString(),
      searchEngine: QueryType.SPOTIFY_SONG,
      platform: 'spotify',
      collectionType: 'unknown',
      automaticMixRemoved: false,
      directAudio: false,
      isUrl: true,
      unsupportedUrl: true,
    };
  }

  const canonical = `https://open.spotify.com/${type}/${encodeURIComponent(id)}`;
  const searchEngine = type === 'album'
    ? QueryType.SPOTIFY_ALBUM
    : type === 'playlist'
      ? QueryType.SPOTIFY_PLAYLIST
      : QueryType.SPOTIFY_SONG;

  return {
    query: canonical,
    searchEngine,
    platform: 'spotify',
    collectionType: type === 'album' ? 'album' : type === 'playlist' ? 'playlist' : 'track',
    automaticMixRemoved: false,
    directAudio: false,
    isUrl: true,
  };
}

function resolveAppleMusicInput(url) {
  const path = url.pathname.toLowerCase();
  const hasSongParam = url.searchParams.has('i');
  if (hasSongParam || path.includes('/song/')) {
    return {
      query: url.toString(),
      searchEngine: QueryType.APPLE_MUSIC_SONG,
      platform: 'apple_music',
      collectionType: 'track',
      automaticMixRemoved: false,
      directAudio: false,
      isUrl: true,
    };
  }
  if (path.includes('/playlist/')) {
    return {
      query: url.toString(),
      searchEngine: QueryType.APPLE_MUSIC_PLAYLIST,
      platform: 'apple_music',
      collectionType: 'playlist',
      automaticMixRemoved: false,
      directAudio: false,
      isUrl: true,
    };
  }
  if (path.includes('/album/')) {
    return {
      query: url.toString(),
      searchEngine: QueryType.APPLE_MUSIC_ALBUM,
      platform: 'apple_music',
      collectionType: 'album',
      automaticMixRemoved: false,
      directAudio: false,
      isUrl: true,
    };
  }
  return {
    query: url.toString(),
    searchEngine: QueryType.APPLE_MUSIC_SONG,
    platform: 'apple_music',
    collectionType: 'unknown',
    automaticMixRemoved: false,
    directAudio: false,
    isUrl: true,
    unsupportedUrl: true,
  };
}

function resolveMusicInput(rawQuery) {
  const trimmed = unwrapDiscordUrl(rawQuery);
  const candidateUrl = extractUrlFromText(trimmed);

  if (candidateUrl) {
    try {
      const url = new URL(candidateUrl);
      const hostname = url.hostname.toLowerCase();

      if (!isSafePublicUrl(url)) {
        return {
          query: candidateUrl,
          searchEngine: QueryType.AUTO,
          platform: 'unknown',
          collectionType: 'unknown',
          automaticMixRemoved: false,
          directAudio: false,
          isUrl: true,
          unsupportedUrl: true,
        };
      }

      if (YOUTUBE_HOSTS.has(hostname)) return resolveYoutubeInput(url);
      if (hostname === 'open.spotify.com') return resolveSpotifyInput(url);

      if (SHORTENER_HOSTS.has(hostname)) {
        const platform = hostname.includes('spotify')
          ? 'spotify'
          : hostname.includes('soundcloud')
            ? 'soundcloud'
            : 'direct';
        return {
          query: url.toString(),
          searchEngine: QueryType.AUTO,
          platform,
          collectionType: 'unknown',
          automaticMixRemoved: false,
          directAudio: platform !== 'spotify',
          isUrl: true,
          isShortLink: true,
        };
      }

      if (SOUNDCLOUD_HOSTS.has(hostname)) {
        const clean = new URL(url.toString());
        clean.hostname = 'soundcloud.com';
        for (const key of ['si', 'ref', 'utm_source', 'utm_medium', 'utm_campaign']) {
          clean.searchParams.delete(key);
        }
        const segments = clean.pathname.split('/').filter(Boolean);
        if (segments.length < 2) {
          return {
            query: clean.toString(),
            searchEngine: QueryType.SOUNDCLOUD_TRACK,
            platform: 'soundcloud',
            collectionType: 'unknown',
            automaticMixRemoved: false,
            directAudio: true,
            isUrl: true,
            unsupportedUrl: true,
          };
        }
        const isSet = clean.pathname.includes('/sets/');
        return {
          query: clean.toString(),
          searchEngine: isSet ? QueryType.SOUNDCLOUD_PLAYLIST : QueryType.SOUNDCLOUD_TRACK,
          platform: 'soundcloud',
          collectionType: isSet ? 'playlist' : 'track',
          automaticMixRemoved: false,
          directAudio: true,
          isUrl: true,
        };
      }

      if (hostname.endsWith('music.apple.com')) return resolveAppleMusicInput(url);

      return {
        query: url.toString(),
        searchEngine: QueryType.AUTO,
        platform: 'direct',
        collectionType: 'track',
        automaticMixRemoved: false,
        directAudio: true,
        isUrl: true,
      };
    } catch {
      // Fall through to plain-text search if URL parsing fails.
    }
  }

  return {
    query: trimmed,
    searchEngine: QueryType.YOUTUBE_SEARCH,
    platform: 'youtube',
    collectionType: 'search',
    automaticMixRemoved: false,
    directAudio: true,
    isUrl: false,
  };
}

// Follow HTTP redirect hops manually so short links resolve to canonical URLs without fetching page bodies or allowing SSRF.
async function expandShortUrl(initialUrl, fetchFn = fetch, maxHops = 5) {
  let current = initialUrl;
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (!isSafePublicUrl(current)) throw new Error('Blocked unsafe redirect target.');
    const response = await fetchFn(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)' },
      signal: AbortSignal.timeout(5_000),
    });
    const location = response.headers?.get?.('location');
    try { await response.body?.cancel?.(); } catch {}
    if (!location || response.status < 300 || response.status >= 400) break;
    current = new URL(location, current).toString();
    const host = new URL(current).hostname.toLowerCase();
    if (!SHORTENER_HOSTS.has(host)) break;
  }
  if (!isSafePublicUrl(current)) throw new Error('Blocked unsafe redirect target.');
  return current;
}

async function prepareMusicInput(rawQuery, { fetchFn = fetch } = {}) {
  const initial = resolveMusicInput(rawQuery);
  if (!initial.isShortLink) return initial;

  try {
    const expanded = await expandShortUrl(initial.query, fetchFn);
    if (expanded && expanded !== initial.query) {
      return resolveMusicInput(expanded);
    }
  } catch (error) {
    console.warn('[Music Source] Short-link expansion failed:', error.message);
  }
  return { ...initial, unsupportedUrl: true };
}

function platformLabel(platform) {
  return {
    spotify: 'Spotify',
    soundcloud: 'SoundCloud',
    youtube: 'YouTube',
    apple_music: 'Apple Music',
    direct: 'Direct Link',
  }[platform] || 'Unknown';
}

module.exports = {
  expandShortUrl,
  extractUrlFromText,
  extractYoutubeVideoId,
  isSafePublicUrl,
  isYoutubeAutoMix,
  platformLabel,
  prepareMusicInput,
  resolveMusicInput,
  unwrapDiscordUrl,
};
