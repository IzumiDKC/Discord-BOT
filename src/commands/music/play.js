const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music from a song name or link')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Song name, YouTube link, SoundCloud link, Spotify link...')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: 'You need to join a voice channel first.', ephemeral: true });
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
        .setTitle(searchResult?.playlist ? 'Playlist added' : 'Added to queue')
        .setDescription(`**[${track.cleanTitle || track.title}](${track.url})**`)
        .addFields(
          { name: 'Duration', value: track.duration || 'Unknown', inline: true },
          { name: 'Source', value: track.source || 'unknown', inline: true },
        )
        .setThumbnail(track.thumbnail || null);

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/play Error]', err);
      return interaction.editReply('Could not find or play this track. Try another YouTube/SoundCloud link or a clearer song name.');
    }
  },
};
