const test = require('node:test');
const assert = require('node:assert/strict');
const { AudioFilters } = require('discord-player');
const musicCommand = require('../src/commands/music/music');
const {
  AUDIO_PRESETS,
  BALANCED_FILTER,
  filtersForPreset,
  getAudioPreset,
  markActiveAudioPreset,
  setAudioPreset,
} = require('../src/utils/musicAudio');
const { playMusicRequest } = require('../src/utils/musicRequest');

function mockQueue() {
  return {
    currentTrack: { title: 'Song' },
    isEmpty: () => false,
    metadata: { audioPreset: AUDIO_PRESETS.BALANCED, activeAudioPreset: AUDIO_PRESETS.BALANCED },
    filters: {
      ffmpeg: {
        filters: [BALANCED_FILTER, 'nightcore'],
        setDefaults(filters) { this.filters = filters; },
        setFilters() { throw new Error('Changing presets must not replay the current track'); },
      },
    },
    setMetadata(metadata) { this.metadata = metadata; },
  };
}

test('Natural and Balanced have distinct, bounded FFmpeg filters', () => {
  assert.deepEqual(filtersForPreset(AUDIO_PRESETS.NATURAL), []);
  assert.deepEqual(filtersForPreset(AUDIO_PRESETS.BALANCED), [BALANCED_FILTER]);
  assert.equal(AudioFilters.get(BALANCED_FILTER), 'dynaudnorm=f=500:g=31:m=3:p=0.9');
  assert.throws(() => filtersForPreset('loud'), RangeError);
});

test('changing presets preserves other filters and never replays a track', () => {
  const queue = mockQueue();

  setAudioPreset(queue, AUDIO_PRESETS.NATURAL);
  assert.deepEqual(queue.filters.ffmpeg.filters, ['nightcore']);
  assert.equal(getAudioPreset(queue), AUDIO_PRESETS.NATURAL);
  assert.equal(queue.metadata.activeAudioPreset, AUDIO_PRESETS.BALANCED);

  setAudioPreset(queue, AUDIO_PRESETS.BALANCED);
  assert.deepEqual(queue.filters.ffmpeg.filters, ['nightcore', BALANCED_FILTER]);
  markActiveAudioPreset(queue);
  assert.equal(queue.metadata.activeAudioPreset, AUDIO_PRESETS.BALANCED);
});

test('new requests use Balanced and retain an existing Natural selection', async () => {
  const voiceChannel = { guild: { id: 'guild-1' } };
  const textChannel = { id: 'text-1' };
  const requester = { id: 'user-1' };
  let queue = null;
  let options;
  const client = {
    player: {
      nodes: { get: () => queue },
      play: async (_channel, _query, playOptions) => {
        options = playOptions.nodeOptions;
        if (!queue) {
          queue = {
            metadata: options.metadata,
            setMetadata(metadata) { this.metadata = metadata; },
          };
        }
        return { track: { title: 'Song' } };
      },
    },
  };

  await playMusicRequest({ client, voiceChannel, textChannel, requester, query: 'Song' });
  assert.deepEqual(options.defaultFFmpegFilters, [BALANCED_FILTER]);
  assert.equal(options.bufferingTimeout, 1_000);
  assert.equal(queue.metadata.audioPreset, AUDIO_PRESETS.BALANCED);

  queue.metadata.audioPreset = AUDIO_PRESETS.NATURAL;
  queue.metadata.activeAudioPreset = AUDIO_PRESETS.BALANCED;
  await playMusicRequest({ client, voiceChannel, textChannel, requester, query: 'Next Song' });
  assert.deepEqual(options.defaultFFmpegFilters, []);
  assert.equal(queue.metadata.audioPreset, AUDIO_PRESETS.NATURAL);
  assert.equal(queue.metadata.activeAudioPreset, AUDIO_PRESETS.BALANCED);
});

test('/music preset and normalize update upcoming tracks without deferring', async () => {
  const queue = mockQueue();
  const replies = [];
  const options = { subcommand: 'preset', mode: AUDIO_PRESETS.NATURAL, enabled: null };
  const interaction = {
    guildId: 'guild-1',
    guild: { members: { me: { voice: { channelId: 'voice-1' } } } },
    member: { voice: { channelId: 'voice-1' } },
    options: {
      getSubcommand: () => options.subcommand,
      getString: () => options.mode,
      getBoolean: () => options.enabled,
    },
    reply: async message => { replies.push(message); },
    deferReply: () => { throw new Error('Preset updates should reply immediately'); },
  };
  const client = { player: { nodes: { get: () => queue } } };

  await musicCommand.execute(interaction, client);
  assert.equal(queue.metadata.audioPreset, AUDIO_PRESETS.NATURAL);
  assert.match(replies[0], /next track/);

  options.subcommand = 'normalize';
  options.enabled = true;
  await musicCommand.execute(interaction, client);
  assert.equal(queue.metadata.audioPreset, AUDIO_PRESETS.BALANCED);
  assert.match(replies[1], /Balanced/);

  const preset = musicCommand.data.toJSON().options.find(option => option.name === 'preset');
  assert.deepEqual(preset.options[0].choices.map(choice => choice.value), ['natural', 'balanced']);
  assert.ok(musicCommand.data.toJSON().options.some(option => option.name === 'health'));
});
