const test = require('node:test');
const assert = require('node:assert/strict');
const messageCreate = require('../src/events/messageCreate');

const MUSIC_CHANNEL_ID = '1299428445469675561';

function setup(content, overrides = {}) {
  const replies = [];
  const plays = [];
  const voiceChannel = { id: 'voice-1', guild: { id: 'guild-1' } };
  const track = {
    cleanTitle: 'Test Song',
    duration: '03:00',
    source: 'youtube',
    thumbnail: null,
    title: 'Test Song',
    url: 'https://www.youtube.com/watch?v=example',
  };
  const queue = {
    metadata: {},
    setMetadata(metadata) { this.metadata = metadata; },
  };
  const message = {
    author: { bot: false, id: 'user-1', username: 'Dien' },
    channel: { id: MUSIC_CHANNEL_ID },
    channelId: MUSIC_CHANNEL_ID,
    content,
    guildId: 'guild-1',
    member: { voice: { channel: voiceChannel } },
    reply: async payload => {
      replies.push(payload);
      return payload;
    },
    ...overrides,
  };
  const client = {
    player: {
      nodes: { get: () => queue },
      play: async (channel, query, options) => {
        plays.push({ channel, query, options });
        return { track, searchResult: { tracks: [track] } };
      },
    },
  };

  return { client, message, plays, queue, replies, voiceChannel };
}

test('removes Discord and Unicode emoji, then queues the remaining text', async () => {
  const { client, message, plays, queue, replies, voiceChannel } = setup('🎵 Nhạc chill <:dance:123456789012345678> 🇻🇳');

  await messageCreate.execute(message, client);

  assert.equal(plays.length, 1);
  assert.equal(plays[0].query, 'Nhạc chill');
  assert.equal(plays[0].channel, voiceChannel);
  assert.equal(plays[0].options.requestedBy, message.author);
  assert.equal(plays[0].options.nodeOptions.metadata.channel, message.channel);
  assert.equal(queue.metadata.channel, message.channel);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].embeds[0].data.title, 'Test Song');
  assert.deepEqual(replies[0].allowedMentions, { repliedUser: false });
});

test('preserves a music link while removing surrounding icons', () => {
  assert.equal(
    messageCreate.musicQueryFromMessage('1️⃣ 🎧 https://youtu.be/oxV4qrQozYo 🔥'),
    'https://youtu.be/oxV4qrQozYo'
  );
});

test('ignores emoji-only messages, bots, and other channels', async () => {
  for (const overrides of [
    { content: '❤️ 👏 <:dance:123456789012345678>' },
    { content: '1️⃣ 🇻🇳' },
    { author: { bot: true, id: 'bot-1' } },
    { channelId: 'other-channel' },
  ]) {
    const { client, message, plays, replies } = setup('Test Song', overrides);
    await messageCreate.execute(message, client);
    assert.equal(plays.length, 0);
    assert.equal(replies.length, 0);
  }
});

test('asks for a voice channel without searching', async () => {
  const { client, message, plays, replies } = setup('Test Song', { member: { voice: { channel: null } } });

  await messageCreate.execute(message, client);

  assert.equal(plays.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].embeds[0].data.title, /voice/);
});

test('keeps consecutive channel requests in message order', async () => {
  const first = setup('First song');
  let releaseFirst;
  first.client.player.play = async (channel, query, options) => {
    first.plays.push({ channel, query, options });
    if (query === 'First song') await new Promise(resolve => { releaseFirst = resolve; });
    return {
      track: { title: query, url: 'https://example.com/song', duration: '03:00' },
      searchResult: { tracks: [{ title: query }] },
    };
  };
  const second = setup('Second song');

  const firstRequest = messageCreate.execute(first.message, first.client);
  const secondRequest = messageCreate.execute(second.message, first.client);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(first.plays.map(play => play.query), ['First song']);

  releaseFirst();
  await Promise.all([firstRequest, secondRequest]);
  assert.deepEqual(first.plays.map(play => play.query), ['First song', 'Second song']);
});
