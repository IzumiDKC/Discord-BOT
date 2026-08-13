const { ActivityType } = require('discord.js');

const DEFAULT_ACTIVITY = 'Anime';
const MAX_ACTIVITY_LENGTH = 100;

function truncate(value, maxLength = MAX_ACTIVITY_LENGTH) {
  const text = String(value || '').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trim()}…`;
}

function trackTitle(track) {
  return track?.cleanTitle || track?.title || 'Unknown track';
}

class MusicPresence {
  constructor(client) {
    this.client = client;
    this.guilds = new Map();
    this.sequence = 0;
  }

  setDefault() {
    this.client.user?.setPresence({
      activities: [{ name: DEFAULT_ACTIVITY, type: ActivityType.Watching }],
      status: 'online',
    });
  }

  setPlaying(guildId, track) {
    this.guilds.set(guildId, {
      paused: false,
      title: trackTitle(track),
      updatedAt: ++this.sequence,
    });
    this.refresh();
  }

  setPaused(guildId, paused) {
    const state = this.guilds.get(guildId);
    if (!state) return;
    state.paused = paused;
    state.updatedAt = ++this.sequence;
    this.refresh();
  }

  clear(guildId) {
    this.guilds.delete(guildId);
    this.refresh();
  }

  refresh() {
    const active = [...this.guilds.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];

    if (!active) return this.setDefault();

    const prefix = active.paused ? '⏸ ' : '';
    this.client.user?.setPresence({
      activities: [{
        name: truncate(`${prefix}${active.title}`),
        type: ActivityType.Listening,
      }],
      status: active.paused ? 'idle' : 'online',
    });
  }
}

module.exports = {
  DEFAULT_ACTIVITY,
  MusicPresence,
  trackTitle,
  truncate,
};
