require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { YoutubeiExtractor } = require('discord-player-youtubei');
const { MusicPresence } = require('./src/utils/musicPresence');
const { idleDisconnectMessage, MusicIdleManager } = require('./src/utils/musicIdle');
const { musicControls, nowPlayingEmbed, statusEmbed } = require('./src/utils/musicUi');

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

require('./src/handlers/commandHandler')(client);
require('./src/handlers/eventHandler')(client);

// Prevent crash on unhandled errors
process.on('unhandledRejection', err => console.error('[Unhandled Rejection]', err));
process.on('uncaughtException', err => console.error('[Uncaught Exception]', err));

(async () => {
  await client.player.extractors.loadMulti(DefaultExtractors);
  await client.player.extractors.register(YoutubeiExtractor, {
    useYoutubeDL: true,
    disablePlayer: true,
    logLevel: 'LOW',
    slicePlaylist: false,
    streamOptions: {
      useClient: 'WEB',
      highWaterMark: 1 << 25,
    },
  });

  client.player.events.on('playerStart', (queue, track) => {
    client.musicIdle.cancel(queue);
    client.musicPresence.setPlaying(queue.guild.id, track);
    queue.metadata?.channel?.send({
      embeds: [nowPlayingEmbed(queue, track)],
      components: musicControls(),
    }).catch(() => {});
  });

  client.player.events.on('playerPause', queue => {
    client.musicPresence.setPaused(queue.guild.id, true);
  });

  client.player.events.on('playerResume', queue => {
    client.musicPresence.setPaused(queue.guild.id, false);
  });

  client.player.events.on('emptyQueue', queue => {
    if (queue.currentTrack) return;
    client.musicPresence.clear(queue.guild.id);
    client.musicIdle.schedule(queue);
    queue.metadata?.channel?.send({
      embeds: [statusEmbed('🌙 Hàng chờ đã hết', idleDisconnectMessage(), 0x2B2D31)],
    }).catch(() => {});
  });

  client.player.events.on('queueDelete', queue => {
    client.musicIdle.cancel(queue);
    client.musicPresence.clear(queue.guild.id);
  });

  client.player.events.on('disconnect', queue => {
    client.musicIdle.cancel(queue);
    client.musicPresence.clear(queue.guild.id);
  });

  client.player.events.on('playerError', (queue, error, track) => {
    console.error('[Music Player Error]', error);
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
