const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { refreshTeamMessage, sendStartReminder } = require('./teamUi');

const MAX_TEAMS_PER_GUILD = 30;
const TEAM_DURATION_MS = 2 * 60 * 60 * 1000;
const RETAIN_CLOSED_MS = 30 * 24 * 60 * 60 * 1000;

function buildTeam({ guildId, channelId, hostId, game, rank = '', role = '', slots = 5, startsIn = 0 }, now = Date.now()) {
  const cleanGame = String(game || '').trim();
  const cleanRank = String(rank || '').trim();
  const cleanRole = String(role || '').trim();
  if (cleanGame.length < 2 || cleanGame.length > 60) throw new Error('Game must be 2-60 characters.');
  if (cleanRank.length > 40 || cleanRole.length > 40) throw new Error('Rank and role must be at most 40 characters.');
  if (!Number.isInteger(slots) || slots < 2 || slots > 10) throw new Error('Team size must be 2-10.');
  if (!Number.isInteger(startsIn) || startsIn < 0 || startsIn > 10080) {
    throw new Error('Start time must be 0-10080 minutes from now.');
  }
  const startsAt = now + startsIn * 60_000;
  return {
    guildId,
    channelId,
    hostId,
    game: cleanGame,
    rank: cleanRank,
    role: cleanRole,
    slots,
    startsAt,
    expiresAt: startsAt + TEAM_DURATION_MS,
    createdAt: now,
    members: [hostId],
    status: 'open',
    remindedAt: startsIn ? null : now,
    closedAt: null,
  };
}

function isLive(team, now = Date.now()) {
  return ['open', 'full'].includes(team?.status) && team.expiresAt > now;
}

function copy(value) {
  return structuredClone(value);
}

class TeamManager {
  constructor(file = path.join(__dirname, '..', '..', 'data', 'teams.json')) {
    this.file = file;
    this.data = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : { version: 1, teams: {} };
    if (this.data.version !== 1 || !this.data.teams || typeof this.data.teams !== 'object') {
      throw new Error('Unsupported team data format; the original file was not modified.');
    }
    this.pending = Promise.resolve();
    this.tickRunning = false;
    this.timer = null;
  }

