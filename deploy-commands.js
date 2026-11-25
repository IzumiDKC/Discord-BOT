require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in environment.');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');

for (const folder of fs.readdirSync(commandsPath)) {
  const folderPath = path.join(commandsPath, folder);
  if (!fs.statSync(folderPath).isDirectory()) continue;
  for (const file of fs.readdirSync(folderPath).filter(f => f.endsWith('.js'))) {
    const cmd = require(path.join(folderPath, file));
    if (cmd.data) commands.push(cmd.data.toJSON());
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);
    const scope = process.env.GUILD_ID ? `guild ${process.env.GUILD_ID}` : 'global';
    console.log(`🔄 Registering ${commands.length} slash commands (${scope})...`);
    await rest.put(route, { body: commands });
    console.log('✅ Slash commands registered!');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
})();
