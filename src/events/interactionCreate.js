const { createTicket, closeTicket } = require('../utils/ticketManager');
const { musicControls, queueEmbed } = require('../utils/musicUi');
const { takeAlternative } = require('../utils/musicAlternatives');
const { QueueRepeatMode } = require('discord-player');

async function handleAlternativeSelect(interaction, client) {
  const queue = client.player.nodes.get(interaction.guildId);
  const voiceId = interaction.member.voice?.channelId;
  const botVoiceId = interaction.guild.members.me?.voice?.channelId;
  if (!queue?.currentTrack || !voiceId || (botVoiceId && botVoiceId !== voiceId)) {
    return interaction.reply({ content: 'Join the same voice channel as the bot first.', ephemeral: true });
  }
  const sessionId = interaction.customId.slice('music:alternative:'.length);
  const result = takeAlternative(sessionId, interaction.values[0], {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    currentTrack: queue.currentTrack,
  });
  if (result.error) return interaction.reply({ content: result.error, ephemeral: true });
  result.candidate.requestedBy = interaction.user;
  queue.insertTrack(result.candidate, 0);
  if (queue.repeatMode === QueueRepeatMode.TRACK) queue.setRepeatMode(QueueRepeatMode.OFF);
  if (!queue.node.skip()) {
    queue.node.remove(result.candidate);
    return interaction.reply({ content: 'Could not replace the current track. Try again.', ephemeral: true });
  }
  return interaction.update({
    content: `Switching to **${result.candidate.cleanTitle || result.candidate.title}**.`,
    components: [],
    allowedMentions: { parse: [] },
  });
}

async function handleMusicButton(interaction, client) {
  const action = interaction.customId.slice('music:'.length);
  const queue = client.player.nodes.get(interaction.guildId);
  if (!queue || (!queue.currentTrack && queue.isEmpty())) {
    return interaction.reply({ content: '🌙 Hiện không có nhạc trong hàng chờ.', ephemeral: true });
  }

  if (action === 'queue') {
    return interaction.reply({
      embeds: [queueEmbed(queue)],
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
    client.smartDj.stop(interaction.guildId);
    await client.musicLibrary.clearQueue(interaction.guildId)
      .catch(error => console.error('[Music Library]', error));
    queue.delete();
    return interaction.reply({ content: '⏹️ Đã dừng nhạc và xóa hàng chờ.', ephemeral: true });
  }
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('music:alternative:')) {
      try {
        await handleAlternativeSelect(interaction, client);
      } catch (error) {
        console.error('[Music Alternatives]', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Could not switch to that audio version.', ephemeral: true }).catch(() => {});
        }
      }
      return;
    }
    // --- Slash Commands ---
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return interaction.reply({ content: '❌ Lệnh không tồn tại.', ephemeral: true });
      try {
        await command.execute(interaction, client);
      } catch (err) {
        console.error(err);
        if (interaction.deferred) {
          await interaction.editReply({ content: 'Could not complete this command.' }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({ content: 'Could not complete this command.', ephemeral: true }).catch(() => {});
        }
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
