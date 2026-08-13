const { EmbedBuilder } = require('discord.js');
const { trackTitle } = require('./musicPresence');

const COOLDOWN_MS = 8_000;
const cooldowns = new Map();

function normalizeText(value) {
  return String(value || '')
    .replace(/[đĐ]/g, match => match === 'Đ' ? 'D' : 'd')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/<@!?\d+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isAddressed(message, normalized) {
  const botId = message.client?.user?.id;
  const mentioned = botId ? message.mentions?.users?.has?.(botId) : false;
  return Boolean(mentioned || /\b(momoka|bot|momo)\b/.test(normalized));
}

function detectIntent(content, addressed = false) {
  const normalized = normalizeText(content);
  const wordCount = normalized ? normalized.split(' ').length : 0;

  if (/\b(dang phat bai gi|bai gi dang phat|nhac gi day|now playing|what is playing|what s playing)\b/.test(normalized)) return 'now_playing';
  if (/\b(hang cho|danh sach nhac|music queue|queue nhac|con bao nhieu bai)\b/.test(normalized)) return 'queue';
  if (/\b(cach phat nhac|mo nhac|phat nhac|lenh nhac|play music|music help)\b/.test(normalized)) return 'music_help';
  if (/\b(skip|bo qua|pause|tam dung|resume|tiep tuc|volume|am luong|loop|lap lai|shuffle|xao tron)\b/.test(normalized) && addressed) return 'controls';
  if (/\b(bot lam gi|lam duoc gi|huong dan|tro giup|help|danh sach lenh|lenh gi)\b/.test(normalized) && (addressed || wordCount <= 3)) return 'help';
  if (/\b(ten gi|ban la ai|m la ai|who are you)\b/.test(normalized) && addressed) return 'identity';
  if (/^(xin chao|chao|hello|hi|hey|alo)( momoka| bot| momo)?$/.test(normalized)) return 'greeting';
  if (/\b(cam on|thanks|thank you|tks)\b/.test(normalized) && addressed) return 'thanks';
  return addressed ? 'fallback' : null;
}

function currentQueue(message, client) {
  return message.guildId ? client.player?.nodes?.get(message.guildId) : null;
}

function responseFor(intent, message, client) {
  const queue = currentQueue(message, client);
  const current = queue?.currentTrack;

  switch (intent) {
    case 'now_playing':
      return current
        ? {
            title: '🎵 Đang phát',
            description: `**[${trackTitle(current)}](${current.url})**\nCòn **${queue.tracks.size} bài** trong hàng chờ • âm lượng **${queue.node.volume}%**.`,
          }
        : { title: '🌙 Đang yên tĩnh', description: 'Hiện chưa có nhạc. Vào voice rồi dùng `/play` nhé.' };
    case 'queue':
      return current
        ? { title: '📜 Hàng chờ', description: `Đang phát **${trackTitle(current)}**, phía sau còn **${queue.tracks.size} bài**. Dùng \`/music queue\` để xem chi tiết.` }
        : { title: '📭 Hàng chờ trống', description: 'Dùng `/play query:<tên bài hoặc link>` để bắt đầu.' };
    case 'music_help':
      return {
        title: '🎧 Phát nhạc cùng Momoka',
        description: 'Vào một kênh voice rồi dùng `/play`. Mình nhận **tên bài**, link **YouTube**, **Spotify album/playlist** và **SoundCloud**.\n\nĐiều khiển bằng `/music` hoặc các nút dưới thẻ Now Playing.',
      };
    case 'controls':
      return {
        title: '🎛️ Điều khiển nhạc',
        description: '`/music skip` • `/music pause` • `/music resume`\n`/music volume` • `/music loop` • `/music shuffle` • `/music stop`',
      };
    case 'help':
      return {
        title: '✨ Momoka có thể giúp gì?',
        description: '🎵 `/play` và `/music` — phát, xếp hàng và điều khiển nhạc\n🎫 `/ticket` — hỗ trợ ticket\n📡 `/ping` — kiểm tra độ trễ\nℹ️ `/info` — thông tin bot',
      };
    case 'identity':
      return { title: '🌸 Momoka', description: 'Mình là bot âm nhạc và tiện ích của server. Gọi “Momoka” hoặc mention mình khi cần nhé.' };
    case 'thanks':
      return { title: '💗 Không có gì!', description: 'Cứ gọi Momoka khi bạn cần thêm nhạc nhé.' };
    case 'greeting':
      return { title: `👋 Chào ${message.member?.displayName || message.author.username}!`, description: 'Momoka đây. Muốn nghe gì thì vào voice và dùng `/play` nha 🎶' };
    case 'fallback':
      return { title: '🤔 Mình chưa hiểu rõ', description: 'Bạn thử nói “Momoka phát nhạc thế nào?”, “đang phát bài gì?” hoặc dùng `/` để xem lệnh nhé.' };
    default:
      return null;
  }
}

function createAutoReply(message, client, now = Date.now()) {
  if (!message.content || message.author.bot) return null;

  const normalized = normalizeText(message.content);
  const addressed = isAddressed(message, normalized);
  const intent = detectIntent(normalized, addressed);
  if (!intent) return null;

  const cooldownKey = `${message.guildId || 'dm'}:${message.author.id}`;
  const lastReply = cooldowns.get(cooldownKey) || 0;
  if (now - lastReply < COOLDOWN_MS) return null;
  cooldowns.set(cooldownKey, now);

  const response = responseFor(intent, message, client);
  if (!response) return null;

  return {
    intent,
    payload: {
      embeds: [new EmbedBuilder()
        .setColor(0xF2A6C6)
        .setTitle(response.title)
        .setDescription(response.description)
        .setFooter({ text: 'Momoka • nhắc tên mình để trò chuyện' })],
      allowedMentions: { repliedUser: false },
    },
  };
}

function resetCooldowns() {
  cooldowns.clear();
}

module.exports = {
  COOLDOWN_MS,
  createAutoReply,
  detectIntent,
  normalizeText,
  resetCooldowns,
};
