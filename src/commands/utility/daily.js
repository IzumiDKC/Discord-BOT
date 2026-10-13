const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily XP and keep your streak'),

  async execute(interaction, client) {
    const result = await client.communityStore.claimDaily(interaction.guildId, interaction.user.id);
    const { profile } = result;
    const embed = new EmbedBuilder()
      .setColor(result.claimed ? 0xF5C75C : 0x747F8D)
      .setTitle(result.claimed ? 'DAILY CLAIMED' : 'ALREADY CLAIMED TODAY')
      .setDescription(result.claimed ? `+${result.earned} XP earned. Come back tomorrow to grow your streak.` : 'Your next claim unlocks tomorrow (Vietnam time).')
      .addFields(
        { name: 'Streak', value: `${profile.streak} day(s)`, inline: true },
        { name: 'Level', value: `${profile.level.level}`, inline: true },
        { name: 'Total XP', value: `${profile.xp}`, inline: true },
      )
      .setFooter({ text: 'Use /quests for badge and frame unlocks.' });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
