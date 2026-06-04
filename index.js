require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { YoutubeiExtractor } = require('discord-player-youtubei');

const MUSIC_BITRATE = 128_000;

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

require('./src/handlers/commandHandler')(client);
require('./src/handlers/eventHandler')(client);

// Prevent crash on unhandled errors
process.on('unhandledRejection', err => console.error('[Unhandled Rejection]', err));
process.on('uncaughtException', err => console.error('[Uncaught Exception]', err));

(async () => {
  await client.player.extractors.loadMulti(DefaultExtractors);
  await client.player.extractors.register(YoutubeiExtractor, {
    useYoutubeDL: true,
    logLevel: 'LOW',
    streamOptions: {
      useClient: 'WEB',
      highWaterMark: 1 << 25,
    },
  });

  client.player.events.on('playerStart', (queue, track) => {
    try {
      queue.node.setBitrate(MUSIC_BITRATE);
    } catch (err) {
      console.warn('[Music Bitrate Warning]', err.message);
    }
    queue.metadata?.channel?.send(`Now playing: **${track.cleanTitle || track.title}**`).catch(() => {});
  });

  client.player.events.on('audioTrackAdd', (queue, track) => {
    queue.metadata?.channel?.send(`Added to queue: **${track.cleanTitle || track.title}**`).catch(() => {});
  });

  client.player.events.on('audioTracksAdd', (queue, tracks) => {
    queue.metadata?.channel?.send(`Added **${tracks.length}** tracks to the queue.`).catch(() => {});
  });

  client.player.events.on('emptyQueue', queue => {
    if (queue.currentTrack) return;
    queue.metadata?.channel?.send('The music queue is empty.').catch(() => {});
  });

  client.player.events.on('playerError', (queue, error) => {
    console.error('[Music Player Error]', error);
    queue.metadata?.channel?.send('Could not play this track, skipping...').catch(() => {});
  });

  client.player.events.on('error', (queue, error) => {
    console.error('[Music Queue Error]', error);
    queue.metadata?.channel?.send('A music queue error occurred.').catch(() => {});
  });

  await client.login(process.env.DISCORD_TOKEN);
})();
