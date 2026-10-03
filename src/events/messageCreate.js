const { createAutoReply } = require('../utils/autoReply');
const { playMusicRequest } = require('../utils/musicRequest');
const { musicControls, musicRequestEmbed, statusEmbed } = require('../utils/musicUi');

const MUSIC_REQUEST_CHANNEL_ID = '1299428445469675561';
const pendingRequests = new Map();
const CUSTOM_EMOJI = /<a?:[a-zA-Z0-9_]+:\d+>/g;
const UNICODE_EMOJI = /[#*0-9]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u20E3]/gu;

function musicQueryFromMessage(content) {
  const query = String(content || '')
    .replace(CUSTOM_EMOJI, ' ')
    .replace(UNICODE_EMOJI, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /[\p{L}\p{N}]/u.test(query) ? query : null;
}

async function replyToMusicMessage(message, payload) {
  return message.reply({
    ...payload,
    allowedMentions: { repliedUser: false },
  }).catch(error => {
    console.warn('[Music Request Reply]', error.message);
  });
}

async function handleMusicRequest(message, client) {
  const query = musicQueryFromMessage(message.content);
  if (!query) return;

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    await replyToMusicMessage(message, {
      embeds: [statusEmbed('Bạn chưa vào voice', 'Vào một kênh thoại rồi gửi lại tên bài hoặc link tại đây.', 0xFEE75C)],
    });
    return;
  }

  let playResult;
  try {
    playResult = await playMusicRequest({
      client,
      voiceChannel,
      textChannel: message.channel,
      requester: message.author,
      query,
    });
  } catch (error) {
    console.error('[Music Request Search Error]', error);
    await replyToMusicMessage(message, {
      embeds: [statusEmbed('Không tìm thấy bài phù hợp', 'Thử gửi tên bài + nghệ sĩ hoặc một link nhạc cụ thể.', 0xED4245)],
    });
    return;
  }

  try {
    await replyToMusicMessage(message, {
      embeds: [musicRequestEmbed({
        requester: message.author,
        resolvedInput: playResult.resolvedInput,
        searchResult: playResult.searchResult,
        track: playResult.track,
      })],
      components: musicControls(),
    });
  } catch (error) {
    console.error('[Music Request Confirmation Error]', error);
    await replyToMusicMessage(message, {
      embeds: [statusEmbed('Đã nhận bài hát', `**${playResult.track?.cleanTitle || playResult.track?.title || query}** đã được thêm vào hàng chờ.`, 0x57F287)],
    });
  }
}

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.channelId === MUSIC_REQUEST_CHANNEL_ID) {
      if (message.author?.bot || message.webhookId || !message.guildId) return;

      const previous = pendingRequests.get(message.channelId) || Promise.resolve();
      const current = previous.then(() => handleMusicRequest(message, client))
        .catch(error => console.error('[Music Request]', error));
      pendingRequests.set(message.channelId, current);
      await current;
      if (pendingRequests.get(message.channelId) === current) {
        pendingRequests.delete(message.channelId);
      }
      return;
    }

    const response = createAutoReply(message, client);
    if (!response) return;
    await message.reply(response.payload).catch(error => {
      console.warn('[Auto Reply]', error.message);
    });
  },
};

module.exports.musicQueryFromMessage = musicQueryFromMessage;
