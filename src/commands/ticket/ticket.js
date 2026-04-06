const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const { closeTicket } = require('../../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Quản lý ticket')
    .addSubcommand(sub =>
      sub.setName('panel')
        .setDescription('Gửi panel tạo ticket vào kênh hiện tại')
    )
    .addSubcommand(sub =>
      sub.setName('close')
        .setDescription('Đóng ticket hiện tại')
    )
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Thêm thành viên vào ticket')
        .addUserOption(opt =>
          opt.setName('user').setDescription('Thành viên cần thêm').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({ content: '❌ Bạn không có quyền dùng lệnh này.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎫 Hỗ Trợ & Ticket')
        .setDescription('Nhấn nút bên dưới để tạo ticket hỗ trợ.\nChúng tôi sẽ phản hồi sớm nhất có thể!')
        .setFooter({ text: 'Mỗi người chỉ được mở 1 ticket cùng lúc.' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_create')
          .setLabel('Tạo Ticket')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary),
      );

      await interaction.reply({ content: '✅ Panel đã được gửi!', ephemeral: true });
      await interaction.channel.send({ embeds: [embed], components: [row] });
    }

    if (sub === 'close') {
      await closeTicket(interaction);
    }

    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      if (!interaction.channel.name.startsWith('ticket-')) {
        return interaction.reply({ content: '❌ Lệnh này chỉ dùng trong kênh ticket.', ephemeral: true });
      }
      await interaction.channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true,
        SendMessages: true,
      });
      await interaction.reply({ content: `✅ Đã thêm ${user} vào ticket.` });
    }
  },
};
