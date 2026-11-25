const test = require('node:test');
const assert = require('node:assert/strict');
const { QueryType } = require('discord-player');
const {
  extractYoutubeVideoId,
  isSafePublicUrl,
  prepareMusicInput,
  resolveMusicInput,
} = require('../src/utils/musicSource');
const {
  findBestCandidate,
  rankSearchTracks,
  scoreCandidate,
} = require('../src/utils/musicMatcher');
const { resolveYoutubeVideoTrack } = require('../src/utils/smartMusicBridge');

test('treats a YouTube RD radio mix as one requested video', () => {
  const result = resolveMusicInput('<https://www.youtube.com/watch?v=abc123xyz00&list=RDabc123xyz00&start_radio=1>');

  assert.equal(result.searchEngine, QueryType.YOUTUBE_VIDEO);
  assert.equal(result.videoId, 'abc123xyz00');
  assert.equal(result.automaticMixRemoved, true);
  assert.equal(new URL(result.query).searchParams.has('list'), false);
});

test('extracts exact YouTube video ID from shorts, live, embed, music, pure RD mix, and messy share text', () => {
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/live/jfKfPfyJRdk?si=abc'), 'jfKfPfyJRdk');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/embed/oxV4qrQozYo'), 'oxV4qrQozYo');
  assert.equal(extractYoutubeVideoId('https://music.youtube.com/watch?app=desktop&v=oxV4qrQozYo&si=xyz'), 'oxV4qrQozYo');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/playlist?list=RDdQw4w9WgXcQ'), 'dQw4w9WgXcQ');

  const shared = resolveMusicInput('Nghe bài này thử đi https://youtu.be/oxV4qrQozYo?si=share123!');
  assert.equal(shared.searchEngine, QueryType.YOUTUBE_VIDEO);
  assert.equal(shared.videoId, 'oxV4qrQozYo');
  assert.equal(shared.query, 'https://www.youtube.com/watch?v=oxV4qrQozYo');
  assert.equal(shared.isUrl, true);
});

test('rejects non-video YouTube channel URLs and private IPs instead of searching URL text', () => {
  const channel = resolveMusicInput('https://www.youtube.com/@YOASOBI_staff');
  assert.equal(channel.isUrl, true);
  assert.equal(channel.unsupportedUrl, true);

  assert.equal(isSafePublicUrl('http://127.0.0.1:8080/audio.mp3'), false);
  assert.equal(isSafePublicUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isSafePublicUrl('http://localhost/test'), false);
  assert.equal(resolveMusicInput('http://192.168.1.1/stream.mp3').unsupportedUrl, true);
});

test('keeps real YouTube playlists and album playlists intact and canonicalized', () => {
  const playlist = resolveMusicInput('https://www.youtube.com/watch?v=abc123xyz00&list=PL1234567890');
  const album = resolveMusicInput('https://music.youtube.com/playlist?list=OLAK5uy_example');

  assert.equal(playlist.searchEngine, QueryType.YOUTUBE_PLAYLIST);
  assert.equal(playlist.query, 'https://www.youtube.com/playlist?list=PL1234567890');
  assert.equal(album.searchEngine, QueryType.YOUTUBE_PLAYLIST);
  assert.equal(playlist.automaticMixRemoved, false);
});

test('recognizes Spotify albums and Apple Music links with exact query types', () => {
  const result = resolveMusicInput('https://open.spotify.com/intl-vn/album/123456789?si=tracking');

  assert.equal(result.searchEngine, QueryType.SPOTIFY_ALBUM);
  assert.equal(result.collectionType, 'album');
  assert.equal(result.directAudio, false);
  assert.equal(result.query, 'https://open.spotify.com/album/123456789');

  const appleSong = resolveMusicInput('https://music.apple.com/vn/album/example/111?i=222');
  assert.equal(appleSong.searchEngine, QueryType.APPLE_MUSIC_SONG);
  const appleAlbum = resolveMusicInput('https://music.apple.com/vn/album/example/111');
  assert.equal(appleAlbum.searchEngine, QueryType.APPLE_MUSIC_ALBUM);
});

