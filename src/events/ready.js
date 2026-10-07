const { startSeasonTicker } = require('../utils/seasonUi');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`✅ Bot online: ${client.user.tag}`);
    client.musicPresence.setDefault();
    client.teamManager.startTicker(client);
    startSeasonTicker(client);
  },
};
