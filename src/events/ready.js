module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`✅ Bot online: ${client.user.tag}`);
    client.musicPresence.setDefault();
  },
};
