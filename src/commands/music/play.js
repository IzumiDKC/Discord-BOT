const { SlashCommandBuilder } = require('discord.js');
const { playMusicRequest } = require('../../utils/musicRequest');
const { musicRequestEmbed, musicControls, statusEmbed } = require('../../utils/musicUi');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Phát nhạc từ tên bài, playlist, album hoặc đường link')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Tên bài hoặc link YouTube, Spotify, SoundCloud')
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('shuffle')
        .setDescription('Xáo trộn playlist hoặc album trước khi thêm')
    ),

  async execute(interaction, client) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [statusEmbed('🎧 Bạn chưa vào voice', 'Hãy vào một kênh thoại rồi dùng lại `/play`.', 0xFEE75C)],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query', true);
    const shouldShuffle = interaction.options.getBoolean('shuffle') ?? false;

    let playResult;
    try {
      playResult = await playMusicRequest({
        client,
        voiceChannel,
        textChannel: interaction.channel,
        requester: interaction.user,
        query,
        shouldShuffle,
      });
    } catch (err) {
      console.error('[/play Search Error]', err);
      return interaction.editReply({
        embeds: [statusEmbed(
          '❌ Không tìm thấy bài phù hợp',
          'Thử nhập rõ **tên bài + nghệ sĩ**, hoặc gửi link YouTube/Spotify/SoundCloud cụ thể.',
          0xED4245
        )],
      });
    }

    const { track, searchResult, resolvedInput } = playResult;

    try {
      const embed = musicRequestEmbed({
        requester: interaction.user,
        resolvedInput,
        searchResult,
        shouldShuffle,
        track,
      });

      return interaction.editReply({ embeds: [embed], components: musicControls() });
    } catch (err) {
      console.error('[/play Confirmation Error]', err);
      return interaction.editReply({
        embeds: [statusEmbed(
          '✅ Đã nhận bài hát',
          `**${track?.cleanTitle || track?.title || query}** đã được phát hoặc thêm vào hàng chờ.`,
          0x57F287
        )],
      }).catch(() => null);
    }
  },
};
