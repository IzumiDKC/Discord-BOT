const test = require('node:test');
const assert = require('node:assert/strict');
const { createAlternativeSession, takeAlternative } = require('../src/utils/musicAlternatives');
const { chooseDjTrack, djQueries, SmartDj } = require('../src/utils/smartDj');
const { outputText, parseMusicIntent, formatFaq, requestAssistant } = require('../src/utils/aiAssistant');
const interactionCreate = require('../src/events/interactionCreate');

test('alternative selection is bound to one user, guild and current track', () => {
  const currentTrack = { title: 'Wrong match' };
  const candidate = { title: 'Correct match' };
  const id = createAlternativeSession({ guildId: 'g1', userId: 'u1', currentTrack, candidates: [candidate] });
  assert.match(takeAlternative(id, '0', { guildId: 'g1', userId: 'u2', currentTrack }).error, /Only the person/);
  assert.match(takeAlternative(id, '0', { guildId: 'g1', userId: 'u1', currentTrack: {} }).error, /changed/);
  assert.match(takeAlternative(id, '0', { guildId: 'g1', userId: 'u1', currentTrack }).error, /expired/);
  const secondId = createAlternativeSession({ guildId: 'g1', userId: 'u1', currentTrack, candidates: [candidate] });
  assert.equal(takeAlternative(secondId, '0', { guildId: 'g1', userId: 'u1', currentTrack }).candidate, candidate);
});

test('alternative selection inserts at the front and skips only for a listener in voice', async () => {
  const currentTrack = { title: 'Wrong match' };
  const candidate = { title: 'Correct match' };
  const id = createAlternativeSession({ guildId: 'g1', userId: 'u1', currentTrack, candidates: [candidate] });
  const next = [{ title: 'Later' }];
  let skipped = 0;
  const replies = [];
  const queue = {
    currentTrack,
    repeatMode: 0,
    insertTrack(track, index) { next.splice(index, 0, track); },
    node: { skip: () => { skipped += 1; return true; } },
  };
  const client = { player: { nodes: { get: () => queue } } };
  const interaction = {
    customId: `music:alternative:${id}`,
    values: ['0'],
    guildId: 'g1',
    user: { id: 'u1' },
    member: { voice: { channelId: 'different' } },
    guild: { members: { me: { voice: { channelId: 'bot-voice' } } } },
    isStringSelectMenu: () => true,
    reply: async value => replies.push(value),
    update: async value => replies.push(value),
  };
  await interactionCreate.execute(interaction, client);
  assert.match(replies[0].content, /Join the same voice/);
  assert.equal(skipped, 0);
  interaction.member.voice.channelId = 'bot-voice';
  await interactionCreate.execute(interaction, client);
  assert.equal(next[0], candidate);
  assert.equal(candidate.requestedBy, interaction.user);
  assert.equal(skipped, 1);
  assert.match(replies[1].content, /Switching/);
});

test('Smart DJ picks a fresh song of ordinary length and tracks status', () => {
  const blocked = new Set(['already']);
  const results = [
    { url: 'https://www.youtube.com/watch?v=already', durationMS: 180_000 },
    { url: 'https://www.youtube.com/watch?v=live', durationMS: 0, metadata: { live: true } },
    { url: 'https://www.youtube.com/watch?v=fresh', durationMS: 190_000 },
  ];
  assert.equal(chooseDjTrack(results, blocked), results[2]);
  assert.match(djQueries('chill evening', { author: 'Artist' })[1], /Artist/);
  const dj = new SmartDj({});
  dj.start({ guildId: 'g1', voiceChannel: { id: 'v1' }, textChannel: null, requester: { id: 'u1' }, mood: 'chill evening' });
  assert.deepEqual(dj.status('g1'), { mood: 'chill evening', voiceChannelId: 'v1' });
  dj.markFailed('g1', results[0]);
  dj.markFailed('g1', results[1]);
  assert.ok(dj.status('g1'));
  dj.markFailed('g1', results[2]);
  assert.equal(dj.status('g1'), null);
  dj.start({ guildId: 'g1', voiceChannel: { id: 'v1' }, textChannel: null, requester: { id: 'u1' }, mood: 'focus' });
  dj.markFailed('g1', results[0]);
  dj.markPlaying('g1');
  assert.equal(dj.states.get('g1').failures, 0);
  assert.equal(dj.stop('g1'), true);
  assert.equal(dj.status('g1'), null);
});

