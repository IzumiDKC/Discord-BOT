module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    const logChannelId = process.env.LOG_CHANNEL_ID;
    if (!logChannelId) return;

    // Check if nickname changed
    if (oldMember.nickname !== newMember.nickname) {
      const logChannel = newMember.guild.channels.cache.get(logChannelId) || await newMember.guild.channels.fetch(logChannelId).catch(() => null);
      if (!logChannel) return;

      const oldName = oldMember.nickname || oldMember.user.username;
      const newName = newMember.nickname || newMember.user.username;

      logChannel.send(`✍️ **${oldMember.user.tag}** đã thay đổi biệt danh: \`${oldName}\` ➡️ \`${newName}\`.`);
    }
  },
};
