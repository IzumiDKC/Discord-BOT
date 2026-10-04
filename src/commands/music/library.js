const { SlashCommandBuilder, escapeMarkdown } = require('discord.js');
const { playMusicRequest } = require('../../utils/musicRequest');
const { MAX_PLAYLIST_TRACKS, MAX_SNAPSHOT, playlistKey } = require('../../utils/musicLibrary');

const loadingGuilds = new Set();

function listSongs(songs, limit = 10) {
  return songs.slice(0, limit).map((song, index) =>
    `**${index + 1}.** [${escapeMarkdown(song.title)}](${song.url})${song.author ? ` - ${escapeMarkdown(song.author)}` : ''}`
  ).join('\n') || '_Nothing saved yet._';
}

function voiceForPlayback(interaction) {
  const voice = interaction.member.voice?.channel;
  const botVoiceId = interaction.guild.members.me?.voice?.channelId;
  return voice && (!botVoiceId || voice.id === botVoiceId) ? voice : null;
}

async function playSavedSongs(interaction, client, songs, requireEmpty) {
  const limit = requireEmpty ? MAX_SNAPSHOT : MAX_PLAYLIST_TRACKS;
  const voiceChannel = voiceForPlayback(interaction);
  if (!voiceChannel) return interaction.reply({ content: 'Join the bot in voice first.', ephemeral: true });
  const queue = client.player.nodes.get(interaction.guildId);
  if (requireEmpty && queue && (queue.currentTrack || !queue.isEmpty())) {
    return interaction.reply({ content: 'The queue is already active. Stop it before restoring a saved queue.', ephemeral: true });
  }
  if (!songs.length) return interaction.reply({ content: 'No saved tracks to play.', ephemeral: true });
  if (loadingGuilds.has(interaction.guildId)) {
    return interaction.reply({ content: 'A saved playlist is already loading.', ephemeral: true });
  }
  await interaction.deferReply();
  loadingGuilds.add(interaction.guildId);
  let count = 0;
  try {
    for (const song of songs.slice(0, limit)) {
      try {
        await playMusicRequest({
          client,
          voiceChannel,
          textChannel: interaction.channel,
          requester: interaction.user,
          query: song.url,
        });
        count += 1;
      } catch (error) {
        console.warn('[Music Library] Could not load saved track:', song.url, error.message);
      }
    }
  } finally {
    loadingGuilds.delete(interaction.guildId);
  }
  return interaction.editReply(count
    ? `Added **${count}/${Math.min(songs.length, limit)}** saved tracks to the queue.`
    : 'None of the saved tracks could be loaded.');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('library').setDescription('Favorites, playlists, history, and saved queue')
    .addSubcommand(sub => sub.setName('favorite').setDescription('Save the currently playing song'))
    .addSubcommand(sub => sub.setName('favorites').setDescription('Show your favorite songs'))
    .addSubcommand(sub => sub.setName('unfavorite').setDescription('Remove a favorite by its list number')
      .addIntegerOption(option => option.setName('number').setDescription('Number shown by /library favorites').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub.setName('save').setDescription('Save the current queue as a personal playlist')
      .addStringOption(option => option.setName('name').setDescription('Playlist name').setMinLength(1).setMaxLength(40).setRequired(true)))
    .addSubcommand(sub => sub.setName('playlists').setDescription('Show your saved playlists'))
    .addSubcommand(sub => sub.setName('load').setDescription('Add a saved playlist to the queue')
      .addStringOption(option => option.setName('name').setDescription('Playlist name').setRequired(true)))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete a saved playlist')
      .addStringOption(option => option.setName('name').setDescription('Playlist name').setRequired(true)))
    .addSubcommand(sub => sub.setName('history').setDescription('Show recently played songs'))
    .addSubcommand(sub => sub.setName('resume').setDescription('Restore the queue saved before the bot restarted')),

  async execute(interaction, client) {
    const library = client.musicLibrary;
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const name = interaction.options.getString('name');
    const queue = client.player.nodes.get(guildId);

    if (sub === 'favorite') {
      if (!queue?.currentTrack) return interaction.reply({ content: 'No song is playing.', ephemeral: true });
      const added = await library.addFavorite(userId, queue.currentTrack);
      return interaction.reply({ content: added ? 'Added to your favorites.' : 'This song is already in your favorites.', ephemeral: true });
    }
    if (sub === 'favorites') {
      return interaction.reply({ content: `**Your favorites**\n${listSongs(library.favorites(userId))}`, ephemeral: true, allowedMentions: { parse: [] } });
    }
    if (sub === 'unfavorite') {
      const removed = await library.removeFavorite(userId, interaction.options.getInteger('number', true) - 1);
      return interaction.reply({ content: removed ? `Removed **${escapeMarkdown(removed.title)}**.` : 'No favorite has that number.', ephemeral: true, allowedMentions: { parse: [] } });
    }
    if (sub === 'save') {
      if (!queue?.currentTrack) return interaction.reply({ content: 'Nothing is playing to save.', ephemeral: true });
      const playlist = await library.savePlaylist(userId, name, [queue.currentTrack, ...queue.tracks.toArray()]);
      return interaction.reply({ content: `Saved **${escapeMarkdown(playlist.name)}** (${playlist.tracks.length} tracks).`, ephemeral: true, allowedMentions: { parse: [] } });
    }
    if (sub === 'playlists') {
      const entries = Object.values(library.playlists(userId));
      const lines = entries.map(item => `• **${escapeMarkdown(item.name)}** (${item.tracks.length} tracks)`);
      return interaction.reply({ content: `**Your playlists**\n${lines.join('\n') || '_Nothing saved yet._'}`, ephemeral: true, allowedMentions: { parse: [] } });
    }
    if (sub === 'load') {
      const playlist = library.playlists(userId)[playlistKey(name)];
      return playSavedSongs(interaction, client, playlist?.tracks || [], false);
    }
    if (sub === 'delete') {
      const deleted = await library.deletePlaylist(userId, name);
      return interaction.reply({ content: deleted ? 'Playlist deleted.' : 'Playlist not found.', ephemeral: true });
    }
    if (sub === 'history') {
      return interaction.reply({ content: `**Recently played**\n${listSongs(library.history(guildId))}`, ephemeral: true, allowedMentions: { parse: [] } });
    }
    if (sub === 'resume') {
      return playSavedSongs(interaction, client, library.snapshot(guildId), true);
    }
  },
};
