const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IDLE_DISCONNECT_MS,
  MusicIdleManager,
  idleDisconnectMessage,
} = require('../src/utils/musicIdle');

function setup() {
  const callbacks = [];
  const cleared = [];
  const manager = new MusicIdleManager({
    setTimer(callback, delay) {
      const timer = { callback, delay, unref() {} };
      callbacks.push(timer);
      return timer;
    },
    clearTimer(timer) {
      cleared.push(timer);
    },
  });
  const queue = {
    currentTrack: null,
    deleteCalls: 0,
    guild: { id: 'guild-1' },
    isEmpty: () => true,
    delete() {
      this.deleteCalls += 1;
    },
  };

  return { callbacks, cleared, manager, queue };
}

test('waits five minutes before leaving an idle voice channel', () => {
  const { callbacks, manager, queue } = setup();

  manager.schedule(queue);
  assert.equal(callbacks[0].delay, IDLE_DISCONNECT_MS);
  assert.match(idleDisconnectMessage(), /5 phút/);

  callbacks[0].callback();
  assert.equal(queue.deleteCalls, 1);
});

test('cancels and resets the idle timer when playback resumes', () => {
  const { callbacks, cleared, manager, queue } = setup();

  manager.schedule(queue);
  assert.equal(manager.cancel(queue), true);
  assert.equal(cleared.length, 1);

  manager.schedule(queue);
  manager.schedule(queue);
  assert.equal(cleared.length, 2);
  callbacks.at(-1).callback();
  assert.equal(queue.deleteCalls, 1);
});

test('stays connected if a track appears before the timer expires', () => {
  const { callbacks, manager, queue } = setup();

  manager.schedule(queue);
  queue.currentTrack = { title: 'New song' };
  callbacks[0].callback();

  assert.equal(queue.deleteCalls, 0);
});
