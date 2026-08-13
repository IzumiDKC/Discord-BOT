const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { QueueRepeatMode } = require('discord-player');
const { playbackSourceLabel } = require('./smartMusicBridge');
const { platformLabel } = require('./musicSource');
const { trackTitle, truncate } = require('./musicPresence');

const COLORS = {
  danger: 0xED4245,
  neutral: 0x5865F2,
  spotify: 0x1DB954,
  soundcloud: 0xFF5500,
  success: 0x57F287,
  youtube: 0xFF0033,
};

function sourceColor(source) {
  return COLORS[source] || COLORS.neutral;
}

function sourceIcon(source) {
  return {
    apple_music: '🍎',
    soundcloud: '☁️',
    spotify: '🟢',
    youtube: '🔴',
  }[source] || '🎵';
}

function requesterLabel(track) {
  const user = track?.requestedBy;
  return user?.id ? `<@${user.id}>` : user?.username || 'Không rõ';
}

function queueSize(queue) {
  return queue?.tracks?.size ?? queue?.tracks?.toArray?.().length ?? 0;
}

function musicControls() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music:pause-resume')
      .setEmoji('⏯️')
      .setLabel('Pause / Resume')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('music:skip')
      .setEmoji('⏭️')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:queue')
      .setEmoji('📜')
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:stop')
      .setEmoji('⏹️')
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger),
  )];
}

function progressLine(queue) {
  const timestamp = queue?.node?.getTimestamp?.();
  const bar = queue?.node?.createProgressBar?.({ length: 16, indicator: '●', leftChar: '▬', rightChar: '▬' });
  if (!timestamp) return '`Live / không rõ thời lượng`';
  return `${bar || '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬'}\n\`${timestamp.current.label} / ${timestamp.total.label}\``;
}

function nowPlayingEmbed(queue, track) {
  const source = track?.source || 'unknown';
  return new EmbedBuilder()
    .setColor(sourceColor(source))
    .setAuthor({ name: 'NOW PLAYING  •  MOMOKA MUSIC' })
    .setTitle(truncate(trackTitle(track), 250))
    .setURL(track.url)
    .setDescription(progressLine(queue))
    .addFields(
      { name: '🎧 Yêu cầu bởi', value: requesterLabel(track), inline: true },
      { name: '🔊 Âm lượng', value: `\`${queue.node.volume}%\``, inline: true },
      { name: '📜 Tiếp theo', value: `\`${queueSize(queue)} bài\``, inline: true },
    )
    .setFooter({ text: `${sourceIcon(source)} ${playbackSourceLabel(track)}  •  /music để điều khiển` })
    .setThumbnail(track.thumbnail || null)
    .setTimestamp();
}

function addedToQueueEmbed({
  collection,
  interaction,
  notice,
  playbackDescription,
  resolvedInput,
  shouldShuffle,
  track,
  trackCount,
}) {
  const isCollection = Boolean(collection);
  const source = resolvedInput.platform;
  const itemTitle = isCollection ? collection.title : trackTitle(track);
  const itemUrl = isCollection ? collection.url : track.url;
  const typeLabel = isCollection
    ? collection.type === 'album' ? 'ALBUM ĐÃ THÊM' : 'PLAYLIST ĐÃ THÊM'
    : 'ĐÃ THÊM VÀO HÀNG CHỜ';

  return new EmbedBuilder()
    .setColor(sourceColor(source))
    .setAuthor({ name: `${sourceIcon(source)} ${typeLabel}${shouldShuffle ? '  •  SHUFFLED' : ''}` })
    .setTitle(truncate(itemTitle, 250))
    .setURL(itemUrl)
    .setDescription(notice ? `> ${notice}` : `> ${playbackDescription}`)
    .addFields(
      {
        name: isCollection ? '🎼 Số bài' : '⏱️ Thời lượng',
        value: isCollection ? `\`${trackCount}\`` : `\`${track.duration || 'Không rõ'}\``,
        inline: true,
      },
      { name: '🌐 Nguồn', value: `\`${platformLabel(source)}\``, inline: true },
      { name: '👤 Người thêm', value: `<@${interaction.user.id}>`, inline: true },
    )
    .setFooter({ text: shouldShuffle ? 'Thứ tự đã được xáo trộn' : 'Momoka Music • âm lượng mặc định 55%' })
    .setThumbnail((isCollection ? collection.thumbnail : track.thumbnail) || null)
    .setTimestamp();
}

function loopLabel(queue) {
  return queue.repeatMode === QueueRepeatMode.TRACK ? 'Track' : 'Off';
}

function shuffleLabel(queue) {
  return queue.isShuffling ? 'On' : 'Off';
}

function trackLine(track, index) {
  const title = truncate(trackTitle(track).replace(/[\[\]]/g, ''), 60);
  const duration = track.duration || '??:??';
  return `\`${String(index + 1).padStart(2, '0')}\`  [${title}](${track.url})  \`${duration}\``;
}

function queueEmbed(queue, isNormalizationEnabled = () => false) {
  const tracks = queue.tracks.toArray();
  const current = queue.currentTrack;
  const list = tracks.slice(0, 10).map(trackLine).join('\n') || '_Hàng chờ đang trống._';
  const source = current?.source || 'neutral';

  return new EmbedBuilder()
    .setColor(sourceColor(source))
    .setAuthor({ name: 'MOMOKA MUSIC  •  QUEUE' })
    .setTitle(current ? truncate(trackTitle(current), 250) : 'Không có bài đang phát')
    .setURL(current?.url || null)
    .setDescription(current ? progressLine(queue) : '_Dùng `/play` để thêm nhạc._')
    .addFields(
      { name: '🔊 Volume', value: `\`${queue.node.volume}%\``, inline: true },
      { name: '🔁 Loop', value: `\`${loopLabel(queue)}\``, inline: true },
      { name: '🔀 Shuffle', value: `\`${shuffleLabel(queue)}\``, inline: true },
      { name: '🎚️ Normalize', value: `\`${isNormalizationEnabled(queue) ? 'On' : 'Off'}\``, inline: true },
      { name: `UP NEXT  •  ${tracks.length} TRACKS`, value: list, inline: false },
    )
    .setFooter({ text: tracks.length > 10 ? `Đang hiển thị 10/${tracks.length} bài` : 'Momoka Music • /music skip | pause | stop' })
    .setThumbnail(current?.thumbnail || null)
    .setTimestamp();
}

function statusEmbed(title, description, color = COLORS.neutral) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Momoka Music' })
    .setTimestamp();
}

module.exports = {
  COLORS,
  addedToQueueEmbed,
  musicControls,
  nowPlayingEmbed,
  progressLine,
  queueEmbed,
  requesterLabel,
  sourceColor,
  sourceIcon,
  statusEmbed,
};
