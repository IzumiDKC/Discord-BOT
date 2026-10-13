const sharp = require('sharp');
const { BADGES } = require('./communityStore');

const WIDTH = 1200;
const INK = '#111923';
const PANEL = '#1c2933';
const WHITE = '#f7fbf7';
const MUTED = '#a9bec3';
const MINT = '#46dfba';
const CORAL = '#ff7668';
const GOLD = '#f5c75c';
const avatarCache = new Map();

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function short(value, max = 26) {
  const chars = Array.from(String(value ?? ''));
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

function text(x, y, value, size = 30, color = WHITE, weight = 600, extra = '') {
  return `<text x="${x}" y="${y}" fill="${color}" font-family="DejaVu Sans,Arial,sans-serif" font-size="${size}" font-weight="${weight}" ${extra}>${xml(value)}</text>`;
}

function base(height, accent = MINT) {
  return `<rect width="${WIDTH}" height="${height}" fill="${INK}"/>
    <rect x="0" y="0" width="14" height="${height}" fill="${accent}"/>
    <path d="M40 80H1160 M40 ${height - 30}H1160" stroke="#34464d" stroke-width="2"/>
    <path d="M1020 0L1200 180 M1080 0L1200 120" stroke="${accent}" stroke-opacity=".18" stroke-width="28"/>
    <path d="M0 ${height - 150}L190 ${height}" stroke="${accent}" stroke-opacity=".1" stroke-width="52"/>`;
}

function svg(content, height = 630, accent = MINT) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">${base(height, accent)}${content}</svg>`;
}

async function png(markup) {
  return sharp(Buffer.from(markup), { limitInputPixels: 1_000_000 }).png().toBuffer();
}

async function avatar(user) {
  if (!user?.displayAvatarURL) return null;
  const url = user.displayAvatarURL({ extension: 'png', size: 128 });
  if (!/^https:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(url)) return null;
  const cached = avatarCache.get(url);
  if (cached && cached.until > Date.now()) return cached.data;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok || Number(response.headers.get('content-length')) > 2_000_000) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2_000_000) return null;
    const data = (await sharp(bytes, { limitInputPixels: 1_000_000 }).resize(128, 128).png().toBuffer()).toString('base64');
    if (avatarCache.size > 200) avatarCache.delete(avatarCache.keys().next().value);
    avatarCache.set(url, { data, until: Date.now() + 5 * 60_000 });
    return data;
  } catch {
    return null;
  }
}

async function resolveUsers(client, ids) {
  return Promise.all(ids.map(async id => {
    try {
      return client.users?.cache?.get(id) || await client.users?.fetch?.(id) || null;
    } catch {
      return null;
    }
  }));
}

function portrait(data, x, y, size, id, label, accent = MINT) {
  const clip = `portrait-${id}`;
  const initial = short(Array.from(label || '?')[0] || '?', 1);
  return `<defs><clipPath id="${clip}"><circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2 - 4}"/></clipPath></defs>
    <circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="${accent}"/>
    <circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2 - 4}" fill="#32464a"/>
    ${data ? `<image x="${x + 4}" y="${y + 4}" width="${size - 8}" height="${size - 8}" href="data:image/png;base64,${data}" clip-path="url(#${clip})"/>`
      : `<text x="${x + size / 2}" y="${y + size * .69}" text-anchor="middle" fill="${WHITE}" font-family="DejaVu Sans,Arial,sans-serif" font-size="${size * .53}" font-weight="700">${xml(initial)}</text>`}`;
}

function label(x, y, value, accent = MINT) {
  const visible = short(value, 14);
  return `<rect x="${x}" y="${y}" width="${Math.max(100, Math.min(250, visible.length * 17 + 30))}" height="37" rx="5" fill="${PANEL}"/>${text(x + 15, y + 26, visible, 17, accent, 700)}`;
}