test('Smart DJ refills an empty queue without repeating history', async () => {
  const voiceChannel = { id: 'v1', guild: { id: 'g1' } };
  const queue = {
    guild: { id: 'g1', channels: { cache: new Map([['v1', voiceChannel]]) } },
    channel: voiceChannel,
    currentTrack: null,
    isEmpty: () => true,
    metadata: {},
    setMetadata(value) { this.metadata = value; },
  };
  const plays = [];
  const client = {
    musicLibrary: {
      history: () => [{ url: 'https://www.youtube.com/watch?v=already' }],
      favorites: () => [],
    },
    player: {
      nodes: { get: () => queue },
      search: async () => ({ tracks: [
        { url: 'https://www.youtube.com/watch?v=already', durationMS: 180_000 },
        { url: 'https://www.youtube.com/watch?v=fresh', durationMS: 180_000 },
      ] }),
      play: async (_voice, query) => {
        plays.push(query);
        return { track: { title: 'Fresh', url: query } };
      },
    },
  };
  const dj = new SmartDj(client);
  dj.start({ guildId: 'g1', voiceChannel, textChannel: {}, requester: { id: 'u1' }, mood: 'focus' });
  assert.equal(await dj.refill(queue), true);
  assert.deepEqual(plays, ['https://www.youtube.com/watch?v=fresh']);
});

test('Smart DJ does not queue a result after being stopped during search', async () => {
  const voiceChannel = { id: 'v1', guild: { id: 'g1' } };
  const queue = {
    guild: { id: 'g1', channels: { cache: new Map([['v1', voiceChannel]]) } },
    channel: voiceChannel,
    currentTrack: null,
    isEmpty: () => true,
  };
  let releaseSearch;
  const plays = [];
  const client = {
    musicLibrary: { history: () => [], favorites: () => [] },
    player: {
      search: () => new Promise(resolve => { releaseSearch = resolve; }),
      play: async () => { plays.push('played'); },
    },
  };
  const dj = new SmartDj(client);
  dj.start({ guildId: 'g1', voiceChannel, textChannel: {}, requester: { id: 'u1' }, mood: 'focus' });
  const pending = dj.refill(queue);
  dj.stop('g1');
  releaseSearch({ tracks: [{ url: 'https://www.youtube.com/watch?v=fresh', durationMS: 180_000 }] });
  assert.equal(await pending, false);
  assert.deepEqual(plays, []);
});

test('AI response extraction and intent parsing reject unsupported actions', () => {
  assert.equal(outputText({ output: [{ content: [{ type: 'output_text', text: '{"action":"skip"}' }] }] }), '{"action":"skip"}');
  assert.deepEqual(parseMusicIntent('{"action":"play","query":"chill V-pop"}'), { action: 'play', query: 'chill V-pop' });
  assert.throws(() => parseMusicIntent('{"action":"stop"}'), /Unsupported/);
  assert.throws(() => parseMusicIntent('{"action":"play","query":""}'), /identify/);
  assert.match(formatFaq({ one: { question: 'Rules?', answer: 'Be kind.' } }), /Be kind/);
});

test('AI calls are opt-in, bounded and do not store API responses', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  const originalFetch = global.fetch;
  try {
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(requestAssistant({ instructions: 'Test', input: 'Hello' }), /disabled/);
    process.env.OPENAI_API_KEY = 'test-only-key';
    delete process.env.OPENAI_MODEL;
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.max_output_tokens, 200);
      assert.equal(body.reasoning.effort, 'none');
      assert.equal(body.model, 'gpt-5.6-luna');
      assert.equal(options.headers.Authorization, 'Bearer test-only-key');
      return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'Hello back' }] }] }) };
    };
    assert.equal(await requestAssistant({ instructions: 'Test', input: 'Hello', maxOutputTokens: 200 }), 'Hello back');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  }
});
