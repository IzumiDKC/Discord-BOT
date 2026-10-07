const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } = require('discord.js');
const { renderTeamCard, resolveUsers } = require('./visualCards');

const COLORS = { open: 0x5865F2, full: 0x57F287, cancelled: 0x747F8D, expired: 0x747F8D };
const pendingEdits = new Map();

function teamMessage(team) {
  const closed = ['cancelled', 'expired'].includes(team.status);
  const start = team.startsAt <= team.createdAt
    ? 'Now'
    : `<t:${Math.floor(team.startsAt / 1000)}:F> (<t:${Math.floor(team.startsAt / 1000)}:R>)`;
  const members = team.members.map((id, index) => `${index + 1}. <@${id}>`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(COLORS[team.status] || COLORS.open)
    .setTitle(`TEAM UP | ${escapeMarkdown(team.game)}`)
    .setDescription(team.status === 'full' ? 'Team full. A spot may reopen if someone leaves.'
      : team.status === 'cancelled' ? 'This team was cancelled.'
        : team.status === 'expired' ? 'This team has expired.'
          : 'Join the team using the button below.')
    .addFields(
      { name: 'Rank', value: escapeMarkdown(team.rank || 'Any'), inline: true },
      { name: 'Looking for', value: escapeMarkdown(team.role || 'Any role'), inline: true },
      { name: 'Starts', value: start, inline: false },
      { name: `Players (${team.members.length}/${team.slots})`, value: members, inline: false },
    )
    .setFooter({ text: 'Host can cancel | Team closes 2 hours after start' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('team:join').setLabel('Join').setStyle(ButtonStyle.Success)
      .setDisabled(closed || team.members.length >= team.slots),
    new ButtonBuilder().setCustomId('team:leave').setLabel('Leave').setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
    new ButtonBuilder().setCustomId('team:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
      .setDisabled(closed),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function teamCardPayload(client, team, editing = false) {
  const fallback = teamMessage(team);
  try {
    const users = await resolveUsers(client, team.members);
    const image = await renderTeamCard(team, users);
    const embed = new EmbedBuilder()
      .setColor(COLORS[team.status] || COLORS.open)
      .setTitle(`TEAM UP | ${escapeMarkdown(team.game)}`)
      .setDescription(`${team.members.length}/${team.slots} players | ${team.status.toUpperCase()} | ${team.startsAt <= team.createdAt ? 'Starts now' : `<t:${Math.floor(team.startsAt / 1000)}:R>`}\nRank: ${escapeMarkdown(team.rank || 'Any')} | Role: ${escapeMarkdown(team.role || 'Any')}\nPlayers: ${team.members.map(id => `<@${id}>`).join(', ')}`)
      .setImage('attachment://team.png');
    return {
      ...fallback,
      embeds: [embed],
      files: [new AttachmentBuilder(image, { name: 'team.png' })],
      ...(editing ? { attachments: [] } : {}),
    };
  } catch (error) {
    console.warn('[Team] Image render failed; using text card:', error.message);
    return { ...fallback, ...(editing ? { attachments: [] } : {}) };
  }
}

async function teamChannel(client, team) {
  const channel = client.channels.cache.get(team.channelId)
    || await client.channels.fetch(team.channelId);
  if (!channel?.isTextBased?.()) throw new Error('Team channel is unavailable.');
  return channel;
}

async function refreshTeamMessage(client, team) {
  const previous = pendingEdits.get(team.id) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const latest = client.teamManager?.get(team.guildId, team.id) || team;
    const channel = await teamChannel(client, latest);
    const message = await channel.messages.fetch(team.id);
    return message.edit(await teamCardPayload(client, latest, true));
  });
  pendingEdits.set(team.id, current);
  try {
    return await current;
  } finally {
    if (pendingEdits.get(team.id) === current) pendingEdits.delete(team.id);
  }
}

async function sendStartReminder(client, team) {
  const channel = await teamChannel(client, team);
  const mentions = team.members.map(id => `<@${id}>`).join(' ');
  return channel.send({
    content: `Time to play **${escapeMarkdown(team.game)}**. ${mentions}\nTeam: https://discord.com/channels/${team.guildId}/${team.channelId}/${team.id}`,
    allowedMentions: { users: team.members },
  });
}

module.exports = { refreshTeamMessage, sendStartReminder, teamMessage, teamCardPayload };
