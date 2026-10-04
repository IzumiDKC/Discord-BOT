const { randomBytes } = require('node:crypto');

const sessions = new Map();
const TTL_MS = 2 * 60_000;

function createAlternativeSession({ guildId, userId, currentTrack, candidates }) {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
  if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
  const id = randomBytes(10).toString('hex');
  sessions.set(id, {
    guildId,
    userId,
    currentTrack,
    candidates,
    expiresAt: now + TTL_MS,
  });
  return id;
}

function takeAlternative(sessionId, index, { guildId, userId, currentTrack }) {
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return { error: 'This selection expired. Run `/music alternatives` again.' };
  }
  if (session.guildId !== guildId || session.userId !== userId) {
    return { error: 'Only the person who opened this menu can use it.' };
  }
  if (session.currentTrack !== currentTrack) {
    sessions.delete(sessionId);
    return { error: 'The playing track has changed. Run `/music alternatives` again.' };
  }
  const candidate = session.candidates[Number(index)];
  if (!candidate || !Number.isInteger(Number(index))) return { error: 'Invalid selection.' };
  sessions.delete(sessionId);
  return { candidate };
}

module.exports = { createAlternativeSession, takeAlternative };
