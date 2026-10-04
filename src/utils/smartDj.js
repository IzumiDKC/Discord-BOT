const { QueryType } = require('discord-player');
const { keyForSong } = require('./musicLibrary');
const { playMusicRequest } = require('./musicRequest');

const MAX_DURATION_MS = 12 * 60_000;

function djQueries(mood, favorite) {
  const cleanMood = mood.trim().slice(0, 60);
  return [
    `${cleanMood} official audio`,
    favorite?.author ? `${cleanMood} ${favorite.author} music` : `${cleanMood} songs`,
    `${cleanMood} new music`,
  ];
}

function chooseDjTrack(results, blocked) {
  return results.find(track => {
    if (!track?.url || !/^https?:\/\//i.test(track.url) || track.metadata?.live) return false;
    const duration = track.durationMS || 0;
    return duration >= 60_000 && duration <= MAX_DURATION_MS && !blocked.has(keyForSong(track));
  }) || null;
}

class SmartDj {
  constructor(client) {
    this.client = client;
    this.states = new Map();
  }

  start({ guildId, voiceChannel, textChannel, requester, mood }) {
    this.states.set(guildId, {
      voiceChannelId: voiceChannel.id,
      textChannel,
      requester,
      mood: mood.trim().slice(0, 60),
      busy: false,
      failures: 0,
      failedTracks: new Set(),
    });
  }

  stop(guildId) {
    return this.states.delete(guildId);
  }

  status(guildId) {
    const state = this.states.get(guildId);
    return state ? { mood: state.mood, voiceChannelId: state.voiceChannelId } : null;
  }

  markPlaying(guildId) {
    const state = this.states.get(guildId);
    if (state) state.failures = 0;
  }

  markFailed(guildId, track) {
    const state = this.states.get(guildId);
    if (!state) return;
    if (track?.url) state.failedTracks.add(keyForSong(track));
    state.failures += 1;
    if (state.failures >= 3) {
      this.stop(guildId);
      state.textChannel?.send('Smart DJ paused after three playback errors. Use `/dj start` to try again.').catch(() => {});
    }
  }

  async refill(queue) {
    const guildId = queue.guild.id;
    const state = this.states.get(guildId);
    if (!state || state.busy || queue.currentTrack || !queue.isEmpty()) return false;
    const voiceChannel = queue.guild.channels.cache.get(state.voiceChannelId);
    if (!voiceChannel || queue.channel?.id !== state.voiceChannelId) return false;

    state.busy = true;
    try {
      const history = this.client.musicLibrary.history(guildId);
      const blocked = new Set(history.slice(0, 40).map(keyForSong));
      for (const key of state.failedTracks) blocked.add(key);
      const favorites = this.client.musicLibrary.favorites(state.requester.id);
      const favorite = favorites.length ? favorites[Math.floor(Math.random() * favorites.length)] : null;
      let selected = null;
      for (const query of djQueries(state.mood, favorite)) {
        const search = await this.client.player.search(query, {
          requestedBy: state.requester,
          searchEngine: QueryType.YOUTUBE_SEARCH,
        });
        selected = chooseDjTrack(search.tracks || [], blocked);
        if (selected) break;
      }
      if (!selected) throw new Error('No fresh track found for this mood.');
      if (this.states.get(guildId) !== state || queue.currentTrack || !queue.isEmpty()) return false;

      await playMusicRequest({
        client: this.client,
        voiceChannel,
        textChannel: state.textChannel,
        requester: state.requester,
        query: selected.url,
      });
      return true;
    } catch (error) {
      console.warn('[Smart DJ]', error);
      state.failures += 1;
      if (state.failures >= 3) {
        this.stop(guildId);
        state.textChannel?.send('Smart DJ paused after three failed searches. Use `/dj start` to try again.').catch(() => {});
      }
      return false;
    } finally {
      state.busy = false;
    }
  }
}

module.exports = { SmartDj, chooseDjTrack, djQueries };
