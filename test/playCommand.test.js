const test = require('node:test');
const assert = require('node:assert/strict');
const playCommand = require('../src/commands/music/play');

test('does not report a search error after playback has already succeeded', async () => {
  const replies = [];
  const voiceChannel = { id: 'voice-1' };
  const track = {
    cleanTitle: 'Lệ Lưu Ly',
    duration: '03:46',
    source: 'youtube',
    thumbnail: null,
    title: 'Lệ Lưu Ly',
    url: 'https://www.youtube.com/watch?v=example',
  };
  const queue = {
    metadata: {},
    node: {},
    setMetadata(metadata) {
      this.metadata = metadata;
    },
  };
  const interaction = {
    channel: { id: 'text-1' },
    deferReply: async () => {},
    editReply: async payload => {
      replies.push(payload);
      return payload;
    },
    guildId: 'guild-1',
    member: { voice: { channel: voiceChannel } },
    options: {
      getBoolean: () => false,
      getString: () => 'Lệ Lưu Ly',
    },
    user: { id: 'user-1' },
  };
  const client = {
    player: {
      nodes: { get: () => queue },
      play: async () => ({ searchResult: { tracks: [track] }, track }),
    },
  };

  await playCommand.execute(interaction, client);

  assert.equal(replies.length, 1);
  assert.match(replies[0].embeds[0].data.title, /Lệ Lưu Ly/);
  assert.doesNotMatch(replies[0].embeds[0].data.title, /Không tìm thấy/);
});
