const test = require('node:test');
const assert = require('node:assert/strict');
const { ActivityType } = require('discord.js');
const { DEFAULT_ACTIVITY, MusicPresence } = require('../src/utils/musicPresence');

function setup() {
  const presences = [];
  const client = {
    user: {
      setPresence(value) {
        presences.push(value);
      },
    },
  };
  return { manager: new MusicPresence(client), presences };
}

test('shows the current song and restores the default activity', () => {
  const { manager, presences } = setup();

  manager.setDefault();
  manager.setPlaying('guild-1', { title: 'Shape of You' });
  manager.clear('guild-1');

  assert.equal(presences[0].activities[0].name, DEFAULT_ACTIVITY);
  assert.equal(presences[0].activities[0].type, ActivityType.Watching);
  assert.equal(presences[1].activities[0].name, 'Shape of You');
  assert.equal(presences[1].activities[0].type, ActivityType.Listening);
  assert.equal(presences[2].activities[0].name, DEFAULT_ACTIVITY);
});

test('marks paused playback as idle and keeps another active guild available', () => {
  const { manager, presences } = setup();

  manager.setPlaying('guild-1', { title: 'First song' });
  manager.setPlaying('guild-2', { title: 'Second song' });
  manager.setPaused('guild-2', true);
  manager.clear('guild-2');

  assert.equal(presences.at(-2).status, 'idle');
  assert.equal(presences.at(-2).activities[0].name, '⏸ Second song');
  assert.equal(presences.at(-1).activities[0].name, 'First song');
});
