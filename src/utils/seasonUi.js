const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { renderSeasonCard, resolveUsers } = require('./visualCards');

async function seasonPayload(client, guildId, guildName, week, previous = false) {
  const entries = client.communityStore.leaderboard(guildId, week);
  const users = await resolveUsers(client, entries.map(entry => entry.userId));
  try {
    const image = await renderSeasonCard(entries, users, guildName, week, previous);
    return {
      embeds: [new EmbedBuilder().setColor(0xF5C75C).setImage('attachment://season.png')],
      files: [new AttachmentBuilder(image, { name: 'season.png' })],
      allowedMentions: { parse: [] },
    };
  } catch (error) {
    console.warn('[Season] Image render failed:', error.message);
    return {
      content: entries.length
        ? `**Week of ${week}**\n${entries.map((entry, i) => `${i + 1}. <@${entry.userId}> - ${entry.xp} XP`).join('\n')}`
        : `No activity recorded for the week of ${week}.`,
      allowedMentions: { parse: [] },
    };
  }
}

async function tickSeason(client, now = Date.now()) {
  for (const due of client.communityStore.seasonDue(now)) {
    if (!client.communityStore.leaderboard(due.guildId, due.week).length) {
      await client.communityStore.markSeasonPosted(due.guildId, due.week);
      continue;
    }
    try {
      const channel = client.channels.cache.get(due.channelId) || await client.channels.fetch(due.channelId);
      if (!channel?.isTextBased?.()) throw new Error('Season channel unavailable');
      const guild = client.guilds.cache.get(due.guildId) || await client.guilds.fetch(due.guildId);
      await channel.send(await seasonPayload(client, due.guildId, guild.name, due.week, true));
      await client.communityStore.markSeasonPosted(due.guildId, due.week);
    } catch (error) {
      console.warn(`[Season] Could not post recap for ${due.guildId}:`, error.message);
    }
  }
}

function startSeasonTicker(client) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tickSeason(client);
    } finally {
      running = false;
    }
  };
  run().catch(error => console.error('[Season Tick]', error));
  const timer = setInterval(() => run().catch(error => console.error('[Season Tick]', error)), 60 * 60_000);
  timer.unref?.();
  return timer;
}

module.exports = { seasonPayload, tickSeason, startSeasonTicker };
