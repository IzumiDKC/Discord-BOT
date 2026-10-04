const { AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');

const SAMPLE_MS = 100;
const REPORT_MS = 30_000;
const monitors = new WeakMap();

class MusicHealthMonitor {
  constructor(queue, {
    now = Date.now,
    log = line => console.log(line),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = {}) {
    this.queue = queue;
    this.dispatcher = queue.dispatcher;
    this.player = this.dispatcher.audioPlayer;
    this.connection = queue.connection;
    this.now = now;
    this.log = log;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.lastSampleAt = now();
    this.lastReportAt = this.lastSampleAt;
    this.bufferingAt = null;
    this.lastMissedFrames = 0;
    this.reportedUnderrun = false;
    this.underrunStreaks = 0;
    this.maxMissedFrames = 0;
    this.maxEventLoopLagMs = 0;
    this.timer = null;
    this.onPlayerStateChange = this.onPlayerStateChange.bind(this);
    this.onVoiceStateChange = this.onVoiceStateChange.bind(this);
  }

  metric(value) {
    return Number.isFinite(value) ? Math.round(value) : 'na';
  }

  report(event, details = '') {
    const source = this.queue.currentTrack?.source || 'unknown';
    const ping = this.connection?.ping || {};
    this.log(`[Music Health] guild=${this.queue.id} source=${source} event=${event}`
      + ` udp_ms=${this.metric(ping.udp)} ws_ms=${this.metric(ping.ws)}`
      + (details ? ` ${details}` : ''));
  }

  start() {
    this.player.on('stateChange', this.onPlayerStateChange);
    this.connection.on('stateChange', this.onVoiceStateChange);
    this.timer = this.setIntervalFn(() => this.sample(), SAMPLE_MS);
    this.timer.unref?.();
    return this;
  }

  onPlayerStateChange(oldState, newState) {
    if (newState.status === AudioPlayerStatus.Buffering) this.bufferingAt = this.now();
    if (oldState.status === AudioPlayerStatus.Buffering && this.bufferingAt !== null) {
      const elapsed = this.now() - this.bufferingAt;
      if (elapsed >= 250) this.report('buffering', `duration_ms=${elapsed}`);
      this.bufferingAt = null;
    }
    if (oldState.status === AudioPlayerStatus.Playing
      && newState.status === AudioPlayerStatus.Idle
      && oldState.missedFrames > 0
      && !oldState.resource?.ended) {
      this.report('ended_after_underrun', `missed_frames=${oldState.missedFrames}`);
    }
  }

  onVoiceStateChange(oldState, newState) {
    if (oldState.status === newState.status) return;
    if (oldState.status === VoiceConnectionStatus.Ready
      || newState.status === VoiceConnectionStatus.Ready) {
      this.report('voice_state', `from=${oldState.status} to=${newState.status}`);
    }
  }

  sample() {
    const current = this.now();
    this.maxEventLoopLagMs = Math.max(
      this.maxEventLoopLagMs,
      Math.max(0, current - this.lastSampleAt - SAMPLE_MS)
    );
    this.lastSampleAt = current;

    const state = this.player.state;
    const missed = state.status === AudioPlayerStatus.Playing && !state.resource?.ended
      ? state.missedFrames || 0
      : 0;
    if (missed > 0) {
      if (this.lastMissedFrames === 0) this.underrunStreaks += 1;
      this.maxMissedFrames = Math.max(this.maxMissedFrames, missed);
      if (missed >= 3 && !this.reportedUnderrun) {
        this.report('underrun', `missed_frames=${missed}`);
        this.reportedUnderrun = true;
      }
    } else {
      this.reportedUnderrun = false;
    }
    this.lastMissedFrames = missed;

    if (current - this.lastReportAt < REPORT_MS) return;
    if (state.status === AudioPlayerStatus.Playing || this.underrunStreaks > 0) {
      this.report('summary', `underrun_streaks=${this.underrunStreaks}`
        + ` max_missed_frames=${this.maxMissedFrames}`
        + ` max_loop_lag_ms=${this.maxEventLoopLagMs}`);
    }
    this.lastReportAt = current;
    this.underrunStreaks = 0;
    this.maxMissedFrames = 0;
    this.maxEventLoopLagMs = 0;
  }

  snapshot() {
    const ping = this.connection?.ping || {};
    return {
      status: this.player.state.status,
      source: this.queue.currentTrack?.source || 'unknown',
      udpPingMs: Number.isFinite(ping.udp) ? Math.round(ping.udp) : null,
      wsPingMs: Number.isFinite(ping.ws) ? Math.round(ping.ws) : null,
      underrunStreaks: this.underrunStreaks,
      maxMissedFrames: this.maxMissedFrames,
      maxEventLoopLagMs: this.maxEventLoopLagMs,
    };
  }

  stop() {
    if (this.timer !== null) this.clearIntervalFn(this.timer);
    this.timer = null;
    this.player.off('stateChange', this.onPlayerStateChange);
    this.connection.off('stateChange', this.onVoiceStateChange);
  }
}

function startMusicHealth(queue) {
  if (!queue?.dispatcher?.audioPlayer || !queue.connection) return null;
  const previous = monitors.get(queue);
  if (previous?.dispatcher === queue.dispatcher) return previous;
  previous?.stop();
  const monitor = new MusicHealthMonitor(queue).start();
  monitors.set(queue, monitor);
  return monitor;
}

function stopMusicHealth(queue) {
  const monitor = monitors.get(queue);
  monitor?.stop();
  monitors.delete(queue);
}

function getMusicHealth(queue) {
  return monitors.get(queue)?.snapshot() || null;
}

module.exports = { MusicHealthMonitor, getMusicHealth, startMusicHealth, stopMusicHealth };
