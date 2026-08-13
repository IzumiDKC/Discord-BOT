const test = require('node:test');
const assert = require('node:assert/strict');
const { QueryType } = require('discord-player');
const { resolveMusicInput } = require('../src/utils/musicSource');
const { findBestCandidate, scoreCandidate } = require('../src/utils/musicMatcher');

test('treats a YouTube RD radio mix as one requested video', () => {
  const result = resolveMusicInput('<https://www.youtube.com/watch?v=abc123xyz00&list=RDabc123xyz00&start_radio=1>');

  assert.equal(result.searchEngine, QueryType.YOUTUBE_VIDEO);
  assert.equal(result.automaticMixRemoved, true);
  assert.equal(new URL(result.query).searchParams.has('list'), false);
});

test('keeps real YouTube playlists and album playlists intact', () => {
  const playlist = resolveMusicInput('https://www.youtube.com/watch?v=abc123xyz00&list=PL1234567890');
  const album = resolveMusicInput('https://music.youtube.com/playlist?list=OLAK5uy_example');

  assert.equal(playlist.searchEngine, QueryType.YOUTUBE_PLAYLIST);
  assert.equal(album.searchEngine, QueryType.YOUTUBE_PLAYLIST);
  assert.equal(playlist.automaticMixRemoved, false);
});

test('recognizes Spotify albums and keeps them as albums', () => {
  const result = resolveMusicInput('https://open.spotify.com/intl-vn/album/123456789?si=tracking');

  assert.equal(result.searchEngine, QueryType.SPOTIFY_ALBUM);
  assert.equal(result.collectionType, 'album');
  assert.equal(result.directAudio, false);
  assert.equal(new URL(result.query).searchParams.has('si'), false);
});

test('leaves Spotify short links on automatic resolution', () => {
  const result = resolveMusicInput('https://spotify.link/example');

  assert.equal(result.searchEngine, QueryType.AUTO);
  assert.equal(result.platform, 'spotify');
  assert.equal(result.directAudio, false);
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