async function renderTeamCard(team, users = []) {
  const data = await Promise.all(users.map(avatar));
  const closed = ['cancelled', 'expired'].includes(team.status);
  const accent = closed ? MUTED : team.status === 'full' ? GOLD : MINT;
  const state = team.status === 'full' ? 'READY' : team.status.toUpperCase();
  const game = short(team.game, 24);
  const start = team.startsAt <= team.createdAt ? 'NOW' : new Date(team.startsAt).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  let content = text(65, 57, 'COMMUNITY  /  TEAM UP', 22, accent, 700)
    + `<rect x="970" y="112" width="165" height="54" rx="6" fill="${accent}"/>`
    + text(1052, 148, state, 26, INK, 800, 'text-anchor="middle"')
    + text(65, 163, game, Array.from(game).length > 18 ? 39 : 52, WHITE, 800)
    + label(65, 190, `RANK  ${team.rank || 'Any'}`)
    + label(330, 190, `ROLE  ${team.role || 'Any'}`, CORAL)
    + label(65, 244, `START  ${start}`, GOLD)
    + text(1130, 268, `${team.members.length} / ${team.slots} PLAYERS`, 25, accent, 700, 'text-anchor="end"');

  for (let i = 0; i < team.slots; i++) {
    const x = 65 + (i % 5) * 221;
    const y = (team.slots <= 5 ? 345 : 289) + Math.floor(i / 5) * 132;
    const user = users[i];
    const name = user?.globalName || user?.username || (team.members[i] ? `Player ${i + 1}` : 'Open slot');
    content += `<rect x="${x}" y="${y}" width="207" height="115" rx="6" fill="${PANEL}" stroke="${team.members[i] ? '#3c6063' : '#354148'}"/>`
      + portrait(data[i], x + 12, y + 15, 76, `team-${i}`, name, team.members[i] ? accent : '#56666b')
      + text(x + 99, y + 49, `0${i + 1}`, 18, accent, 700)
      + text(x + 99, y + 76, short(name, 10), 18, WHITE, 600);
  }
  content += text(65, 585, closed ? 'CLOSED' : team.status === 'full' ? 'SQUAD COMPLETE' : 'JOIN THE SQUAD', 21, accent, 800)
    + text(1135, 585, 'TEAM UP  /  01', 18, MUTED, 600, 'text-anchor="end"');
  return png(svg(content, 630, accent));
}

function frameColor(frame) {
  return frame === 'sunset' ? CORAL : frame === 'champion' ? GOLD : MINT;
}

async function renderProfileCard(user, profile, guildName) {
  const avatarData = await avatar(user);
  const accent = frameColor(profile.frame);
  const display = user.globalName || user.username || 'Member';
  const displayShort = short(display, 20);
  const progress = Math.min(1, profile.level.earned / profile.level.needed);
  const badges = profile.unlocked.badges.map(id => BADGES.find(badge => badge.id === id)?.name).filter(Boolean);
  let content = text(65, 57, `${short(guildName, 30)}  /  MEMBER PROFILE`, 22, accent, 700)
    + portrait(avatarData, 75, 125, 215, 'profile', display, accent)
    + text(330, 180, profile.title.toUpperCase(), 23, accent, 800)
    + text(330, 246, displayShort, Array.from(displayShort).length > 14 ? 39 : 52, WHITE, 800)
    + text(330, 297, `LEVEL ${profile.level.level}`, 27, WHITE, 700)
    + text(1105, 297, `${profile.xp} TOTAL XP`, 23, MUTED, 600, 'text-anchor="end"')
    + `<rect x="330" y="322" width="775" height="19" rx="9" fill="#354148"/>`
    + `<rect x="330" y="322" width="${Math.max(8, 775 * progress)}" height="19" rx="9" fill="${accent}"/>`
    + text(330, 374, `${profile.level.earned} / ${profile.level.needed} XP TO NEXT LEVEL`, 18, MUTED, 600)
    + `<rect x="65" y="408" width="1070" height="124" rx="7" fill="${PANEL}"/>`;
  const stats = [
    ['TEAMS HOSTED', profile.hosted], ['TEAMS JOINED', profile.joined],
    ['VOICE MINUTES', profile.voiceMinutes], ['BEST STREAK', `${profile.bestStreak} DAYS`],
  ];
  stats.forEach(([name, value], i) => {
    const x = 92 + i * 265;
    content += text(x, 446, name, 17, MUTED, 700) + text(x, 501, value, 37, i === 0 ? accent : WHITE, 800);
  });
  content += text(65, 576, 'BADGES', 20, accent, 800);
  let bx = 176;
  for (const badge of badges.slice(0, 4)) {
    const width = badge.length * 12 + 32;
    content += `<rect x="${bx}" y="545" width="${width}" height="42" rx="6" fill="${PANEL}" stroke="${accent}"/>`
      + text(bx + 16, 574, badge, 18, WHITE, 700);
    bx += width + 12;
  }
  if (!badges.length) content += text(176, 576, 'Complete quests to unlock', 18, MUTED, 500);
  return png(svg(content, 630, accent));
}

function seasonTheme(now = Date.now()) {
  const month = new Date(now + 7 * 60 * 60_000).getUTCMonth();
  if (month < 3) return { name: 'SPRING', accent: MINT };
  if (month < 6) return { name: 'SUMMER', accent: GOLD };
  if (month < 9) return { name: 'AUTUMN', accent: CORAL };
  return { name: 'WINTER', accent: '#85c9ef' };
}

