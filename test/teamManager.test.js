const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TeamManager, buildTeam } = require('../src/utils/teamManager');
const { teamMessage } = require('../src/utils/teamUi');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discordbot-team-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'teams.json');
  return { manager: new TeamManager(file), file };
}

function draft(overrides = {}, now = 1_000_000) {
  return buildTeam({
    guildId: 'guild-1', channelId: 'channel-1', hostId: 'host-1',
    game: 'Lien Quan', slots: 3, rank: 'Diamond', role: 'Jungle', startsIn: 30,
    ...overrides,
  }, now);
}

test('validates team inputs and prevents duplicate active hosts', async t => {
  const { manager } = setup(t);
  assert.throws(() => draft({ slots: 11 }), /size/);
  assert.throws(() => draft({ startsIn: -1 }), /Start time/);
  assert.throws(() => draft({ game: 'x' }), /Game/);
  await manager.create(draft(), 'message-1', 1_000_000);
  await assert.rejects(manager.create(draft(), 'message-2', 1_000_000), /already have/);
  assert.equal(manager.list('guild-1', 1_000_000).length, 1);
  assert.equal(manager.list('other-guild', 1_000_000).length, 0);
});

test('concurrent joins never exceed capacity, and leaving reopens a full team', async t => {
  const { manager, file } = setup(t);
  await manager.create(draft(), 'message-1', 1_000_000);
  const joined = await Promise.all([
    manager.join('guild-1', 'message-1', 'member-1', 1_000_001),
    manager.join('guild-1', 'message-1', 'member-2', 1_000_001),
    manager.join('guild-1', 'message-1', 'member-3', 1_000_001),
  ]);
  assert.deepEqual(joined.map(result => result.code), ['joined', 'joined', 'full']);
  assert.equal(manager.get('guild-1', 'message-1').status, 'full');
  assert.equal(manager.get('guild-1', 'message-1').members.length, 3);
  assert.equal(teamMessage(manager.get('guild-1', 'message-1')).components[0].components[0].data.disabled, true);
  assert.equal((await manager.leave('guild-1', 'message-1', 'host-1', 1_000_002)).code, 'host');
  assert.equal((await manager.leave('guild-1', 'message-1', 'member-1', 1_000_002)).code, 'left');
  assert.equal(manager.get('guild-1', 'message-1').status, 'open');
  assert.equal(teamMessage(manager.get('guild-1', 'message-1')).components[0].components[0].data.disabled, false);
  assert.equal((await manager.join('guild-1', 'message-1', 'member-3', 1_000_003)).code, 'joined');

  const reloaded = new TeamManager(file);
  assert.equal(reloaded.get('guild-1', 'message-1').members.length, 3);
  assert.equal(reloaded.get('guild-1', 'message-1').status, 'full');
});

test('only host or staff can cancel; cancelled team cannot be joined', async t => {
  const { manager } = setup(t);
  await manager.create(draft(), 'message-1', 1_000_000);
  assert.equal((await manager.cancel('guild-1', 'message-1', 'other', false, 1_000_001)).code, 'forbidden');
  assert.equal((await manager.cancel('guild-1', 'message-1', 'moderator', true, 1_000_001)).code, 'cancelled');
  assert.equal((await manager.join('guild-1', 'message-1', 'member-1', 1_000_002)).code, 'closed');
  assert.equal(manager.list('guild-1', 1_000_002).length, 0);
  assert.equal(teamMessage(manager.get('guild-1', 'message-1')).components[0].components[0].data.disabled, true);
});

test('scheduled team gets one reminder and expires two hours after start', async t => {
  const { manager, file } = setup(t);
  const created = await manager.create(draft({ startsIn: 1 }), 'message-1', 1_000_000);
  const sent = [];
  const edits = [];
  const message = { edit: async payload => edits.push(payload) };
  const channel = {
    isTextBased: () => true,
    messages: { fetch: async () => message },
    send: async payload => sent.push(payload),
  };
  const client = {
    teamManager: manager,
    channels: { cache: new Map([['channel-1', channel]]), fetch: async () => channel },
  };
  assert.equal(manager.remindersDue(created.startsAt - 1).length, 0);
  await manager.tick(client, created.startsAt);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { users: ['host-1'] });
  await manager.tick(client, created.startsAt + 60_000);
  assert.equal(sent.length, 1);
  assert.equal(new TeamManager(file).get('guild-1', 'message-1').remindedAt, created.startsAt);
  await manager.tick(client, created.expiresAt);
  assert.equal(manager.get('guild-1', 'message-1').status, 'expired');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].components[0].components[0].data.disabled, true);
});

test('keeps an invalid data file untouched', t => {
  const { file } = setup(t);
  fs.writeFileSync(file, '{broken');
  assert.throws(() => new TeamManager(file));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
