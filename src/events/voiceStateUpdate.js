module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const logChannelId = process.env.LOG_CHANNEL_ID;
    if (!logChannelId) return;

    const logChannel = newState.guild.channels.cache.get(logChannelId) || await newState.guild.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel) return;

    const user = newState.member.user;

    // Join
    if (!oldState.channelId && newState.channelId) {
      logChannel.send(`📥 **${user.tag}** đã tham gia kênh thoại **${newState.channel.name}**.`);
    }
    // Leave
    else if (oldState.channelId && !newState.channelId) {
      logChannel.send(`📤 **${user.tag}** đã rời kênh thoại **${oldState.channel.name}**.`);
    }
    // Move
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      logChannel.send(`🔀 **${user.tag}** đã chuyển từ kênh thoại **${oldState.channel.name}** sang **${newState.channel.name}**.`);
    }
  },
};
