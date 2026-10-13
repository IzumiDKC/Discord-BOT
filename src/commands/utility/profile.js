const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { renderProfileCard } = require('../../utils/visualCards');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile').setDescription('Show a member activity card')
    .addUserOption(option => option.setName('user').setDescription('Member to view')),

  async execute(interaction, client) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user') || interaction.user;
    const profile = client.communityStore.profile(interaction.guildId, user.id);
    try {
      const image = await renderProfileCard(user, profile, interaction.guild.name);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x46DFBA).setImage('attachment://profile.png')],
        files: [new AttachmentBuilder(image, { name: 'profile.png' })],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.warn('[Profile] Image render failed:', error.message);
      return interaction.editReply(`${user.username}: level ${profile.level.level}, ${profile.xp} XP, ${profile.hosted} teams hosted, ${profile.joined} joined.`);
    }
  },
};
