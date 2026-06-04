const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Phat nhac tu ten bai hat hoac link')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Ten bai hat, link YouTube, SoundCloud, Spotify...')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: 'Ban can vao phong voice truoc.', ephemeral: true });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query', true);

    try {
      const { track, searchResult } = await client.player.play(voiceChannel, query, {
        requestedBy: interaction.user,
        nodeOptions: {
          metadata: {
            channel: interaction.channel,
            requestedBy: interaction.user,
          },
          selfDeaf: true,
          volume: 80,
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 60_000,
          leaveOnEnd: true,
          leaveOnEndCooldown: 60_000,
          leaveOnStop: true,
          leaveOnStopCooldown: 10_000,
          bufferingTimeout: 15_000,
        },
      });

      const queue = client.player.nodes.get(interaction.guildId);
      if (queue) {
        queue.setMetadata({
          channel: interaction.channel,
          requestedBy: interaction.user,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(searchResult?.playlist ? 'Da them playlist' : 'Da them vao hang cho')
        .setDescription(`**[${track.cleanTitle || track.title}](${track.url})**`)
        .addFields(
          { name: 'Thoi luong', value: track.duration || 'Khong ro', inline: true },
          { name: 'Nguon', value: track.source || 'unknown', inline: true },
        )
        .setThumbnail(track.thumbnail || null);

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/play Error]', err);
      return interaction.editReply('Khong tim/phat duoc bai nay. Thu link YouTube/SoundCloud khac hoac ten bai ro hon.');
    }
  },
};
