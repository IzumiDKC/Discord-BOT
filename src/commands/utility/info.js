const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Thông tin về bot'),

  async execute(interaction) {
    const client = interaction.client;
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🤖 Bot Info')
      .setThumbnail(client.user.displayAvatarURL())
      .addFields(
        { name: 'Tên', value: client.user.tag, inline: true },
        { name: 'Server', value: `${client.guilds.cache.size}`, inline: true },
        { name: 'Uptime', value: formatUptime(client.uptime), inline: true },
        { name: 'Thư viện', value: 'discord.js v14', inline: true },
      )
      .setFooter({ text: 'Personal bot 🔒' });
    await interaction.reply({ embeds: [embed] });
  },
};

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${s % 60}s`;
}