async function renderWelcomeCard(user, guildName, memberCount, now = Date.now()) {
  const data = await avatar(user);
  const theme = seasonTheme(now);
  const name = user.globalName || user.username || 'New member';
  const nameShort = short(name, 20);
  const content = text(65, 57, `WELCOME  /  ${theme.name} EDITION`, 22, theme.accent, 700)
    + `<rect x="65" y="120" width="1070" height="340" rx="8" fill="${PANEL}"/>`
    + portrait(data, 105, 165, 250, 'welcome', name, theme.accent)
    + text(400, 217, 'A NEW FACE HAS ARRIVED', 24, theme.accent, 800)
    + text(400, 291, nameShort, Array.from(nameShort).length > 15 ? 36 : 51, WHITE, 800)
    + text(400, 355, `WELCOME TO ${short(guildName, 26)}`, 29, WHITE, 600)
    + text(400, 411, `MEMBER #${memberCount}`, 22, MUTED, 700)
    + text(65, 533, 'MAKE YOURSELF AT HOME', 31, WHITE, 800)
    + text(65, 577, 'PICK YOUR ROLES BELOW AND JOIN THE CONVERSATION', 20, theme.accent, 700);
  return png(svg(content, 630, theme.accent));
}

async function renderSeasonCard(entries, users, guildName, week, previous = false) {
  const data = await Promise.all(users.map(avatar));
  const heading = previous ? 'LAST WEEK RECAP' : 'THIS WEEK';
  let content = text(65, 57, `${short(guildName, 27)}  /  ${heading}`, 22, GOLD, 700)
    + text(65, 162, 'THE LEADERBOARD', 54, WHITE, 800)
    + text(65, 211, `WEEK OF ${week}   |   XP FROM TEAMS, VOICE & DAILY`, 22, MUTED, 600);
  if (!entries.length) {
    content += `<rect x="65" y="260" width="1070" height="315" rx="7" fill="${PANEL}"/>`
      + text(600, 407, 'NO ACTIVITY YET', 36, WHITE, 800, 'text-anchor="middle"')
      + text(600, 456, 'Create a team or claim /daily to get started.', 24, MUTED, 500, 'text-anchor="middle"');
  }
  entries.slice(0, 10).forEach((entry, i) => {
    const x = 65 + Math.floor(i / 5) * 545;
    const y = 245 + (i % 5) * 76;
    const user = users[i];
    const name = user?.globalName || user?.username || `Member ${i + 1}`;
    const accent = i < 3 ? [GOLD, '#c5d5da', CORAL][i] : MINT;
    content += `<rect x="${x}" y="${y}" width="525" height="65" rx="6" fill="${PANEL}"/>`
      + text(x + 22, y + 42, String(i + 1).padStart(2, '0'), 26, accent, 800)
      + portrait(data[i], x + 75, y + 8, 49, `season-${i}`, name, accent)
      + text(x + 135, y + 30, short(name, 16), 21, WHITE, 700)
      + text(x + 135, y + 52, `LV ${entry.level}`, 15, MUTED, 600)
      + text(x + 500, y + 41, `${entry.xp} XP`, 21, accent, 800, 'text-anchor="end"');
  });
  if (entries.length > 0 && entries.length <= 5) {
    const total = entries.reduce((sum, entry) => sum + entry.xp, 0);
    const leader = users[0]?.globalName || users[0]?.username || 'Member';
    content += `<rect x="610" y="245" width="525" height="369" rx="7" fill="${PANEL}"/>`
      + text(640, 293, 'WEEK AT A GLANCE', 22, GOLD, 800)
      + text(640, 353, 'TOTAL XP', 18, MUTED, 700)
      + text(640, 407, total, 46, WHITE, 800)
      + text(640, 458, 'ACTIVE MEMBERS', 18, MUTED, 700)
      + text(640, 506, entries.length, 38, WHITE, 800)
      + text(640, 558, 'WEEK LEADER', 18, MUTED, 700)
      + text(640, 592, short(leader, 22), 24, GOLD, 800);
  }
  content += text(65, 682, 'NEW WEEK. NEW CHANCE.', 19, GOLD, 700)
    + text(1135, 682, 'COMMUNITY  /  SEASON', 17, MUTED, 600, 'text-anchor="end"');
  return png(svg(content, 725, GOLD));
}

module.exports = { resolveUsers, renderTeamCard, renderProfileCard, renderWelcomeCard, renderSeasonCard, seasonTheme };
