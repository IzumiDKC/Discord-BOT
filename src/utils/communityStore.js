const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const FRAMES = ['default', 'mint', 'sunset', 'champion'];
const TITLES = ['Rookie', 'Regular', 'Team Builder', 'Season Star'];
const BADGES = [
  { id: 'first_team', name: 'First Team', test: member => member.hosted + member.joined >= 1 },
  { id: 'team_builder', name: 'Team Builder', test: member => member.hosted >= 3 },
  { id: 'squadmate', name: 'Squadmate', test: member => member.joined >= 5 },
  { id: 'streak_7', name: '7-Day Streak', test: member => member.bestStreak >= 7 },
  { id: 'season_star', name: 'Season Star', test: member => member.xp >= 1000 },
];

function dayKey(now = Date.now()) {
  return new Date(now + 7 * 60 * 60_000).toISOString().slice(0, 10);
}

function weekKey(now = Date.now()) {
  const local = new Date(now + 7 * 60 * 60_000);
  const weekday = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - weekday);
  return local.toISOString().slice(0, 10);
}

function previousDay(key) {
  return new Date(Date.parse(`${key}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function previousWeek(key) {
  return new Date(Date.parse(`${key}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
}

function levelFor(xp) {
  let level = 1;
  let floor = 0;
  let next = 100;
  while (xp >= next) {
    floor = next;
    level++;
    next += 100 + (level - 1) * 50;
  }
  return { level, earned: xp - floor, needed: next - floor };
}

function blankMember() {
  return {
    xp: 0, weekly: {}, hosted: 0, joined: 0, voiceMinutes: 0,
    voiceDay: null, voiceCreditedToday: 0, dailyDate: null,
    streak: 0, bestStreak: 0, frame: 'default', title: 'Rookie',
    awardedTeams: [],
  };
}

function unlocked(member) {
  const badges = BADGES.filter(badge => badge.test(member)).map(badge => badge.id);
  return {
    badges,
    frames: [FRAMES[0], ...(badges.includes('first_team') ? ['mint'] : []),
      ...(badges.includes('streak_7') ? ['sunset'] : []),
      ...(badges.includes('season_star') ? ['champion'] : [])],
    titles: [TITLES[0], ...(member.xp >= 250 ? ['Regular'] : []),
      ...(badges.includes('team_builder') ? ['Team Builder'] : []),
      ...(badges.includes('season_star') ? ['Season Star'] : [])],
  };
}

function copy(value) {
  return structuredClone(value);
}

class CommunityStore {
  constructor(file = path.join(__dirname, '..', '..', 'data', 'community.json')) {
    this.file = file;
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, guilds: {} };
    if (this.data.version !== 1 || !this.data.guilds || typeof this.data.guilds !== 'object') {
      throw new Error('Unsupported community data format; the original file was not modified.');
    }
    this.pending = Promise.resolve();
    this.voiceSessions = new Map();
  }

  async change(operation) {
    const next = this.pending.then(async () => {
      const before = copy(this.data);
      try {
        const { result, changed } = operation();
        if (changed) {
          const temp = `${this.file}.${process.pid}.tmp`;
          await fsp.mkdir(path.dirname(this.file), { recursive: true });
          await fsp.writeFile(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
          await fsp.rename(temp, this.file);
        }
        return result;
      } catch (error) {
        this.data = before;
        throw error;
      }
    });
    this.pending = next.catch(() => {});
    return next;
  }

  guild(guildId) {
    return this.data.guilds[guildId] ||= {
      members: {}, welcome: { channelId: null, roleIds: [] },
      season: { channelId: null, lastPostedWeek: null },
    };
  }

  member(guildId, userId) {
    return this.guild(guildId).members[userId] ||= blankMember();
  }

  profile(guildId, userId) {
    const member = this.data.guilds[guildId]?.members[userId] || blankMember();
    return { ...copy(member), userId, level: levelFor(member.xp), unlocked: unlocked(member) };
  }

  welcome(guildId) {
    return copy(this.data.guilds[guildId]?.welcome || { channelId: null, roleIds: [] });
  }

  async setWelcome(guildId, config) {
    return this.change(() => {
      const guild = this.guild(guildId);
      guild.welcome = { ...guild.welcome, ...config };
      return { result: copy(guild.welcome), changed: true };
    });
  }

  season(guildId) {
    return copy(this.data.guilds[guildId]?.season || { channelId: null, lastPostedWeek: null });
  }

  async setSeason(guildId, channelId, now = Date.now()) {
    return this.change(() => {
      const guild = this.guild(guildId);
      guild.season = { channelId, lastPostedWeek: previousWeek(weekKey(now)) };
      return { result: copy(guild.season), changed: true };
    });
  }

  seasonDue(now = Date.now()) {
    const endedWeek = previousWeek(weekKey(now));
    return Object.entries(this.data.guilds)
      .filter(([, guild]) => guild.season?.channelId && guild.season.lastPostedWeek !== endedWeek)
      .map(([guildId, guild]) => ({ guildId, channelId: guild.season.channelId, week: endedWeek }));
  }

  async markSeasonPosted(guildId, week) {
    return this.change(() => {
      const season = this.guild(guildId).season;
      if (!season?.channelId || season.lastPostedWeek === week) return { result: false, changed: false };
      season.lastPostedWeek = week;
      return { result: true, changed: true };
    });
  }

  credit(member, xp, now) {
    member.xp += xp;
    const week = weekKey(now);
    member.weekly[week] = (member.weekly[week] || 0) + xp;
    for (const key of Object.keys(member.weekly).sort().slice(0, -8)) delete member.weekly[key];
  }

  async awardTeam(guildId, userId, teamId, kind, now = Date.now()) {
    return this.change(() => {
      const member = this.member(guildId, userId);
      const key = `${kind}:${teamId}`;
      if (member.awardedTeams.includes(key)) return { result: false, changed: false };
      member.awardedTeams.push(key);
      member.awardedTeams = member.awardedTeams.slice(-200);
      if (kind === 'hosted') member.hosted++;
      else if (kind === 'joined') member.joined++;
      else throw new Error('Invalid team credit');
      this.credit(member, kind === 'hosted' ? 30 : 15, now);
      return { result: true, changed: true };
    });
  }

  async claimDaily(guildId, userId, now = Date.now()) {
    return this.change(() => {
      const member = this.member(guildId, userId);
      const today = dayKey(now);
      if (member.dailyDate === today) return { result: { claimed: false, profile: this.profile(guildId, userId) }, changed: false };
      member.streak = member.dailyDate === previousDay(today) ? member.streak + 1 : 1;
      member.bestStreak = Math.max(member.bestStreak, member.streak);
      member.dailyDate = today;
      const earned = 20 + Math.min(member.streak, 7) * 5;
      this.credit(member, earned, now);
      return { result: { claimed: true, earned, profile: this.profile(guildId, userId) }, changed: true };
    });
  }

  async selectCosmetic(guildId, userId, type, value) {
    return this.change(() => {
      const member = this.member(guildId, userId);
      const allowed = unlocked(member)[type === 'frame' ? 'frames' : 'titles'];
      if (!allowed?.includes(value)) return { result: false, changed: false };
      member[type] = value;
      return { result: true, changed: true };
    });
  }

  leaderboard(guildId, week = weekKey()) {
    return Object.entries(this.data.guilds[guildId]?.members || {})
      .map(([userId, member]) => ({ userId, xp: member.weekly[week] || 0, level: levelFor(member.xp).level }))
      .filter(entry => entry.xp > 0)
      .sort((a, b) => b.xp - a.xp || a.userId.localeCompare(b.userId))
      .slice(0, 10);
  }

  async recordVoice(guildId, userId, durationMs, now = Date.now()) {
    return this.change(() => {
      const member = this.member(guildId, userId);
      const today = dayKey(now);
      if (member.voiceDay !== today) {
        member.voiceDay = today;
        member.voiceCreditedToday = 0;
      }
      const minutes = Math.min(Math.floor(durationMs / 60_000 / 10) * 10, 120 - member.voiceCreditedToday);
      if (minutes < 10) return { result: 0, changed: false };
      member.voiceMinutes += minutes;
      member.voiceCreditedToday += minutes;
      this.credit(member, minutes / 10 * 5, now);
      return { result: minutes, changed: true };
    });
  }

  async voiceState(oldState, newState, now = Date.now()) {
    const userId = newState.member?.id || oldState.member?.id;
    if (!userId || newState.member?.user?.bot || oldState.member?.user?.bot) return;
    const key = `${newState.guild.id}:${userId}`;
    if (!oldState.channelId && newState.channelId) this.voiceSessions.set(key, now);
    if (oldState.channelId && !newState.channelId) {
      const started = this.voiceSessions.get(key);
      this.voiceSessions.delete(key);
      if (started != null) await this.recordVoice(newState.guild.id, userId, now - started, now);
    }
  }
}

module.exports = { CommunityStore, BADGES, FRAMES, TITLES, dayKey, weekKey, previousWeek, levelFor, unlocked };
