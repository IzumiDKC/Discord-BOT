const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { previousWeek, weekKey } = require('../../utils/communityStore');
const { seasonPayload } = require('../../utils/seasonUi');

module.exports = {
  data: new SlashCommandBuilder().setName('season').setDescription('Weekly activity leaderboard and recap')
    .addSubcommand(sub => sub.setName('board').setDescription('Show this week leaderboard'))
    .addSubcommand(sub => sub.setName('recap').setDescription('Show last week recap'))
    .addSubcommand(sub => sub.setName('set').setDescription('Automatically post last week recap every week')
      .addChannelOption(option => option.setName('channel').setDescription('Recap channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('off').setDescription('Turn off automatic weekly recaps')),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'set' || sub === 'off') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
      }
      if (sub === 'off') {
        await client.communityStore.setSeason(interaction.guildId, null);
        return interaction.reply({ content: 'Automatic weekly recaps are off.', ephemeral: true });
      }
      const channel = interaction.options.getChannel('channel', true);
      const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
      if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) {
        return interaction.reply({ content: 'I need View Channel, Send Messages, Embed Links and Attach Files there.', ephemeral: true });
      }
      await client.communityStore.setSeason(interaction.guildId, channel.id);
      return interaction.reply({ content: `Weekly recaps will be posted in ${channel} when a new week begins (Vietnam time).`, ephemeral: true });
    }
    await interaction.deferReply();
    const previous = sub === 'recap';
    const week = previous ? previousWeek(weekKey()) : weekKey();
    return interaction.editReply(await seasonPayload(client, interaction.guildId, interaction.guild.name, week, previous));
  },
};
