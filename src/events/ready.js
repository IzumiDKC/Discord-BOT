// Danh sách status xoay vòng
const statuses = [
  { type: 'PLAYING', text: '🎮  với Hùng Canh Mộ' },
  { type: 'LISTENING', text: '🎵 nhạc với Dùng Thanh Nộ' },
  { type: 'WATCHING', text: '👁️ Mixue' },
  { type: 'STREAMING', text: '📺 con chó Cao Bằng Bộ PC' },
];

let index = 0;

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`✅ Bot online: ${client.user.tag}`);

    const setStatus = () => {
      const s = statuses[index % statuses.length];
    client.user.setPresence({
        activities: [{ name: s.text, type: activityType(s.type) }],
      status: 'online',
    });
      index++;
    };

    setStatus();
    setInterval(setStatus, 15_000); 
  },
};

function activityType(type) {
  const { ActivityType } = require('discord.js');
  const map = {
    PLAYING: ActivityType.Playing,
    LISTENING: ActivityType.Listening,
    WATCHING: ActivityType.Watching,
    STREAMING: ActivityType.Streaming,
  };
  return map[type] ?? ActivityType.Playing;
}
