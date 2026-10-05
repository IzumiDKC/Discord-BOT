const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const teamCommand = require('../src/commands/utility/team');
const interactionCreate = require('../src/events/interactionCreate');
const { TeamManager } = require('../src/utils/teamManager');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discordbot-team-interaction-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const edits = [];
  const sent = [];
  const deleted = [];
  const messages = new Map();
  const channel = {
    id: 'channel-1',
    isTextBased: () => true,
    send: async payload => {
      sent.push(payload);
      const id = `message-${sent.length}`;
      const message = {
        id,
        edit: async value => { edits.push(value); return message; },
        delete: async () => deleted.push(id),
      };
      messages.set(id, message);
      return message;
    },
    messages: { fetch: async id => messages.get(id) },
  };
  const client = {
    teamManager: new TeamManager(path.join(dir, 'teams.json')),
    channels: { cache: new Map([['channel-1', channel]]), fetch: async () => channel },
  };
  return { channel, client, deleted, edits, sent, file: path.join(dir, 'teams.json') };
}

function commandInteraction(channel, sub, userId = 'host-1', overrides = {}) {
  const replies = [];
  const interaction = {
    guildId: 'guild-1', channelId: channel.id, channel,
    user: { id: userId },
    memberPermissions: { has: () => false },
    options: {
      getSubcommand: () => sub,
      getString: name => ({ game: 'Lien Quan', rank: 'Diamond', role: 'Jungle' })[name] || null,
      getInteger: name => ({ slots: 2, starts_in: 10 })[name] ?? null,
    },
    deferReply: async value => replies.push({ defer: value }),
    editReply: async value => replies.push(value),
    reply: async value => replies.push(value),
    ...overrides,
  };
  return { interaction, replies };
}

function buttonInteraction(channel, id, action, userId, overrides = {}) {
  const replies = [];
  const interaction = {
    customId: `team:${action}`,
    guildId: 'guild-1', channelId: channel.id,
    message: { id }, user: { id: userId },
    memberPermissions: { has: () => false },
    isStringSelectMenu: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    deferReply: async value => replies.push({ defer: value }),
    editReply: async value => replies.push(value),
    reply: async value => replies.push(value),
    ...overrides,
  };
  return { interaction, replies };
}

test('/team create posts a usable card, lists it, and cleans up a duplicate post', async t => {
  const { channel, client, deleted, sent } = setup(t);
  const first = commandInteraction(channel, 'create');
  await teamCommand.execute(first.interaction, client);
  assert.equal(sent.length, 1);
  assert.equal(client.teamManager.get('guild-1', 'message-1').hostId, 'host-1');
  assert.match(first.replies.at(-1).content, /Team posted/);

  const listing = commandInteraction(channel, 'list');
  await teamCommand.execute(listing.interaction, client);
  assert.match(listing.replies[0].content, /Lien Quan/);

  const duplicate = commandInteraction(channel, 'create');
  await teamCommand.execute(duplicate.interaction, client);
  assert.deepEqual(deleted, ['message-2']);
  assert.match(duplicate.replies.at(-1), /already have/);
});

test('button joins a team, blocks unauthorized cancellation, and host can cancel', async t => {
  const { channel, client, edits } = setup(t);
  await teamCommand.execute(commandInteraction(channel, 'create').interaction, client);
  const join = buttonInteraction(channel, 'message-1', 'join', 'member-1');
  await interactionCreate.execute(join.interaction, client);
  assert.match(join.replies.at(-1), /now full/);
  assert.equal(client.teamManager.get('guild-1', 'message-1').status, 'full');
  assert.equal(edits.at(-1).components[0].components[0].data.disabled, true);

  const other = buttonInteraction(channel, 'message-1', 'cancel', 'member-1');
  await interactionCreate.execute(other.interaction, client);
  assert.match(other.replies.at(-1), /Only the host/);

  const host = buttonInteraction(channel, 'message-1', 'cancel', 'host-1');
  await interactionCreate.execute(host.interaction, client);
  assert.equal(client.teamManager.get('guild-1', 'message-1').status, 'cancelled');
  assert.match(host.replies.at(-1), /cancelled/);
});

test('button cannot affect a copied card in another channel', async t => {
  const { channel, client } = setup(t);
  await teamCommand.execute(commandInteraction(channel, 'create').interaction, client);
  const copied = buttonInteraction(channel, 'message-1', 'join', 'member-1', { channelId: 'other-channel' });
  await interactionCreate.execute(copied.interaction, client);
  assert.match(copied.replies.at(-1), /no longer available/);
  assert.equal(client.teamManager.get('guild-1', 'message-1').members.length, 1);
});

test('buttons keep working after the bot reloads saved teams', async t => {
  const { channel, client, file } = setup(t);
  await teamCommand.execute(commandInteraction(channel, 'create').interaction, client);
  client.teamManager = new TeamManager(file);
  const join = buttonInteraction(channel, 'message-1', 'join', 'member-1');
  await interactionCreate.execute(join.interaction, client);
  assert.equal(client.teamManager.get('guild-1', 'message-1').status, 'full');
  assert.match(join.replies.at(-1), /now full/);
});
