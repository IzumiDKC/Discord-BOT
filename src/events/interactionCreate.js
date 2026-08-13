const { createTicket, closeTicket } = require('../utils/ticketManager');
const { musicControls, queueEmbed } = require('../utils/musicUi');

const NORMALIZATION_FILTERS = ['normalizer2', 'softlimiter'];

function isNormalizationEnabled(queue) {
  return NORMALIZATION_FILTERS.every(filter => queue.filters.ffmpeg.filters.includes(filter));
}

async function handleMusicButton(interaction, client) {
  const action = interaction.customId.slice('music:'.length);
  const queue = client.player.nodes.get(interaction.guildId);
  if (!queue || (!queue.currentTrack && queue.isEmpty())) {
    return interaction.reply({ content: '🌙 Hiện không có nhạc trong hàng chờ.', ephemeral: true });
  }

  if (action === 'queue') {
    return interaction.reply({
      embeds: [queueEmbed(queue, isNormalizationEnabled)],
      components: musicControls(),
      ephemeral: true,
    });
  }

  const memberVoiceId = interaction.member.voice?.channelId;
  const botVoiceId = interaction.guild.members.me?.voice?.channelId;
  if (!memberVoiceId || (botVoiceId && memberVoiceId !== botVoiceId)) {
    return interaction.reply({ content: '🎧 Bạn cần ở cùng kênh voice với Momoka để điều khiển nhạc.', ephemeral: true });
  }

  if (action === 'pause-resume') {
    const paused = queue.node.isPaused();
    const changed = paused ? queue.node.resume() : queue.node.pause();
    return interaction.reply({ content: changed ? (paused ? '▶️ Đã tiếp tục phát.' : '⏸️ Đã tạm dừng.') : 'Không thể đổi trạng thái lúc này.', ephemeral: true });
  }
  if (action === 'skip') {
    const skipped = queue.node.skip();
    return interaction.reply({ content: skipped ? '⏭️ Đã chuyển bài.' : 'Không thể chuyển bài lúc này.', ephemeral: true });
  }
  if (action === 'stop') {
    queue.delete();
    return interaction.reply({ content: '⏹️ Đã dừng nhạc và xóa hàng chờ.', ephemeral: true });
  }
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    // --- Slash Commands ---
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return interaction.reply({ content: '❌ Lệnh không tồn tại.', ephemeral: true });
      try {
        await command.execute(interaction, client);
      } catch (err) {
        console.error(err);
        interaction.reply({ content: '❌ Có lỗi xảy ra.', ephemeral: true });
      }
      return;
    }

    // --- Button Interactions ---
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('music:')) {
        await handleMusicButton(interaction, client);
        return;
      }
      if (interaction.customId === 'ticket_create') {
        await createTicket(interaction);
      }
      if (interaction.customId === 'ticket_close') {
        await closeTicket(interaction);
      }
    }
  },
};
