const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MusicLibrary, keyForSong, playlistKey, MAX_SNAPSHOT } = require('../src/utils/musicLibrary');

function track(id) {
  return { title: `Song ${id}`, author: 'Artist', source: 'youtube', duration: '03:00', url: `https://www.youtube.com/watch?v=${id}` };
}

test('favorites, playlists, queue snapshots, history and FAQ survive a restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discordbot-library-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'music.json');
  const library = new MusicLibrary(file);
  assert.equal(await library.addFavorite('user-1', track('one')), true);
  assert.equal(await library.addFavorite('user-1', track('one')), false);
  const saved = await library.savePlaylist('user-1', '__proto__', [track('one'), track('two')]);
  assert.equal(saved.tracks.length, 2);
  await library.recordStarted('guild-1', track('one'), {
    currentTrack: track('one'), tracks: { toArray: () => [track('two')] },
  });
  await library.setFaq('guild-1', '__proto__', 'The real answer');

  const reloaded = new MusicLibrary(file);
  assert.equal(reloaded.favorites('user-1').length, 1);
  assert.equal(reloaded.playlists('user-1')[playlistKey('__proto__')].tracks.length, 2);
  assert.equal(reloaded.snapshot('guild-1').length, 2);
  assert.equal(reloaded.history('guild-1')[0].title, 'Song one');
  assert.equal(Object.values(reloaded.faq('guild-1'))[0].answer, 'The real answer');
  assert.equal(await reloaded.removeFavorite('user-1', -1), null);
  assert.equal((await reloaded.removeFavorite('user-1', 0)).title, 'Song one');
  await reloaded.clearQueue('guild-1');
  assert.deepEqual(new MusicLibrary(file).snapshot('guild-1'), []);
});

test('does not overwrite an unreadable library file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discordbot-library-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'music.json');
  fs.writeFileSync(file, '{not JSON');
  assert.throws(() => new MusicLibrary(file));
  assert.equal(fs.readFileSync(file, 'utf8'), '{not JSON');
});

test('identifies shared YouTube links and saves the actual bridged audio', () => {
  assert.equal(keyForSong({ url: 'https://youtu.be/abc' }), keyForSong({ url: 'https://www.youtube.com/watch?v=abc&t=12' }));
  assert.equal(MAX_SNAPSHOT, 50);
});
