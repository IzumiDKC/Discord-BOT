const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { safeSelfRole, welcomePayload } = require('../../utils/welcomeUi');

module.exports = {
  data: new SlashCommandBuilder().setName('welcome').setDescription('Configure member welcome cards and self-roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('set').setDescription('Send welcome cards to a channel')
      .addChannelOption(option => option.setName('channel').setDescription('Welcome channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('off').setDescription('Stop welcome cards'))
    .addSubcommand(sub => sub.setName('preview').setDescription('Preview your own welcome card'))
    .addSubcommand(sub => sub.setName('role_add').setDescription('Allow a safe self-select role')
      .addRoleOption(option => option.setName('role').setDescription('Role to add').setRequired(true)))
    .addSubcommand(sub => sub.setName('role_remove').setDescription('Remove a self-select role')
      .addRoleOption(option => option.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand(sub => sub.setName('roles').setDescription('List configured self-select roles')),

  async execute(interaction, client) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    const store = client.communityStore;
    const config = store.welcome(interaction.guildId);
    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
      const permissions = channel.permissionsFor(me);
      if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) {
        return interaction.reply({ content: 'I need View Channel, Send Messages, Embed Links and Attach Files there.', ephemeral: true });
      }
      await store.setWelcome(interaction.guildId, { channelId: channel.id });
      return interaction.reply({ content: `Welcome cards will be sent in ${channel}.`, ephemeral: true });
    }
    if (sub === 'off') {
      await store.setWelcome(interaction.guildId, { channelId: null });
      return interaction.reply({ content: 'Welcome cards are off. Saved self-roles were kept.', ephemeral: true });
    }
    if (sub === 'roles') {
      return interaction.reply({ content: config.roleIds.length ? `Self-roles: ${config.roleIds.map(id => `<@&${id}>`).join(', ')}` : 'No self-roles configured.', ephemeral: true, allowedMentions: { parse: [] } });
    }
    if (sub === 'role_add' || sub === 'role_remove') {
      const role = interaction.options.getRole('role', true);
      if (sub === 'role_add') {
        if (!await safeSelfRole(interaction.guild, role)) {
          return interaction.reply({ content: 'That role is managed, privileged, or above my highest role. I also need Manage Roles.', ephemeral: true });
        }
        if (config.roleIds.includes(role.id)) return interaction.reply({ content: 'That role is already offered.', ephemeral: true });
        if (config.roleIds.length >= 5) return interaction.reply({ content: 'Welcome cards support up to five self-roles.', ephemeral: true });
        config.roleIds.push(role.id);
      } else {
        if (!config.roleIds.includes(role.id)) return interaction.reply({ content: 'That role is not offered.', ephemeral: true });
        config.roleIds = config.roleIds.filter(id => id !== role.id);
      }
      await store.setWelcome(interaction.guildId, { roleIds: config.roleIds });
      return interaction.reply({ content: sub === 'role_add' ? `Added **${role.name}** to welcome cards.` : `Removed **${role.name}** from welcome cards.`, ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    return interaction.editReply(await welcomePayload(member, config));
  },
};
