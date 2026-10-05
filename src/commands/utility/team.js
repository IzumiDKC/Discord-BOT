const { PermissionFlagsBits, SlashCommandBuilder, escapeMarkdown } = require('discord.js');
const { buildTeam } = require('../../utils/teamManager');
const { refreshTeamMessage, teamMessage } = require('../../utils/teamUi');

function teamLink(team) {
  return `https://discord.com/channels/${team.guildId}/${team.channelId}/${team.id}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team').setDescription('Find teammates for a game')
    .addSubcommand(sub => sub.setName('create').setDescription('Post a team that others can join')
      .addStringOption(option => option.setName('game').setDescription('Game name').setMinLength(2).setMaxLength(60).setRequired(true))
      .addIntegerOption(option => option.setName('slots').setDescription('Total players including you (default 5)').setMinValue(2).setMaxValue(10))
      .addStringOption(option => option.setName('rank').setDescription('Preferred rank, or leave blank for any').setMaxLength(40))
      .addStringOption(option => option.setName('role').setDescription('Role or position you need').setMaxLength(40))
      .addIntegerOption(option => option.setName('starts_in').setDescription('Minutes from now (0 = now, max 7 days)').setMinValue(0).setMaxValue(10080)))
    .addSubcommand(sub => sub.setName('list').setDescription('Show active teams in this server'))
    .addSubcommand(sub => sub.setName('cancel').setDescription('Cancel your team, or a team by message ID as staff')
      .addStringOption(option => option.setName('message_id').setDescription('Optional team message ID'))),

  async execute(interaction, client) {
    const manager = client.teamManager;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const teams = manager.list(interaction.guildId).slice(0, 10);
      const lines = teams.map(team => {
        const time = team.startsAt <= team.createdAt ? 'now' : `<t:${Math.floor(team.startsAt / 1000)}:R>`;
        return `[${escapeMarkdown(team.game)}](${teamLink(team)}) - ${team.members.length}/${team.slots} players, ${time}`;
      });
      return interaction.reply({
        content: lines.length ? `**Active teams**\n${lines.join('\n')}` : 'No active teams. Use `/team create` to start one.',
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    if (sub === 'cancel') {
      const messageId = interaction.options.getString('message_id')
        || manager.list(interaction.guildId).find(team => team.hostId === interaction.user.id)?.id;
      if (!messageId) return interaction.reply({ content: 'No active team found for you.', ephemeral: true });
      const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || false;
      const result = await manager.cancel(interaction.guildId, messageId, interaction.user.id, isStaff);
      if (result.code !== 'cancelled') {
        const messages = { not_found: 'Team not found.', closed: 'This team is already closed.', forbidden: 'Only the host or server staff can cancel this team.' };
        return interaction.reply({ content: messages[result.code] || 'Could not cancel this team.', ephemeral: true });
      }
      await refreshTeamMessage(client, result.team)
        .catch(error => console.warn('[Team] Could not refresh cancelled card:', error.message));
      return interaction.reply({ content: 'Team cancelled.', ephemeral: true });
    }

    const team = buildTeam({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      hostId: interaction.user.id,
      game: interaction.options.getString('game', true),
      rank: interaction.options.getString('rank') || '',
      role: interaction.options.getString('role') || '',
      slots: interaction.options.getInteger('slots') ?? 5,
      startsIn: interaction.options.getInteger('starts_in') ?? 0,
    });
    await interaction.deferReply({ ephemeral: true });
    const message = await interaction.channel.send(teamMessage(team));
    let saved;
    try {
      saved = await manager.create(team, message.id);
    } catch (error) {
      await message.delete().catch(() => {});
      return interaction.editReply(error.message);
    }
    return interaction.editReply({
      content: `Team posted: ${teamLink(saved)}`,
      allowedMentions: { parse: [] },
    });
  },
};
