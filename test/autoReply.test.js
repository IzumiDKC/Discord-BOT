const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAutoReply,
  detectIntent,
  normalizeText,
  resetCooldowns,
} = require('../src/utils/autoReply');

function mockMessage(content, overrides = {}) {
  return {
    content,
    author: { bot: false, id: 'user-1', username: 'Dien' },
    client: { user: { id: 'bot-1' } },
    guildId: 'guild-1',
    member: { displayName: 'Dien' },
    mentions: { users: { has: () => false } },
    ...overrides,
  };
}

function mockClient(currentTrack = null) {
  const queue = currentTrack ? {
    currentTrack,
    node: { volume: 55 },
    tracks: { size: 3 },
  } : null;
  return { player: { nodes: { get: () => queue } } };
}

test.beforeEach(resetCooldowns);

test('normalizes Vietnamese text and matches whole intents', () => {
  assert.equal(normalizeText('  Đang phát bài gì vậy?  '), 'dang phat bai gi vay');
  assert.equal(detectIntent('đang phát bài gì vậy', false), 'now_playing');
  assert.equal(detectIntent('this should not greet', false), null);
  assert.equal(detectIntent('high quality music', false), null);
});

test('only responds to a short standalone greeting', () => {
  assert.equal(detectIntent('xin chào', false), 'greeting');
  assert.equal(detectIntent('hi', false), 'greeting');
  assert.equal(detectIntent('hi mọi người hôm nay khỏe không', false), null);
});

test('requires addressing the bot for vague controls and fallback', () => {
  assert.equal(detectIntent('skip đi', false), null);
  assert.equal(detectIntent('momoka skip đi', true), 'controls');
  assert.equal(detectIntent('momoka ơi', true), 'fallback');
});

test('uses live queue context for now-playing questions', () => {
  const message = mockMessage('đang phát bài gì?');
  const client = mockClient({ title: 'Shape of You', url: 'https://example.com/shape' });
  const reply = createAutoReply(message, client, 10_000);
  const embed = reply.payload.embeds[0].toJSON();

  assert.equal(reply.intent, 'now_playing');
  assert.match(embed.description, /Shape of You/);
  assert.match(embed.description, /3 bài/);
});

test('applies per-user cooldown to prevent chat spam', () => {
  const message = mockMessage('hello');
  const client = mockClient();

  assert.ok(createAutoReply(message, client, 10_000));
  assert.equal(createAutoReply(message, client, 11_000), null);
  assert.ok(createAutoReply(message, client, 19_000));
});
