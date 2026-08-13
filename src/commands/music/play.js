const { SlashCommandBuilder } = require('discord.js');
const { QueryType } = require('discord-player');
const { platformLabel, resolveMusicInput } = require('../../utils/musicSource');
const { preloadSmartMatches, smartMusicBridge } = require('../../utils/smartMusicBridge');
const { addedToQueueEmbed, musicControls, statusEmbed } = require('../../utils/musicUi');

const DEFAULT_MUSIC_VOLUME = 55;
const NORMALIZATION_FILTERS = ['normalizer2', 'softlimiter'];

function shuffleTracks(tracks) {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

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
    const resolvedInput = resolveMusicInput(query);
    const shouldShuffle = interaction.options.getBoolean('shuffle') ?? false;

    let playResult;
    try {
      playResult = await client.player.play(voiceChannel, resolvedInput.query, {
        requestedBy: interaction.user,
        searchEngine: resolvedInput.searchEngine,
        fallbackSearchEngine: QueryType.YOUTUBE_SEARCH,
        afterSearch: async result => {
          if (result.tracks.length > 1) {
            void preloadSmartMatches(result.tracks, client.player).catch(error => {
              console.warn('[Music Match] Preload failed:', error.message);
            });
          }

          if (!shouldShuffle || result.tracks.length < 2) return result;

          const shuffledTracks = shuffleTracks(result.tracks);
          result.setTracks(shuffledTracks);
          if (result.playlist) {
            result.playlist.tracks = shuffledTracks;
          }

          return result;
        },
        nodeOptions: {
          metadata: {
            channel: interaction.channel,
            requestedBy: interaction.user,
            normalizationEnabled: true,
          },
          selfDeaf: false,
          volume: DEFAULT_MUSIC_VOLUME,
          defaultFFmpegFilters: NORMALIZATION_FILTERS,
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 60_000,
          leaveOnEnd: true,
          leaveOnEndCooldown: 60_000,
          leaveOnStop: true,
          leaveOnStopCooldown: 10_000,
          bufferingTimeout: 30_000,
          onBeforeCreateStream: smartMusicBridge,
          preferBridgedMetadata: true,
        },
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

    const { track, searchResult } = playResult;
    const queue = client.player.nodes.get(interaction.guildId);
    if (queue) {
      try {
        queue.setMetadata({
          channel: interaction.channel,
          requestedBy: interaction.user,
          normalizationEnabled: queue.metadata?.normalizationEnabled ?? true,
        });
      } catch (err) {
        console.warn('[/play Metadata Warning]', err.message);
      }
    }

    try {
      const collection = searchResult?.playlist;
      const trackCount = searchResult?.tracks?.length || 1;
      const sourceName = platformLabel(resolvedInput.platform);
      const playbackDescription = resolvedInput.directAudio
        ? `Phát audio trực tiếp từ ${sourceName}`
        : `Danh mục ${sourceName}; từng bài được đối chiếu với audio YouTube phù hợp nhất`;
      const notice = resolvedInput.automaticMixRemoved
        ? 'Đã bỏ YouTube Mix tự sinh và chỉ thêm đúng video bạn gửi.'
        : null;

      const embed = addedToQueueEmbed({
        collection,
        interaction,
        notice,
        playbackDescription,
        resolvedInput,
        shouldShuffle,
        track,
        trackCount,
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
