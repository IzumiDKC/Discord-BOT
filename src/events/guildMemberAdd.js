const { welcomePayload } = require('../utils/welcomeUi');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    if (member.user.bot) return;
    const config = client.communityStore.welcome(member.guild.id);
    if (!config.channelId) return;
    const channel = member.guild.channels.cache.get(config.channelId)
      || await member.guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    try {
      await channel.send(await welcomePayload(member, config));
    } catch (error) {
      console.warn('[Welcome] Could not send card:', error.message);
    }
  },
};
