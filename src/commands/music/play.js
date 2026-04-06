const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { MusicQueue, queues, searchTrack } = require('../../utils/musicQueue');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Phát nhạc từ SoundCloud (Tên bài hát / Link)')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Tên bài hát hoặc link SoundCloud')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member.voice?.channel) {
      return interaction.reply({ content: '❌ Bạn cần vào phòng voice trước!', ephemeral: true });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');
    const voiceChannel = interaction.member.voice.channel;

    // Tìm nhạc và join voice song song
    await interaction.editReply('🔍 Đang tìm...');

    try {
      const [track] = await Promise.all([
        searchTrack(query),
      ]);

      if (!track) {
        return interaction.editReply('❌ Không tìm thấy bài hát. Thử tên khác nhé!');
      }

      track.requester = interaction.user.username;

      let queue = queues.get(interaction.guildId);

      if (!queue) {
        queue = new MusicQueue(interaction.guildId);
        queue.textChannel = interaction.channel;
        queues.set(interaction.guildId, queue);
        // Join voice trước khi play
        await queue.connect(voiceChannel);
      }

      queue.enqueue(track);

      if (queue.current) {
        // Đang phát rồi, thêm vào hàng chờ
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('➕ Đã thêm vào hàng chờ')
          .setDescription(`**[${track.title}](${track.url})**`)
          .addFields(
            { name: 'Thời lượng', value: track.durationString, inline: true },
            { name: 'Vị trí', value: `#${queue.tracks.length}`, inline: true },
          )
          .setThumbnail(track.thumbnail || null);
        return interaction.editReply({ content: '', embeds: [embed] });
      } else {
        // Bắt đầu phát ngay
        await interaction.editReply('✅ Bắt đầu phát!');
        await queue.play();
      }
    } catch (err) {
      console.error('[/play Error]', err);
      return interaction.editReply('❌ Lỗi. Thử lại hoặc dùng link SoundCloud trực tiếp!');
    }
  },
};
