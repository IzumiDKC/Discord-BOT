const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CommunityStore } = require('../src/utils/communityStore');
const { tickSeason } = require('../src/utils/seasonUi');

test('weekly recap posts once after a new week and retries a send failure', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discordbot-season-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new CommunityStore(path.join(dir, 'community.json'));
  const monday = Date.parse('2026-10-05T00:00:00Z');
  await store.setSeason('guild', 'channel', monday);
  await store.awardTeam('guild', 'user', 'team', 'hosted', monday);
  const sent = [];
  let fail = true;
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      if (fail) throw new Error('temporary failure');
      sent.push(payload);
    },
  };
  const client = {
    communityStore: store,
    channels: { cache: new Map([['channel', channel]]) },
    guilds: { cache: new Map([['guild', { name: 'Familia' }]]) },
  };
  const nextMonday = monday + 7 * 86_400_000;
  await tickSeason(client, nextMonday);
  assert.equal(store.seasonDue(nextMonday).length, 1);
  fail = false;
  await tickSeason(client, nextMonday);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].files[0].name, 'season.png');
  assert.equal(store.seasonDue(nextMonday).length, 0);
  await tickSeason(client, nextMonday);
  assert.equal(sent.length, 1);
});
