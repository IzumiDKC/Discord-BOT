const { createAutoReply } = require('../utils/autoReply');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    const response = createAutoReply(message, client);
    if (!response) return;
    await message.reply(response.payload).catch(error => {
      console.warn('[Auto Reply]', error.message);
    });
  },
};
