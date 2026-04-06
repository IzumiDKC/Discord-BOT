const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

// Lưu danh sách ticket đang mở: userId -> channelId
const openTickets = new Map();

async function createTicket(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;

  // Kiểm tra đã có ticket chưa
  if (openTickets.has(user.id)) {
    const existing = guild.channels.cache.get(openTickets.get(user.id));
    if (existing) {
      return interaction.reply({
        content: `❌ Bạn đã có ticket rồi: ${existing}`,
        ephemeral: true,
      });
    }
    openTickets.delete(user.id); // channel bị xóa thủ công → reset
  }

  // Tìm hoặc tạo category "Tickets"
  let category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'tickets'
  );
  if (!category) {
    category = await guild.channels.create({
      name: 'Tickets',
      type: ChannelType.GuildCategory,
    });
  }

  // Đếm số ticket để đặt tên
  const count = guild.channels.cache.filter(c => c.name.startsWith('ticket-')).size + 1;
  const channelName = `ticket-${user.username}-${String(count).padStart(3, '0')}`;

  // Tạo channel với permission riêng
  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
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

  // Gửi embed chào mừng trong ticket
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🎫 Ticket #${String(count).padStart(3, '0')}`)
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

  await interaction.reply({
    content: `✅ Ticket đã được tạo: ${ticketChannel}`,
    ephemeral: true,
  });
}

async function closeTicket(interaction) {
  const channel = interaction.channel;

  if (!channel.name.startsWith('ticket-')) {
    return interaction.reply({ content: '❌ Kênh này không phải ticket.', ephemeral: true });
  }

  // Tìm userId của chủ ticket và xóa khỏi map
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
  setTimeout(() => channel.delete().catch(() => {}), 5000);
}

module.exports = { createTicket, closeTicket, openTickets };
