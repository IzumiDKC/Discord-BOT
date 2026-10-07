const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { renderTeamCard, renderProfileCard, renderWelcomeCard, renderSeasonCard } = require('../src/utils/visualCards');
const { levelFor, unlocked } = require('../src/utils/communityStore');

async function checkImage(image, width, height) {
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.ok(image.length > 10_000);
  const stats = await sharp(image).stats();
  assert.ok(stats.channels.some(channel => channel.stdev > 20));
}

test('all four cards render useful PNGs with user-controlled XML escaped', async () => {
  const user = { id: '123', username: 'A&B <player>' };
  const team = {
    game: 'Game <Test> & Friends', rank: 'Gold', role: 'Support', slots: 5,
    members: ['123'], status: 'open', createdAt: 1_000_000, startsAt: 1_000_000,
  };
  await checkImage(await renderTeamCard(team, [user]), 1200, 630);
  const member = {
    xp: 45, hosted: 1, joined: 0, voiceMinutes: 20, bestStreak: 2,
    frame: 'mint', title: 'Rookie', level: levelFor(45),
  };
  member.unlocked = unlocked(member);
  await checkImage(await renderProfileCard(user, member, 'Server & <Friends>'), 1200, 630);
  await checkImage(await renderWelcomeCard(user, 'Server & <Friends>', 100), 1200, 630);
  await checkImage(await renderSeasonCard([{ userId: '123', xp: 45, level: 1 }], [user], 'Server', '2026-10-05'), 1200, 725);
});

test('Discord avatar bitmaps are embedded in generated cards', async () => {
  const original = global.fetch;
  const avatarPng = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#e92665' } }).png().toBuffer();
  global.fetch = async () => ({ ok: true, headers: { get: () => String(avatarPng.length) }, arrayBuffer: async () => avatarPng });
  try {
    const user = { username: 'Photo', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/123/test.png' };
    const withAvatar = await renderWelcomeCard(user, 'Server', 10);
    const withoutAvatar = await renderWelcomeCard({ username: 'Photo' }, 'Server', 10);
    assert.notDeepEqual(withAvatar, withoutAvatar);
  } finally {
    global.fetch = original;
  }
});
