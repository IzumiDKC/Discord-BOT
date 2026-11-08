const test = require('node:test');
const assert = require('node:assert/strict');
const { configureYoutubeDlRuntime } = require('../src/utils/youtubeDlRuntime');

test('Linux uses a standalone yt-dlp binary without changing system Python', () => {
  const env = {};
  configureYoutubeDlRuntime({ env, platform: 'linux', arch: 'x64', runtimeDir: '/tmp/bot-bin' });
  assert.deepEqual(env, { YOUTUBE_DL_FILENAME: 'yt-dlp_linux', YOUTUBE_DL_DIR: '/tmp/bot-bin' });
});

test('Linux arm64 selects the correct release asset and honors overrides', () => {
  const armEnv = {};
  configureYoutubeDlRuntime({ env: armEnv, platform: 'linux', arch: 'arm64', runtimeDir: '/tmp/bot-bin' });
  assert.equal(armEnv.YOUTUBE_DL_FILENAME, 'yt-dlp_linux_aarch64');

  const customEnv = { YOUTUBE_DL_FILENAME: 'custom-dl', YOUTUBE_DL_DIR: '/opt/custom' };
  configureYoutubeDlRuntime({ env: customEnv, platform: 'linux', arch: 'x64', runtimeDir: '/tmp/bot-bin' });
  assert.deepEqual(customEnv, { YOUTUBE_DL_FILENAME: 'custom-dl', YOUTUBE_DL_DIR: '/opt/custom' });
});

test('non-Linux platforms and unsupported architectures keep existing behavior', () => {
  const windowsEnv = {};
  configureYoutubeDlRuntime({ env: windowsEnv, platform: 'win32', arch: 'x64' });
  assert.deepEqual(windowsEnv, {});

  const unknownEnv = {};
  configureYoutubeDlRuntime({ env: unknownEnv, platform: 'linux', arch: 'riscv64' });
  assert.deepEqual(unknownEnv, {});
});
