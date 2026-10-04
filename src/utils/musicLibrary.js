const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_FAVORITES = 200;
const MAX_PLAYLISTS = 20;
const MAX_PLAYLIST_TRACKS = 25;
const MAX_HISTORY = 100;
const MAX_SNAPSHOT = 50;
const MAX_FAQ = 30;

function songFromTrack(track) {
  track = track?.bridgedTrack || track;
  if (!track?.url || !/^https?:\/\//i.test(track.url)) return null;
  return {
    title: String(track.cleanTitle || track.title || 'Unknown track').slice(0, 200),
    author: String(track.author || '').slice(0, 100),
    url: String(track.url).slice(0, 600),
    source: String(track.source || 'unknown').slice(0, 30),
    duration: String(track.duration || '').slice(0, 20),
  };
}

function keyForSong(song) {
  try {
    const url = new URL(song.url);
    if (url.hostname.endsWith('youtube.com') || url.hostname === 'youtu.be') {
      return url.searchParams.get('v') || url.pathname.split('/').filter(Boolean)[0] || song.url;
    }
    return `${url.hostname}${url.pathname}`;
  } catch {
    return song.url;
  }
}

function copy(value) {
  return structuredClone(value);
}

function playlistKey(name) {
  return `p:${name.trim().toLowerCase()}`;
}

function faqKey(question) {
  return `q:${question.trim().toLowerCase()}`;
}

class MusicLibrary {
  constructor(file = path.join(__dirname, '..', '..', 'data', 'music-library.json')) {
    this.file = file;
    this.data = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : { version: 1, users: {}, guilds: {} };
    if (this.data.version !== 1 || !this.data.users || !this.data.guilds) {
      throw new Error('Unsupported music library format; the original file was not modified.');
    }
    this.pending = Promise.resolve();
  }

  save() {
    const contents = JSON.stringify(this.data, null, 2);
    const tempFile = `${this.file}.${process.pid}.tmp`;
    this.pending = this.pending.catch(() => {}).then(async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await fsp.writeFile(tempFile, contents, { mode: 0o600 });
      await fsp.rename(tempFile, this.file);
    });
    return this.pending;
  }

  user(id) {
    return this.data.users[id] ||= { favorites: [], playlists: {} };
  }

  guild(id) {
    return this.data.guilds[id] ||= { history: [], snapshot: [], faq: {} };
  }

  favorites(userId) {
    return copy(this.user(userId).favorites);
  }

  async addFavorite(userId, track) {
    const song = songFromTrack(track);
    if (!song) throw new Error('This track has no reusable link.');
    const favorites = this.user(userId).favorites;
    if (favorites.some(item => keyForSong(item) === keyForSong(song))) return false;
    favorites.unshift(song);
    favorites.splice(MAX_FAVORITES);
    await this.save();
    return true;
  }

  async removeFavorite(userId, index) {
    if (!Number.isInteger(index) || index < 0) return null;
    const removed = this.user(userId).favorites.splice(index, 1)[0];
    if (removed) await this.save();
    return removed || null;
  }

  playlists(userId) {
    return copy(this.user(userId).playlists);
  }

  async savePlaylist(userId, name, tracks) {
    const playlists = this.user(userId).playlists;
    const key = playlistKey(name);
    if (!key || key.length > 40) throw new Error('Playlist name must be 1-40 characters.');
    if (!playlists[key] && Object.keys(playlists).length >= MAX_PLAYLISTS) {
      throw new Error(`You can save up to ${MAX_PLAYLISTS} playlists.`);
    }
    const songs = tracks.map(songFromTrack).filter(Boolean).slice(0, MAX_PLAYLIST_TRACKS);
    if (!songs.length) throw new Error('There are no reusable tracks to save.');
    playlists[key] = { name: name.trim(), tracks: songs };
    await this.save();
    return copy(playlists[key]);
  }

  async deletePlaylist(userId, name) {
    const key = playlistKey(name);
    if (!this.user(userId).playlists[key]) return false;
    delete this.user(userId).playlists[key];
    await this.save();
    return true;
  }

  history(guildId) {
    return copy(this.guild(guildId).history);
  }

  snapshot(guildId) {
    return copy(this.guild(guildId).snapshot);
  }

  async recordStarted(guildId, track, queue) {
    const song = songFromTrack(track);
    if (song) {
      const history = this.guild(guildId).history;
      history.unshift({ ...song, playedAt: new Date().toISOString() });
      history.splice(MAX_HISTORY);
    }
    await this.updateQueue(guildId, queue);
  }

  async updateQueue(guildId, queue) {
    const tracks = [queue?.currentTrack, ...(queue?.tracks?.toArray?.() || [])];
    this.guild(guildId).snapshot = tracks.map(songFromTrack).filter(Boolean).slice(0, MAX_SNAPSHOT);
    await this.save();
  }

  async clearQueue(guildId) {
    this.guild(guildId).snapshot = [];
    await this.save();
  }

  faq(guildId) {
    return copy(this.guild(guildId).faq);
  }

  async setFaq(guildId, question, answer) {
    const entries = this.guild(guildId).faq;
    const key = faqKey(question);
    if (!key || key.length > 100 || !answer.trim() || answer.length > 1000) {
      throw new Error('FAQ question must be 1-100 characters and answer 1-1000 characters.');
    }
    if (!entries[key] && Object.keys(entries).length >= MAX_FAQ) {
      throw new Error(`This server can save up to ${MAX_FAQ} FAQs.`);
    }
    entries[key] = { question: question.trim(), answer: answer.trim() };
    await this.save();
  }

  async deleteFaq(guildId, question) {
    const key = faqKey(question);
    if (!this.guild(guildId).faq[key]) return false;
    delete this.guild(guildId).faq[key];
    await this.save();
    return true;
  }
}

module.exports = { MusicLibrary, keyForSong, playlistKey, songFromTrack, MAX_PLAYLIST_TRACKS, MAX_SNAPSHOT };
