const { createTicket, closeTicket } = require('../utils/ticketManager');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    // --- Slash Commands ---
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return interaction.reply({ content: '❌ Lệnh không tồn tại.', ephemeral: true });
      try {
        await command.execute(interaction, client);
      } catch (err) {
        console.error(err);
        interaction.reply({ content: '❌ Có lỗi xảy ra.', ephemeral: true });
      }
      return;
    }

    // --- Button Interactions ---
    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_create') {
        await createTicket(interaction);
      }
      if (interaction.customId === 'ticket_close') {
        await closeTicket(interaction);
      }
    }
  },
};
