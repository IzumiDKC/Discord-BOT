require('dotenv').config();
const { configureYoutubeDlRuntime, ensureYoutubeDlBinary } = require('./src/utils/youtubeDlRuntime');
configureYoutubeDlRuntime();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { YoutubeiExtractor } = require('discord-player-youtubei');
const { MusicPresence } = require('./src/utils/musicPresence');
const { idleDisconnectMessage, MusicIdleManager } = require('./src/utils/musicIdle');
const { musicControls, nowPlayingEmbed, statusEmbed } = require('./src/utils/musicUi');
const { markActiveAudioPreset } = require('./src/utils/musicAudio');
const { startMusicHealth, stopMusicHealth } = require('./src/utils/musicHealth');
const { MusicLibrary } = require('./src/utils/musicLibrary');
const { SmartDj } = require('./src/utils/smartDj');
const { createYoutubeDlStream } = require('./src/utils/smartMusicBridge');
const { TeamManager } = require('./src/utils/teamManager');
const { CommunityStore } = require('./src/utils/communityStore');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection();
client.player = new Player(client);
client.musicPresence = new MusicPresence(client);
client.musicIdle = new MusicIdleManager();
client.musicLibrary = new MusicLibrary();
client.smartDj = new SmartDj(client);
client.teamManager = new TeamManager();
client.communityStore = new CommunityStore();

function saveQueue(queue) {
  client.musicLibrary.updateQueue(queue.guild.id, queue).catch(error => console.error('[Music Library]', error));
}

require('./src/handlers/commandHandler')(client);
require('./src/handlers/eventHandler')(client);

process.on('unhandledRejection', err => console.error('[Unhandled Rejection]', err));
process.on('uncaughtException', err => console.error('[Uncaught Exception]', err));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] Received ${signal}, cleaning up...`);
  try {
    for (const queue of client.player.nodes.cache.values()) {
      stopMusicHealth(queue);
      client.musicIdle.cancel(queue);
      queue.delete();
    }
    await Promise.allSettled([
      client.musicLibrary.pending,
      client.teamManager.pending,
      client.communityStore.pending,
    ]);
    client.destroy();
  } finally {
    process.exit(0);
  }
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
  await ensureYoutubeDlBinary().catch(error => {
    console.warn('[yt-dlp] Startup binary check failed:', error.message);
  });
  await client.player.extractors.loadMulti(DefaultExtractors);
  await client.player.extractors.register(YoutubeiExtractor, {
    useYoutubeDL: false,
    disablePlayer: true,
    logLevel: 'LOW',
    slicePlaylist: false,
    createStream: track => createYoutubeDlStream(track),
    streamOptions: {
      useClient: 'WEB',
      highWaterMark: 1 << 25,
    },
  });

  client.player.events.on('connection', queue => startMusicHealth(queue));

  client.player.events.on('playerStart', (queue, track) => {
    startMusicHealth(queue);
    client.smartDj.markPlaying(queue.guild.id);
    markActiveAudioPreset(queue);
    client.musicIdle.cancel(queue);
    client.musicPresence.setPlaying(queue.guild.id, track);
    client.musicLibrary.recordStarted(queue.guild.id, track, queue)
      .catch(error => console.error('[Music Library]', error));
    queue.metadata?.channel?.send({
      embeds: [nowPlayingEmbed(queue, track)],
      components: musicControls(),
    }).catch(() => {});
  });

  client.player.events.on('audioTrackAdd', saveQueue);
  client.player.events.on('audioTracksAdd', saveQueue);

  client.player.events.on('playerPause', queue => {
    client.musicPresence.setPaused(queue.guild.id, true);
  });

  client.player.events.on('playerResume', queue => {
    client.musicPresence.setPaused(queue.guild.id, false);
  });

  client.player.events.on('emptyQueue', async queue => {
    if (queue.currentTrack) return;
    if (await client.smartDj.refill(queue)) return;
    if (queue.currentTrack || !queue.isEmpty()) return;
    await client.musicLibrary.clearQueue(queue.guild.id)
      .catch(error => console.error('[Music Library]', error));
    client.musicPresence.clear(queue.guild.id);
    client.musicIdle.schedule(queue);
    queue.metadata?.channel?.send({
      embeds: [statusEmbed('🌙 Hàng chờ đã hết', idleDisconnectMessage(), 0x2B2D31)],
    }).catch(() => {});
  });

  client.player.events.on('queueDelete', queue => {
    stopMusicHealth(queue);
    client.musicIdle.cancel(queue);
    client.musicPresence.clear(queue.guild.id);
  });

  client.player.events.on('disconnect', queue => {
    stopMusicHealth(queue);
    client.musicIdle.cancel(queue);
    client.musicPresence.clear(queue.guild.id);
  });

  client.player.events.on('playerError', (queue, error, track) => {
    console.error('[Music Player Error]', error);
    client.smartDj.markFailed(queue.guild.id, track);
    queue.metadata?.channel?.send({
      embeds: [statusEmbed(
        '⚠️ Không phát được bài này',
        `Mình đã bỏ qua **${track?.cleanTitle || track?.title || 'bài hiện tại'}** và sẽ thử bài tiếp theo.`,
        0xFEE75C
      )],
    }).catch(() => {});
  });

  client.player.events.on('error', (queue, error) => {
    console.error('[Music Queue Error]', error);
    queue.metadata?.channel?.send({
      embeds: [statusEmbed('❌ Hàng chờ gặp lỗi', 'Thử lại bằng `/play`. Nếu lỗi lặp lại, hãy gửi một link cụ thể.', 0xED4245)],
    }).catch(() => {});
  });

  await client.login(process.env.DISCORD_TOKEN);
})();
