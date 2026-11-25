const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { configureYoutubeDlRuntime, ensureYoutubeDlBinary } = require('../src/utils/youtubeDlRuntime');

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

test('ensureYoutubeDlBinary repairs missing or corrupted binary atomically and skips healthy fresh binary', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-runtime-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const binaryPath = path.join(dir, 'yt-dlp_linux');

  const constants = {
    YOUTUBE_DL_PATH: binaryPath,
    YOUTUBE_DL_DIR: dir,
    YOUTUBE_DL_FILE: 'yt-dlp_linux',
    YOUTUBE_DL_HOST: 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
  };

  let downloads = 0;
  const fetchFn = async url => {
    downloads += 1;
    if (url.includes('api.github.com')) {
      return {
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          assets: [{ name: 'yt-dlp_linux', browser_download_url: 'https://example.com/yt-dlp_linux' }],
        }),
      };
    }
    return {
      ok: true,
      headers: new Map([['content-type', 'application/octet-stream']]),
      body: Readable.from([Buffer.from('valid-binary-content')]),
    };
  };

  const repaired = await ensureYoutubeDlBinary({
    constants,
    checkFn: async () => { throw new Error('corrupted'); },
    fetchFn,
  });
  assert.equal(repaired.status, 'installed');
  assert.equal(fs.readFileSync(binaryPath, 'utf8'), 'valid-binary-content');
  assert.equal(downloads, 2);

  const healthy = await ensureYoutubeDlBinary({
    constants,
    checkFn: async () => ({ stdout: '2026.11.01\n' }),
    fetchFn,
  });
  assert.equal(healthy.status, 'healthy');
  assert.equal(downloads, 2);
});
