require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { YoutubeiExtractor } = require('discord-player-youtubei');

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
    streamOptions: {
      useClient: 'WEB',
    },
  });

  client.player.events.on('playerStart', (queue, track) => {
    queue.metadata?.channel?.send(`Dang phat: **${track.cleanTitle || track.title}**`).catch(() => {});
  });

  client.player.events.on('audioTrackAdd', (queue, track) => {
    queue.metadata?.channel?.send(`Da them vao hang cho: **${track.cleanTitle || track.title}**`).catch(() => {});
  });

  client.player.events.on('audioTracksAdd', (queue, tracks) => {
    queue.metadata?.channel?.send(`Da them **${tracks.length}** bai vao hang cho.`).catch(() => {});
  });

  client.player.events.on('emptyQueue', queue => {
    queue.metadata?.channel?.send('Het hang cho nhac.').catch(() => {});
  });

  client.player.events.on('playerError', (queue, error) => {
    console.error('[Music Player Error]', error);
    queue.metadata?.channel?.send('Khong phat duoc bai nay, dang bo qua...').catch(() => {});
  });

  client.player.events.on('error', (queue, error) => {
    console.error('[Music Queue Error]', error);
    queue.metadata?.channel?.send('Co loi o hang cho nhac.').catch(() => {});
  });

  await client.login(process.env.DISCORD_TOKEN);
})();
