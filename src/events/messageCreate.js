// Auto-reply theo keyword
const autoReplies = [
  { keywords: ['xin chào', 'hello', 'hi', 'chào'], reply: '👋 Chào bạn! Mình là bot của server này.' },
  { keywords: ['bot làm gì', 'help', 'lệnh'], reply: '📋 Dùng `/` để xem danh sách lệnh nhé!' },
  { keywords: ['gg', 'good game'], reply: '🎉 GG WP!' },
];

module.exports = {
  name: 'messageCreate',
  execute(message) {
    if (message.author.bot) return;

    const content = message.content.toLowerCase().trim();

    for (const ar of autoReplies) {
      if (ar.keywords.some(kw => content.includes(kw))) {
        message.reply(ar.reply);
        return; // chỉ reply 1 lần
      }
    }
  },
};
