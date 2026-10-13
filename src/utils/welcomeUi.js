const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, PermissionFlagsBits,
} = require('discord.js');
const { renderWelcomeCard } = require('./visualCards');

const FORBIDDEN = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MentionEveryone,
];

async function safeSelfRole(guild, role) {
  if (!role || role.guild.id !== guild.id || role.id === guild.id || role.managed) return false;
  if (FORBIDDEN.some(permission => role.permissions.has(permission))) return false;
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) return false;
  return me.permissions.has(PermissionFlagsBits.ManageRoles)
    && me.roles.highest.comparePositionTo(role) > 0;
}

async function roleButtons(guild, roleIds) {
  const buttons = [];
  for (const id of roleIds.slice(0, 5)) {
    const role = guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null);
    if (await safeSelfRole(guild, role)) {
      buttons.push(new ButtonBuilder().setCustomId(`welcome:role:${id}`)
        .setLabel(role.name.slice(0, 80)).setStyle(ButtonStyle.Secondary));
    }
  }
  return buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
}

async function welcomePayload(member, config) {
  const components = await roleButtons(member.guild, config.roleIds).catch(error => {
    console.warn('[Welcome] Could not build role buttons:', error.message);
    return [];
  });
  const description = components.length ? 'Choose or remove a role with the buttons below.' : 'Glad you are here!';
  try {
    const image = await renderWelcomeCard(member.user, member.guild.name, member.guild.memberCount);
    return {
      embeds: [new EmbedBuilder().setColor(0x46DFBA).setDescription(description).setImage('attachment://welcome.png')],
      files: [new AttachmentBuilder(image, { name: 'welcome.png' })],
      components,
      allowedMentions: { parse: [] },
    };
  } catch (error) {
    console.warn('[Welcome] Image render failed:', error.message);
    return {
      content: `Welcome **${member.user.username}** to **${member.guild.name}**! ${description}`,
      components,
      allowedMentions: { parse: [] },
    };
  }
}

async function handleWelcomeButton(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  const roleId = interaction.customId.slice('welcome:role:'.length);
  const config = client.communityStore.welcome(interaction.guildId);
  if (!config.roleIds.includes(roleId)) return interaction.editReply('This role is no longer available.');
  const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!await safeSelfRole(interaction.guild, role)) return interaction.editReply('This role is no longer available.');
  const member = await interaction.guild.members.fetch(interaction.user.id);
  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'Self-selected welcome role');
      return interaction.editReply(`Removed **${role.name}**.`);
    }
    await member.roles.add(roleId, 'Self-selected welcome role');
    return interaction.editReply(`Added **${role.name}**.`);
  } catch (error) {
    console.warn('[Welcome] Could not update role:', error.message);
    return interaction.editReply('I could not change that role. Check my Manage Roles permission and role position.');
  }
}

module.exports = { safeSelfRole, roleButtons, welcomePayload, handleWelcomeButton };
