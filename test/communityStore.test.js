const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CommunityStore, dayKey, weekKey, previousWeek, levelFor } = require('../src/utils/communityStore');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discordbot-community-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'community.json');
  return { store: new CommunityStore(file), file };
}

test('daily claims are once per Vietnam day and streak rewards unlock a frame', async t => {
  const { store, file } = setup(t);
  const firstDay = Date.parse('2026-10-05T00:00:00Z');
  assert.equal(dayKey(firstDay), '2026-10-05');
  assert.equal((await store.claimDaily('guild', 'member', firstDay)).earned, 25);
  assert.equal((await store.claimDaily('guild', 'member', firstDay + 1000)).claimed, false);
  for (let day = 1; day < 7; day++) {
    await store.claimDaily('guild', 'member', firstDay + day * 86_400_000);
  }
  const profile = store.profile('guild', 'member');
  assert.equal(profile.streak, 7);
  assert.ok(profile.unlocked.badges.includes('streak_7'));
  assert.ok(profile.unlocked.frames.includes('sunset'));
  assert.equal(await store.selectCosmetic('guild', 'member', 'frame', 'sunset'), true);
  assert.equal(new CommunityStore(file).profile('guild', 'member').frame, 'sunset');
  await store.claimDaily('guild', 'member', firstDay + 9 * 86_400_000);
  assert.equal(store.profile('guild', 'member').streak, 1);
  assert.equal(store.profile('guild', 'member').bestStreak, 7);
});

test('team awards are idempotent, cosmetics locked, and weekly ranking survives restart', async t => {
  const { store, file } = setup(t);
  const monday = Date.parse('2026-10-05T00:00:00Z');
  assert.equal(weekKey(monday), '2026-10-05');
  assert.equal(previousWeek(weekKey(monday)), '2026-09-28');
  assert.equal(await store.awardTeam('guild', 'host', 'team1', 'hosted', monday), true);
  assert.equal(await store.awardTeam('guild', 'host', 'team1', 'hosted', monday), false);
  assert.equal(await store.awardTeam('guild', 'joiner', 'team1', 'joined', monday), true);
  assert.equal(await store.selectCosmetic('guild', 'joiner', 'frame', 'champion'), false);
  await store.awardTeam('guild', 'host', 'team2', 'hosted', monday);
  await store.awardTeam('guild', 'host', 'team3', 'hosted', monday);
  assert.ok(store.profile('guild', 'host').unlocked.badges.includes('team_builder'));
  assert.equal(await store.selectCosmetic('guild', 'host', 'title', 'Team Builder'), true);
  assert.deepEqual(store.leaderboard('guild', weekKey(monday)).map(entry => entry.userId), ['host', 'joiner']);
  assert.equal(new CommunityStore(file).profile('guild', 'host').hosted, 3);
  assert.equal(levelFor(300).level, 3);
});

test('voice credit needs 10 minutes and caps at two hours per day', async t => {
  const { store } = setup(t);
  const now = Date.parse('2026-10-05T00:00:00Z');
  assert.equal(await store.recordVoice('guild', 'member', 9 * 60_000, now), 0);
  assert.equal(await store.recordVoice('guild', 'member', 130 * 60_000, now), 120);
  assert.equal(await store.recordVoice('guild', 'member', 30 * 60_000, now), 0);
  assert.equal(store.profile('guild', 'member').voiceMinutes, 120);
  assert.equal(store.profile('guild', 'member').xp, 60);
  assert.equal(await store.recordVoice('guild', 'member', 20 * 60_000, now + 86_400_000), 20);
});

test('welcome configuration persists and malformed data is not overwritten', async t => {
  const { store, file } = setup(t);
  await store.setWelcome('guild', { channelId: 'channel', roleIds: ['role'] });
  assert.deepEqual(new CommunityStore(file).welcome('guild'), { channelId: 'channel', roleIds: ['role'] });
  fs.writeFileSync(file, '{broken');
  assert.throws(() => new CommunityStore(file));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('season schedule tracks the ended week without duplicate recap after restart', async t => {
  const { store, file } = setup(t);
  const monday = Date.parse('2026-10-05T00:00:00Z');
  await store.setSeason('guild', 'channel', monday);
  assert.deepEqual(store.seasonDue(monday), []);
  const nextMonday = monday + 7 * 86_400_000;
  assert.deepEqual(store.seasonDue(nextMonday), [{ guildId: 'guild', channelId: 'channel', week: '2026-10-05' }]);
  await store.markSeasonPosted('guild', '2026-10-05');
  assert.deepEqual(new CommunityStore(file).seasonDue(nextMonday), []);
});
