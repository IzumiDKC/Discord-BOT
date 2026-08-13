const IDLE_DISCONNECT_MINUTES = 5;
const IDLE_DISCONNECT_MS = IDLE_DISCONNECT_MINUTES * 60_000;

class MusicIdleManager {
  constructor({
    delayMs = IDLE_DISCONNECT_MS,
    clearTimer = clearTimeout,
    setTimer = setTimeout,
  } = {}) {
    this.delayMs = delayMs;
    this.clearTimer = clearTimer;
    this.setTimer = setTimer;
    this.timers = new Map();
  }

  guildId(queueOrGuildId) {
    return typeof queueOrGuildId === 'string'
      ? queueOrGuildId
      : queueOrGuildId?.guild?.id;
  }

  cancel(queueOrGuildId) {
    const guildId = this.guildId(queueOrGuildId);
    const timer = this.timers.get(guildId);
    if (!timer) return false;

    this.clearTimer(timer);
    this.timers.delete(guildId);
    return true;
  }

  schedule(queue) {
    const guildId = this.guildId(queue);
    if (!guildId) return null;

    this.cancel(guildId);
    const timer = this.setTimer(() => {
      this.timers.delete(guildId);
      if (queue.currentTrack || !queue.isEmpty()) return;
      queue.delete();
    }, this.delayMs);

    timer?.unref?.();
    this.timers.set(guildId, timer);
    return timer;
  }
}

function idleDisconnectMessage() {
  return `Không còn nhạc trong danh sách, mình sẽ rời đi trong **${IDLE_DISCONNECT_MINUTES} phút** nếu không có bài mới.`;
}

module.exports = {
  IDLE_DISCONNECT_MINUTES,
  IDLE_DISCONNECT_MS,
  MusicIdleManager,
  idleDisconnectMessage,
};
