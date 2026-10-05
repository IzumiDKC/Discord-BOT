const { SlashCommandBuilder } = require('discord.js');
const { FRAMES, TITLES } = require('../../utils/communityStore');

module.exports = {
  data: new SlashCommandBuilder().setName('cosmetic').setDescription('Equip unlocked profile styles')
    .addSubcommand(sub => sub.setName('frame').setDescription('Choose your avatar frame')
      .addStringOption(option => option.setName('style').setDescription('Frame style').setRequired(true)
        .addChoices(...FRAMES.map(value => ({ name: value, value })))))
    .addSubcommand(sub => sub.setName('title').setDescription('Choose your profile title')
      .addStringOption(option => option.setName('name').setDescription('Title').setRequired(true)
        .addChoices(...TITLES.map(value => ({ name: value, value }))))),

  async execute(interaction, client) {
    const type = interaction.options.getSubcommand();
    const value = interaction.options.getString(type === 'frame' ? 'style' : 'name', true);
    const equipped = await client.communityStore.selectCosmetic(interaction.guildId, interaction.user.id, type, value);
    return interaction.reply({
      content: equipped ? `Equipped ${type}: **${value}**. View it with /profile.` : `That ${type} is still locked. Check /quests.`,
      ephemeral: true,
    });
  },
};
