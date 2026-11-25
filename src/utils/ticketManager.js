const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const openTickets = new Map();

function ownerTag(userId) {
  return `ticket-owner:${userId}`;
}

function isTicketOwner(channel, userId) {
  if (!channel || !userId) return false;
  if (openTickets.get(userId) === channel.id) return true;
  return Boolean(channel.topic?.includes(ownerTag(userId)));
}

function findExistingTicket(guild, userId) {
  const cachedId = openTickets.get(userId);
  if (cachedId) {
    const cached = guild.channels.cache.get(cachedId);
    if (cached) return cached;
    openTickets.delete(userId);
  }
  const byTopic = guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.name.startsWith('ticket-') && c.topic?.includes(ownerTag(userId))
  );
  if (byTopic) openTickets.set(userId, byTopic.id);
  return byTopic || null;
}

async function createTicket(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;

  const existing = findExistingTicket(guild, user.id);
  if (existing) {
    return interaction.reply({
      content: `❌ Bạn đã có ticket rồi: ${existing}`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  let category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'tickets'
  );
  if (!category) {
    category = await guild.channels.create({
      name: 'Tickets',
      type: ChannelType.GuildCategory,
    });
  }

  const safeName = user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || user.id;
  const suffix = user.id.slice(-4);
  const channelName = `ticket-${safeName}-${suffix}`;

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: ownerTag(user.id),
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
      {
        id: guild.members.me.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
      },
    ],
  });

  openTickets.set(user.id, ticketChannel.id);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🎫 Ticket #${suffix}`)
    .setDescription(`Chào ${user}!\nHãy mô tả vấn đề của bạn, chúng tôi sẽ hỗ trợ sớm nhất.`)
    .setFooter({ text: 'Nhấn "Đóng Ticket" khi vấn đề đã được giải quyết.' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Đóng Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );

  await ticketChannel.send({ content: `${user}`, embeds: [embed], components: [row] });

  await interaction.editReply({
    content: `✅ Ticket đã được tạo: ${ticketChannel}`,
  });
}

async function closeTicket(interaction) {
  const channel = interaction.channel;

  if (!channel?.name?.startsWith('ticket-')) {
    return interaction.reply({ content: '❌ Kênh này không phải ticket.', ephemeral: true });
  }

  const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  if (!isStaff && !isTicketOwner(channel, interaction.user.id)) {
    return interaction.reply({ content: '❌ Chỉ chủ ticket hoặc quản trị viên mới có thể đóng ticket.', ephemeral: true });
  }

  for (const [userId, channelId] of openTickets.entries()) {
    if (channelId === channel.id) {
      openTickets.delete(userId);
      break;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🔒 Ticket đã đóng')
    .setDescription(`Đóng bởi ${interaction.user}\nKênh sẽ tự xóa sau 5 giây.`)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  setTimeout(() => channel.delete().catch(() => {}), 5000).unref?.();
}

module.exports = { createTicket, closeTicket, isTicketOwner, openTickets };
