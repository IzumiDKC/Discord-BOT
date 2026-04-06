const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { spawn } = require('child_process');
const play = require('play-dl');

// --- Init SoundCloud ---
let scReady = false;
(async () => {
  try {
    const clientID = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientID } });
    scReady = true;
    console.log('[SoundCloud] Client ID OK');
  } catch (e) {
    console.error('[SoundCloud] Init failed:', e.message);
  }
})();

async function waitForSC(ms = 5000) {
  if (scReady) return;
  const start = Date.now();
  while (!scReady && Date.now() - start < ms) {
    await new Promise(r => setTimeout(r, 300));
  }
}

// --- Search ---
async function searchTrack(query) {
  await waitForSC();
  try {
    const isUrl = /^https?:\/\//i.test(query);
    if (isUrl && query.includes('soundcloud.com')) {
      const info = await play.soundcloud(query);
      return { title: info.name, url: info.url, durationString: fmtDur(info.durationInSec), thumbnail: info.thumbnail || null };
    }
    const results = await play.search(query, { limit: 1, source: { soundcloud: 'tracks' } });
    if (!results?.length) return null;
    const t = results[0];
    return { title: t.name || t.title, url: t.url, durationString: fmtDur(t.durationInSec), thumbnail: t.thumbnail || null };
  } catch (err) {
    console.error('[Search Error]', err.message);
    return null;
  }
}

function fmtDur(sec) {
  if (!sec) return '0:00';
  sec = Math.floor(sec);
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
}

// --- MusicQueue ---
class MusicQueue {
  constructor(guildId) {
    this.guildId = guildId;
    this.tracks = [];
    this.current = null;
    this.connection = null;
    this.textChannel = null;
    this.loop = false;
    this._streamCleanup = null;

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });

    this.player.on('stateChange', (o, n) => console.log(`[Player] ${o.status} → ${n.status}`));
    this.player.on(AudioPlayerStatus.Idle, () => this._playNext());
    this.player.on('error', err => {
      console.error('[Player Error]', err.message);
      this._cleanupStream();
      this._playNext();
    });
  }

  async connect(voiceChannel) {
    if (this.connection) {
      try { this.connection.destroy(); } catch {}
    }

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    this.connection.on('error', err => console.error('[Voice Error]', err.message));
    this.connection.on('stateChange', (o, n) => console.log(`[Voice] ${o.status} → ${n.status}`));

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });

    // Subscribe player immediately
    this.connection.subscribe(this.player);
    console.log('[Voice] Player subscribed');

    // Wait for ready but don't fail
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
      console.log('[Voice] Ready ✓');
    } catch {
      console.warn('[Voice] Timeout waiting for Ready, current state:', this.connection.state.status);
      // If still in signalling/connecting, wait a bit more
      if (this.connection.state.status !== VoiceConnectionStatus.Ready) {
        await new Promise(r => setTimeout(r, 3000));
        console.log('[Voice] After extra wait, state:', this.connection.state.status);
      }
    }
  }

  enqueue(track) {
    this.tracks.push(track);
  }

  async play() {
    if (!this.tracks.length) return;
    this.current = this.tracks.shift();

    try {
      if (!this.connection || this.connection.state?.status === VoiceConnectionStatus.Destroyed) {
        console.error('[Play] Connection destroyed');
        if (this.textChannel) this.textChannel.send('❌ Mất kết nối voice. Dùng `/play` lại.').catch(() => {});
        queues.delete(this.guildId);
        return;
      }

      this._cleanupStream();

      console.log('[Play] Streaming:', this.current.url);

      // Use play-dl stream directly — let @discordjs/voice handle transcoding
      const pdStream = await play.stream(this.current.url);
      console.log('[Play] Stream type from play-dl:', pdStream.type);

      const resource = createAudioResource(pdStream.stream, {
        inputType: pdStream.type,
      });

      this._streamCleanup = () => {
        try { pdStream.stream.destroy(); } catch {}
      };

      console.log('[Play] Connection state:', this.connection.state.status);
      this.player.play(resource);
      console.log('[Play] Player.play() called ✓');

      if (this.textChannel) {
        const embed = new EmbedBuilder()
          .setColor(0x1DB954)
          .setTitle('▶️ Đang phát')
          .setDescription(`**[${this.current.title}](${this.current.url})**`)
          .addFields(
            { name: 'Thời lượng', value: this.current.durationString, inline: true },
            { name: 'Yêu cầu bởi', value: this.current.requester || '?', inline: true },
            { name: 'Còn trong hàng', value: `${this.tracks.length} bài`, inline: true },
          )
          .setThumbnail(this.current.thumbnail || null);
        this.textChannel.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (err) {
      console.error('[Play Error]', err);
      this._cleanupStream();
      if (this.textChannel) this.textChannel.send('❌ Không tải được nhạc, đang bỏ qua...').catch(() => {});
      this._playNext();
    }
  }

  _cleanupStream() {
    if (this._streamCleanup) {
      this._streamCleanup();
      this._streamCleanup = null;
    }
  }

  _playNext() {
    this._cleanupStream();
    if (this.loop && this.current) this.tracks.push(this.current);
    if (this.tracks.length > 0) {
      this.play();
    } else {
      this.current = null;
      if (this.textChannel) this.textChannel.send('✅ Hết hàng chờ nhạc.').catch(() => {});
    }
  }

  skip() { this.player.stop(); }
  stop() {
    this.tracks = [];
    this.loop = false;
    this._cleanupStream();
    this.player.stop();
    this.current = null;
  }
  pause() { this.player.pause(); }
  resume() { this.player.unpause(); }

  destroy() {
    this.stop();
    try { this.connection?.destroy(); } catch {}
    queues.delete(this.guildId);
  }
}

const queues = new Map();
module.exports = { MusicQueue, queues, searchTrack };
