require('dotenv').config();

const { Client, GatewayIntentBits, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  try {
    if (!process.env.GUILD_ID) {
      throw new Error('Missing GUILD_ID in .env');
    }

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const fullGuild = await guild.fetch();
    const everyone = fullGuild.roles.everyone;

    if (!everyone.permissions.has(PermissionFlagsBits.UseApplicationCommands)) {
      const nextPermissions = new PermissionsBitField(everyone.permissions)
        .add(PermissionFlagsBits.UseApplicationCommands);

      await everyone.setPermissions(nextPermissions, 'Allow members to see and use basic slash commands');
      console.log('Enabled Use Application Commands for @everyone.');
    } else {
      console.log('@everyone already has Use Application Commands.');
    }

    const channels = await fullGuild.channels.fetch();
    const deniedChannels = [];

    for (const [, channel] of channels) {
      if (!channel?.permissionOverwrites?.cache) continue;

      const overwrite = channel.permissionOverwrites.cache.get(everyone.id);
      if (overwrite?.deny?.has(PermissionFlagsBits.UseApplicationCommands)) {
        deniedChannels.push(channel.name);
      }
    }

    if (deniedChannels.length) {
      console.warn(`Channels denying @everyone Use Application Commands: ${deniedChannels.join(', ')}`);
    } else {
      console.log('No channel-level denies found for Use Application Commands.');
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
