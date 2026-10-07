const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { BADGES } = require('../../utils/communityStore');

const GOALS = {
  first_team: 'Host or join one team',
  team_builder: 'Host 3 teams',
  squadmate: 'Join 5 teams',
  streak_7: 'Reach a 7-day /daily streak',
  season_star: 'Earn 1,000 total XP',
};

module.exports = {
  data: new SlashCommandBuilder().setName('quests').setDescription('See badge challenges and cosmetic unlocks'),

  async execute(interaction, client) {
    const profile = client.communityStore.profile(interaction.guildId, interaction.user.id);
    const lines = BADGES.map(badge => `${profile.unlocked.badges.includes(badge.id) ? '[UNLOCKED]' : '[LOCKED]'} **${badge.name}** - ${GOALS[badge.id]}`);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x46DFBA).setTitle('QUEST BOARD')
        .setDescription(lines.join('\n'))
        .addFields(
          { name: 'Frames', value: profile.unlocked.frames.join(', ') },
          { name: 'Titles', value: profile.unlocked.titles.join(', ') },
        )
        .setFooter({ text: 'Use /cosmetic to equip unlocked rewards.' })],
      ephemeral: true,
    });
  },
};
