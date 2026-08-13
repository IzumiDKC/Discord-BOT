const test = require('node:test');
const assert = require('node:assert/strict');
const { addedToQueueEmbed, musicControls, nowPlayingEmbed, queueEmbed } = require('../src/utils/musicUi');

function setupQueue() {
  const track = {
    title: 'Shape of You',
    cleanTitle: 'Shape of You',
    url: 'https://open.spotify.com/track/example',
    duration: '03:53',
    source: 'spotify',
    thumbnail: 'https://i.scdn.co/image/example',
    requestedBy: { id: '123', username: 'Dien' },
  };
  return {
    track,
    queue: {
      currentTrack: track,
      isShuffling: false,
      node: {
        volume: 55,
        createProgressBar: () => '▬▬●▬▬',
        getTimestamp: () => ({ current: { label: '00:10' }, total: { label: '03:53' } }),
      },
      repeatMode: 0,
      tracks: { size: 1, toArray: () => [track] },
    },
  };
}

test('builds a branded now-playing card with useful context', () => {
  const { queue, track } = setupQueue();
  const embed = nowPlayingEmbed(queue, track).toJSON();

  assert.equal(embed.title, 'Shape of You');
  assert.equal(embed.color, 0x57F287);
  assert.equal(embed.author.name, 'NOW PLAYING  •  hoshi ♡');
  assert.match(embed.description, /00:10 \/ 03:53/);
  assert.match(embed.footer.text, /Spotify catalog/);
});

test('builds a compact queue card and four working control ids', () => {
  const { queue } = setupQueue();
  const embed = queueEmbed(queue, () => true).toJSON();
  const row = musicControls()[0].toJSON();

  assert.match(embed.fields.at(-1).value, /Shape of You/);
  assert.deepEqual(
    row.components.map(component => component.custom_id),
    ['music:pause-resume', 'music:skip', 'music:queue', 'music:stop']
  );
});

test('keeps a YouTube queue confirmation red to distinguish it from now playing', () => {
  const { track } = setupQueue();
  const embed = addedToQueueEmbed({
    collection: null,
    interaction: { user: { id: '123' } },
    notice: null,
    playbackDescription: 'Phát audio trực tiếp từ YouTube',
    resolvedInput: { platform: 'youtube' },
    shouldShuffle: false,
    track: { ...track, source: 'youtube' },
    trackCount: 1,
  }).toJSON();

  assert.equal(embed.color, 0xFF0033);
  assert.match(embed.footer.text, /hoshi ♡/);
});
