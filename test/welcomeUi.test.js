const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const { CommunityStore } = require('../src/utils/communityStore');
const { safeSelfRole } = require('../src/utils/welcomeUi');
const interactionCreate = require('../src/events/interactionCreate');
const guildMemberAdd = require('../src/events/guildMemberAdd');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discordbot-welcome-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new CommunityStore(path.join(dir, 'community.json'));
  const assigned = new Set();
  const role = {
    id: 'role1', name: 'Gamer', managed: false,
    permissions: { has: () => false },
  };
  const member = {
    id: 'user1', user: { id: 'user1', username: 'Alice', bot: false },
    roles: {
      cache: { has: id => assigned.has(id) },
      add: async id => assigned.add(id),
      remove: async id => assigned.delete(id),
    },
  };
  const sent = [];
  const channel = { isTextBased: () => true, send: async payload => sent.push(payload) };
  const guild = {
    id: 'guild1', name: 'Familia', memberCount: 42,
    roles: { cache: new Map([['role1', role]]), fetch: async () => role },
    members: {
      me: { permissions: { has: bit => bit === PermissionFlagsBits.ManageRoles }, roles: { highest: { comparePositionTo: () => 1 } } },
      fetch: async () => member,
    },
    channels: { cache: new Map([['channel1', channel]]), fetch: async () => channel },
  };
  role.guild = guild;
  member.guild = guild;
  return { store, assigned, role, member, guild, sent };
}

test('welcome card sends with role buttons and self-role toggles', async t => {
  const { store, assigned, member, guild, sent } = setup(t);
  await store.setWelcome('guild1', { channelId: 'channel1', roleIds: ['role1'] });
  const client = { communityStore: store };
  await guildMemberAdd.execute(member, client);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].files[0].name, 'welcome.png');
  assert.equal(sent[0].components[0].components[0].data.custom_id, 'welcome:role:role1');

  const replies = [];
  const interaction = {
    customId: 'welcome:role:role1', guildId: 'guild1', guild, user: member.user,
    isStringSelectMenu: () => false, isChatInputCommand: () => false, isButton: () => true,
    deferReply: async () => { interaction.deferred = true; },
    editReply: async value => replies.push(value),
  };
  await interactionCreate.execute(interaction, client);
  assert.ok(assigned.has('role1'));
  await interactionCreate.execute(interaction, client);
  assert.ok(!assigned.has('role1'));
  assert.match(replies[0], /Added/);
  assert.match(replies[1], /Removed/);
});

test('privileged, managed and out-of-reach roles are never self-assignable', async t => {
  const { store, role, guild, member } = setup(t);
  role.permissions.has = bit => bit === PermissionFlagsBits.Administrator;
  assert.equal(await safeSelfRole(guild, role), false);
  role.permissions.has = () => false;
  role.managed = true;
  assert.equal(await safeSelfRole(guild, role), false);
  role.managed = false;
  guild.members.me.roles.highest.comparePositionTo = () => -1;
  assert.equal(await safeSelfRole(guild, role), false);
  guild.members.me.roles.highest.comparePositionTo = () => 1;
  await store.setWelcome('guild1', { channelId: 'channel1', roleIds: ['role1'] });
  role.permissions.has = bit => bit === PermissionFlagsBits.Administrator;
  const replies = [];
  await interactionCreate.execute({
    customId: 'welcome:role:role1', guildId: 'guild1', guild, user: member.user,
    isStringSelectMenu: () => false, isChatInputCommand: () => false, isButton: () => true,
    deferReply: async () => {}, editReply: async value => replies.push(value),
  }, { communityStore: store });
  assert.match(replies[0], /no longer available/);
});