test('leaves Spotify short links on automatic resolution synchronously and expands redirects asynchronously', async () => {
  const syncResult = resolveMusicInput('https://spotify.link/example');
  assert.equal(syncResult.searchEngine, QueryType.AUTO);
  assert.equal(syncResult.platform, 'spotify');
  assert.equal(syncResult.directAudio, false);

  const expanded = await prepareMusicInput('https://spotify.link/example', {
    fetchFn: async () => ({
      status: 302,
      headers: new Map([['location', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc']]),
    }),
  });
  assert.equal(expanded.searchEngine, QueryType.SPOTIFY_SONG);
  assert.equal(expanded.query, 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
});

test('resolves YouTube direct video strictly by ID via InnerTube or oEmbed without keyword search', async () => {
  const fakeExtractor = {
    innerTube: {
      getBasicInfo: async id => ({
        basic_info: {
          id,
          title: 'Exact Video Title',
          channel: { name: 'Exact Channel' },
          duration: 215,
          is_live: false,
          thumbnail: [{ url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }],
        },
      }),
    },
  };
  const fakePlayer = {
    extractors: { resolve: () => fakeExtractor },
  };
  const track = await resolveYoutubeVideoTrack('dQw4w9WgXcQ', fakePlayer, { id: 'u1' });
  assert.equal(track.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(track.title, 'Exact Video Title');
  assert.equal(track.author, 'Exact Channel');
  assert.equal(track.duration, '03:35');
});

test('prefers the same studio track over a live or unrelated result', () => {
  const target = {
    title: 'Mộng Yu',
    author: 'AMEE, MCK',
    durationMS: 284_000,
  };
  const correct = {
    title: 'MỘNG YU - AMEE x MCK | Official Music Video',
    author: 'ST.319 Entertainment',
    durationMS: 287_000,
  };
  const live = {
    title: 'Mộng Yu - AMEE live at festival',
    author: 'Random Channel',
    durationMS: 350_000,
  };
  const unrelated = {
    title: 'AMEE 14 Hits Mashup',
    author: 'AMEE',
    durationMS: 1_042_000,
  };

  const best = findBestCandidate(target, [unrelated, live, correct]);

  assert.equal(best.candidate, correct);
  assert.ok(scoreCandidate(target, correct).score > scoreCandidate(target, live).score);
});

test('matches Japanese and Korean titles accurately without collapsing non-Latin characters', () => {
  const target = {
    title: '夜に駆ける',
    author: 'YOASOBI',
    durationMS: 261_000,
  };
  const official = {
    title: 'YOASOBI「夜に駆ける」 Official Music Video',
    author: 'Ayase / YOASOBI',
    durationMS: 262_000,
  };
  const wrongJapanese = {
    title: 'YOASOBI「アイドル」 Official Music Video',
    author: 'Ayase / YOASOBI',
    durationMS: 225_000,
  };

  assert.equal(findBestCandidate(target, [wrongJapanese]), null);
  assert.equal(findBestCandidate(target, [wrongJapanese, official]).candidate, official);
});

test('re-ranks plain-text search results to demote Shorts, karaoke, and 1-hour loops', () => {
  const shortClip = { title: 'Lệ Lưu Ly #shorts', author: 'Clip TikTok', durationMS: 25_000 };
  const karaoke = { title: 'Lệ Lưu Ly Karaoke Beat Chuẩn', author: 'Karaoke Channel', durationMS: 220_000 };
  const hourLoop = { title: 'Lệ Lưu Ly 1 Hour Loop', author: 'Chill Loop', durationMS: 3_600_000 };
  const official = { title: 'LỆ LƯU LY - VŨ PHỤNG TIÊN x DT TẬP RAP | OFFICIAL MUSIC VIDEO', author: 'DT Tập Rap Official', durationMS: 226_000 };

  const ranked = rankSearchTracks('Lệ Lưu Ly', [shortClip, karaoke, hourLoop, official]);
  assert.equal(ranked[0], official);
});

test('rejects a different song even when the artist matches', () => {
  const target = {
    title: 'Chúng Ta Của Tương Lai',
    author: 'Sơn Tùng M-TP',
    durationMS: 268_000,
  };
  const wrongSong = {
    title: 'Chúng Ta Không Thuộc Về Nhau | Official Music Video',
    author: 'Sơn Tùng M-TP Official',
    durationMS: 243_000,
  };

  assert.equal(findBestCandidate(target, [wrongSong]), null);
});

test('prefers an official artist channel over fan uploads and remasters', () => {
  const target = {
    title: 'Chúng Ta Của Tương Lai',
    author: 'Sơn Tùng M-TP',
    durationMS: 249_000,
  };
  const official = {
    title: 'SƠN TÙNG M-TP | CHÚNG TA CỦA TƯƠNG LAI | OFFICIAL MUSIC VIDEO',
    author: 'Sơn Tùng M-TP Official',
    durationMS: 277_000,
  };
  const fanUpload = {
    title: 'CHÚNG TA CỦA TƯƠNG LAI | SƠN TÙNG M-TP | AUDIO MUSIC',
    author: 'Sơn Tùng M-TP Fan',
    durationMS: 252_000,
  };
  const remaster = {
    title: 'Chúng Ta Của Tương Lai - Sơn Tùng M-TP | 5.1 Remastered',
    author: 'CVmedia',
    durationMS: 251_000,
  };

  assert.equal(findBestCandidate(target, [fanUpload, remaster, official]).candidate, official);
});
