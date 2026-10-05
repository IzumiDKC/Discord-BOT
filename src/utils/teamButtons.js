const { PermissionFlagsBits } = require('discord.js');
const { refreshTeamMessage } = require('./teamUi');

const MESSAGES = {
  already_joined: 'You are already on this team.',
  closed: 'This team is closed.',
  forbidden: 'Only the host or server staff can cancel this team.',
  full: 'This team is full.',
  host: 'The host cannot leave. Use Cancel instead.',
  not_found: 'This team is no longer available.',
  not_joined: 'You are not on this team.',
};

async function handleTeamButton(interaction, client) {
  const action = interaction.customId.slice('team:'.length);
  if (!['join', 'leave', 'cancel'].includes(action)) return;
  await interaction.deferReply({ ephemeral: true });
  const manager = client.teamManager;
  const team = manager.get(interaction.guildId, interaction.message.id);
  if (!team || team.channelId !== interaction.channelId) {
    return interaction.editReply(MESSAGES.not_found);
  }

  const userId = interaction.user.id;
  const result = action === 'join'
    ? await manager.join(interaction.guildId, team.id, userId)
    : action === 'leave'
      ? await manager.leave(interaction.guildId, team.id, userId)
      : await manager.cancel(interaction.guildId, team.id, userId,
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || false);
  if (!['joined', 'left', 'cancelled'].includes(result.code)) {
    return interaction.editReply(MESSAGES[result.code] || 'Could not update this team.');
  }

  await refreshTeamMessage(client, result.team)
    .catch(error => console.warn('[Team] Could not refresh card:', error.message));
  const response = result.code === 'joined'
    ? result.team.status === 'full' ? 'You joined. The team is now full.' : 'You joined the team.'
    : result.code === 'left' ? 'You left the team.' : 'Team cancelled.';
  return interaction.editReply(response);
}

module.exports = { handleTeamButton };
