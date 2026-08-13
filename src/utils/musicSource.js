const { QueryType } = require('discord-player');

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

function unwrapDiscordUrl(value) {
  const query = String(value || '').trim();
  return query.startsWith('<') && query.endsWith('>')
    ? query.slice(1, -1).trim()
    : query;
}

function isYoutubeAutoMix(playlistId) {
  return typeof playlistId === 'string' && playlistId.toUpperCase().startsWith('RD');
}

function canonicalizeYoutubeUrl(url) {
  if (url.hostname.toLowerCase() !== 'youtu.be') return url;

  const videoId = url.pathname.split('/').filter(Boolean)[0];
  if (!videoId) return url;

  const canonical = new URL('https://www.youtube.com/watch');
  canonical.searchParams.set('v', videoId);
  for (const [key, value] of url.searchParams) {
    canonical.searchParams.append(key, value);
  }
  return canonical;
}

function resolveYoutubeInput(inputUrl) {
  const url = canonicalizeYoutubeUrl(inputUrl);
  url.hostname = 'www.youtube.com';
  url.searchParams.delete('si');

  const playlistId = url.searchParams.get('list');
  const videoId = url.searchParams.get('v');

  // YouTube adds RD... radio/mix parameters to otherwise normal video shares.
  // Importing those as playlists makes every recommendation look user-requested.
  if (videoId && isYoutubeAutoMix(playlistId)) {
    for (const key of ['list', 'index', 'start_radio', 'rv']) {
      url.searchParams.delete(key);
    }

    return {
      query: url.toString(),
      searchEngine: QueryType.YOUTUBE_VIDEO,
      platform: 'youtube',
      collectionType: 'track',
      automaticMixRemoved: true,
      directAudio: true,
    };
  }

  if (playlistId) {
    return {
      query: url.toString(),
      searchEngine: QueryType.YOUTUBE_PLAYLIST,
      platform: 'youtube',
      collectionType: 'playlist',
      automaticMixRemoved: false,
      directAudio: true,
    };
  }

  return {
    query: url.toString(),
    searchEngine: QueryType.YOUTUBE_VIDEO,
    platform: 'youtube',
    collectionType: 'track',
    automaticMixRemoved: false,
    directAudio: true,
  };
}

function resolveSpotifyInput(url) {
  url.searchParams.delete('si');
  const parts = url.pathname.split('/').filter(Boolean);
  const typeIndex = parts[0]?.startsWith('intl-') ? 1 : 0;
  const type = parts[typeIndex];

  const searchEngine = type === 'album'
    ? QueryType.SPOTIFY_ALBUM
    : type === 'playlist'
      ? QueryType.SPOTIFY_PLAYLIST
      : QueryType.SPOTIFY_SONG;

  return {
    query: url.toString(),
    searchEngine,
    platform: 'spotify',
    collectionType: type === 'album' ? 'album' : type === 'playlist' ? 'playlist' : 'track',
    automaticMixRemoved: false,
    directAudio: false,
  };
}

function resolveMusicInput(rawQuery) {
  const query = unwrapDiscordUrl(rawQuery);

  try {
    const url = new URL(query);
    const hostname = url.hostname.toLowerCase();

    if (YOUTUBE_HOSTS.has(hostname)) return resolveYoutubeInput(url);
    if (hostname === 'open.spotify.com') return resolveSpotifyInput(url);
    if (hostname === 'spotify.link' || hostname === 'spotify.app.link') {
      return {
        query: url.toString(),
        searchEngine: QueryType.AUTO,
        platform: 'spotify',
        collectionType: 'unknown',
        automaticMixRemoved: false,
        directAudio: false,
      };
    }

    if (hostname === 'soundcloud.com' || hostname === 'www.soundcloud.com') {
      return {
        query: url.toString(),
        searchEngine: url.pathname.includes('/sets/')
          ? QueryType.SOUNDCLOUD_PLAYLIST
          : QueryType.SOUNDCLOUD_TRACK,
        platform: 'soundcloud',
        collectionType: url.pathname.includes('/sets/') ? 'playlist' : 'track',
        automaticMixRemoved: false,
        directAudio: true,
      };
    }

    if (hostname.endsWith('music.apple.com')) {
      return {
        query: url.toString(),
        searchEngine: QueryType.AUTO,
        platform: 'apple_music',
        collectionType: url.pathname.includes('/album/') ? 'album' : 'track',
        automaticMixRemoved: false,
        directAudio: false,
      };
    }

    return {
      query: url.toString(),
      searchEngine: QueryType.AUTO,
      platform: 'unknown',
      collectionType: 'track',
      automaticMixRemoved: false,
      directAudio: true,
    };
  } catch {
    // Plain text is intentionally routed to YouTube search below.
  }

  return {
    query,
    searchEngine: QueryType.YOUTUBE_SEARCH,
    platform: 'youtube',
    collectionType: 'search',
    automaticMixRemoved: false,
    directAudio: true,
  };
}

function platformLabel(platform) {
  return {
    spotify: 'Spotify',
    soundcloud: 'SoundCloud',
    youtube: 'YouTube',
    apple_music: 'Apple Music',
  }[platform] || 'Unknown';
}

module.exports = {
  isYoutubeAutoMix,
  platformLabel,
  resolveMusicInput,
  unwrapDiscordUrl,
};