  async write() {
    const temp = `${this.file}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fsp.rename(temp, this.file);
  }

  change(operation) {
    const pending = this.pending.then(async () => {
      const before = copy(this.data);
      try {
        const { result, changed } = operation();
        if (changed) await this.write();
        return result;
      } catch (error) {
        this.data = before;
        throw error;
      }
    });
    this.pending = pending.catch(() => {});
    return pending;
  }

  get(guildId, messageId) {
    const team = this.data.teams[messageId];
    return team?.guildId === guildId ? copy(team) : null;
  }

  list(guildId, now = Date.now()) {
    return Object.values(this.data.teams)
      .filter(team => team.guildId === guildId && isLive(team, now))
      .sort((left, right) => left.startsAt - right.startsAt)
      .map(copy);
  }

  async create(team, messageId, now = Date.now()) {
    return this.change(() => {
      if (Object.values(this.data.teams).some(existing => isLive(existing, now) && existing.hostId === team.hostId && existing.guildId === team.guildId)) {
        throw new Error('You already have an active team. Cancel it before creating another.');
      }
      if (this.list(team.guildId, now).length >= MAX_TEAMS_PER_GUILD) {
        throw new Error('This server already has 30 active teams.');
      }
      if (this.data.teams[messageId]) throw new Error('This team message is already registered.');
      const saved = { ...copy(team), id: messageId };
      this.data.teams[messageId] = saved;
      return { result: copy(saved), changed: true };
    });
  }

  async join(guildId, messageId, userId, now = Date.now()) {
    return this.change(() => {
      const team = this.data.teams[messageId];
      if (!team || team.guildId !== guildId) return { result: { code: 'not_found' }, changed: false };
      if (team.status === 'cancelled' || team.status === 'expired' || team.expiresAt <= now) {
        return { result: { code: 'closed', team: copy(team) }, changed: false };
      }
      if (team.members.includes(userId)) return { result: { code: 'already_joined', team: copy(team) }, changed: false };
      if (team.members.length >= team.slots) return { result: { code: 'full', team: copy(team) }, changed: false };
      team.members.push(userId);
      team.status = team.members.length === team.slots ? 'full' : 'open';
      return { result: { code: 'joined', team: copy(team) }, changed: true };
    });
  }

  async leave(guildId, messageId, userId, now = Date.now()) {
    return this.change(() => {
      const team = this.data.teams[messageId];
      if (!team || team.guildId !== guildId) return { result: { code: 'not_found' }, changed: false };
      if (!isLive(team, now)) return { result: { code: 'closed', team: copy(team) }, changed: false };
      if (team.hostId === userId) return { result: { code: 'host', team: copy(team) }, changed: false };
      const index = team.members.indexOf(userId);
      if (index < 0) return { result: { code: 'not_joined', team: copy(team) }, changed: false };
      team.members.splice(index, 1);
      team.status = 'open';
      return { result: { code: 'left', team: copy(team) }, changed: true };
    });
  }

  async cancel(guildId, messageId, userId, isStaff = false, now = Date.now()) {
    return this.change(() => {
      const team = this.data.teams[messageId];
      if (!team || team.guildId !== guildId) return { result: { code: 'not_found' }, changed: false };
      if (!isLive(team, now)) return { result: { code: 'closed', team: copy(team) }, changed: false };
      if (team.hostId !== userId && !isStaff) return { result: { code: 'forbidden', team: copy(team) }, changed: false };
      team.status = 'cancelled';
      team.closedAt = now;
      return { result: { code: 'cancelled', team: copy(team) }, changed: true };
    });
  }

  async expireDue(now = Date.now()) {
    return this.change(() => {
      const expired = [];
      let changed = false;
      for (const [id, team] of Object.entries(this.data.teams)) {
        if (['open', 'full'].includes(team.status) && team.expiresAt <= now) {
          team.status = 'expired';
          team.closedAt = now;
          expired.push(copy(team));
          changed = true;
        }
        if (team.closedAt && now - team.closedAt > RETAIN_CLOSED_MS) {
          delete this.data.teams[id];
          changed = true;
        }
      }
      return { result: expired, changed };
    });
  }

  remindersDue(now = Date.now()) {
    return Object.values(this.data.teams)
      .filter(team => isLive(team, now) && !team.remindedAt && team.startsAt <= now)
      .map(copy);
  }

  async markReminded(messageId, now = Date.now()) {
    return this.change(() => {
      const team = this.data.teams[messageId];
      if (!team || team.remindedAt || !isLive(team, now)) return { result: false, changed: false };
      team.remindedAt = now;
      return { result: true, changed: true };
    });
  }

  async tick(client, now = Date.now()) {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      for (const team of await this.expireDue(now)) {
        await refreshTeamMessage(client, team).catch(error => console.warn('[Team] Could not update expired card:', error.message));
      }
      for (const team of this.remindersDue(now)) {
        const latest = this.get(team.guildId, team.id);
        if (!isLive(latest, now) || latest.remindedAt) continue;
        try {
          await sendStartReminder(client, latest);
          await this.markReminded(team.id, now);
        } catch (error) {
          console.warn('[Team] Could not send start reminder:', error.message);
        }
      }
    } finally {
      this.tickRunning = false;
    }
  }

  startTicker(client) {
    if (this.timer) return;
    this.tick(client).catch(error => console.error('[Team Tick]', error));
    this.timer = setInterval(() => this.tick(client).catch(error => console.error('[Team Tick]', error)), 60_000);
    this.timer.unref?.();
  }
}

module.exports = { TeamManager, buildTeam, isLive };
