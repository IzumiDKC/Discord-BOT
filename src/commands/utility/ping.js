const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Kiểm tra độ trễ của bot'),

  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🏓 Pong!')
      .addFields(
        { name: 'Độ trễ bot', value: `\`${latency}ms\``, inline: true },
        { name: 'API Latency', value: `\`${interaction.client.ws.ping}ms\``, inline: true },
      );
    await interaction.reply({ embeds: [embed] });
  },
};
