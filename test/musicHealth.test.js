const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const musicCommand = require('../src/commands/music/music');
const { MusicHealthMonitor, startMusicHealth, stopMusicHealth } = require('../src/utils/musicHealth');

test('reports audio underruns, buffering, voice changes, and cleans up', () => {
  const player = new EventEmitter();
  player.state = { status: AudioPlayerStatus.Playing, missedFrames: 0 };
  const connection = new EventEmitter();
  connection.ping = { udp: 42.4, ws: 60.1 };
  const queue = {
    id: 'guild-1',
    currentTrack: { source: 'youtube' },
    dispatcher: { audioPlayer: player },
    connection,
  };
  const lines = [];
  let currentTime = 0;
  let tick;
  let cleared = false;
  const monitor = new MusicHealthMonitor(queue, {
    now: () => currentTime,
    log: line => lines.push(line),
    setIntervalFn: callback => { tick = callback; return { unref() {} }; },
    clearIntervalFn: () => { cleared = true; },
  }).start();

  currentTime = 100;
  player.state.missedFrames = 3;
  tick();
  assert.match(lines[0], /event=underrun.*udp_ms=42.*missed_frames=3/);
  assert.deepEqual(monitor.snapshot(), {
    status: AudioPlayerStatus.Playing,
    source: 'youtube',
    udpPingMs: 42,
    wsPingMs: 60,
    underrunStreaks: 1,
    maxMissedFrames: 3,
    maxEventLoopLagMs: 0,
  });

  currentTime = 200;
  player.state.missedFrames = 0;
  tick();
  currentTime = 300;
  player.emit('stateChange', { status: AudioPlayerStatus.Playing }, { status: AudioPlayerStatus.Buffering });
  currentTime = 900;
  player.emit('stateChange', { status: AudioPlayerStatus.Buffering }, { status: AudioPlayerStatus.Playing });
  assert.ok(lines.some(line => line.includes('event=buffering') && line.includes('duration_ms=600')));

  connection.emit('stateChange',
    { status: VoiceConnectionStatus.Ready },
    { status: VoiceConnectionStatus.Disconnected });
  assert.ok(lines.some(line => line.includes('event=voice_state')));

  player.emit('stateChange',
    { status: AudioPlayerStatus.Playing, missedFrames: 5, resource: { ended: true } },
    { status: AudioPlayerStatus.Idle });
  assert.equal(lines.filter(line => line.includes('event=ended_after_underrun')).length, 0);
  player.emit('stateChange',
    { status: AudioPlayerStatus.Playing, missedFrames: 5, resource: { ended: false } },
    { status: AudioPlayerStatus.Idle });
  assert.equal(lines.filter(line => line.includes('event=ended_after_underrun')).length, 1);

  for (let time = 1_000; time <= 30_000; time += 100) {
    currentTime = time;
    tick();
  }
  assert.ok(lines.some(line => line.includes('event=summary') && line.includes('underrun_streaks=1')));

  monitor.stop();
  assert.equal(cleared, true);
  assert.equal(player.listenerCount('stateChange'), 0);
  assert.equal(connection.listenerCount('stateChange'), 0);
});

test('/music health shows recent playback metrics without requiring voice', async () => {
  const player = new EventEmitter();
  player.state = { status: AudioPlayerStatus.Playing, missedFrames: 0 };
  const connection = new EventEmitter();
  connection.ping = { udp: 38, ws: 51 };
  const queue = {
    id: 'guild-1',
    currentTrack: { source: 'youtube' },
    isEmpty: () => false,
    dispatcher: { audioPlayer: player },
    connection,
  };
  const client = { player: { nodes: { get: () => queue } } };
  let reply;
  const interaction = {
    guildId: 'guild-1',
    member: { voice: { channelId: null } },
    options: { getSubcommand: () => 'health' },
    reply: async payload => { reply = payload; },
  };

  startMusicHealth(queue);
  try {
    await musicCommand.execute(interaction, client);
    assert.match(reply.content, /UDP \*\*38 ms\*\*/);
    assert.match(reply.content, /underrun streaks/);
    assert.equal(reply.ephemeral, true);
  } finally {
    stopMusicHealth(queue);
  }
});
