const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dj')
    .setDescription('Automatically play fresh music for a mood')
    .addSubcommand(sub => sub.setName('start').setDescription('Start Smart DJ')
      .addStringOption(option => option.setName('mood')
        .setDescription('Example: chill evening, V-pop, focus')
        .setMinLength(2).setMaxLength(60).setRequired(true)))
    .addSubcommand(sub => sub.setName('stop').setDescription('Stop Smart DJ without stopping the current song'))
    .addSubcommand(sub => sub.setName('status').setDescription('Show Smart DJ status')),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const status = client.smartDj.status(guildId);
    if (sub === 'status') {
      return interaction.reply({ content: status
        ? `Smart DJ is on in <#${status.voiceChannelId}>. Mood: **${status.mood}**.`
        : 'Smart DJ is off.', ephemeral: true, allowedMentions: { parse: [] } });
    }

    const voiceChannel = interaction.member.voice?.channel;
    const botVoiceId = interaction.guild.members.me?.voice?.channelId;
    if (!voiceChannel || (botVoiceId && voiceChannel.id !== botVoiceId)
      || (status && voiceChannel.id !== status.voiceChannelId)) {
      return interaction.reply({ content: 'Join the same voice channel as the bot to control Smart DJ.', ephemeral: true });
    }

    if (sub === 'stop') {
      client.smartDj.stop(guildId);
      return interaction.reply('Smart DJ is off. The current song and queue will keep playing.');
    }

    await interaction.deferReply();
    const mood = interaction.options.getString('mood', true);
    client.smartDj.start({ guildId, voiceChannel, textChannel: interaction.channel, requester: interaction.user, mood });
    const queue = client.player.nodes.get(guildId);
    const started = queue ? await client.smartDj.refill(queue) : false;
    return interaction.editReply({
      content: started
        ? `Smart DJ started for **${mood}**. Added a fresh song.`
        : `Smart DJ started for **${mood}**. It will choose a song when the current queue ends. If nothing is playing, use /play once to connect the bot.`,
      allowedMentions: { parse: [] },
    });
  },
};
