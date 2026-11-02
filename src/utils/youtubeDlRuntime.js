const path = require('node:path');

function configureYoutubeDlRuntime({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  runtimeDir = path.join(__dirname, '..', '..', 'data', 'bin'),
} = {}) {
  if (platform !== 'linux') return;

  const binary = {
    x64: 'yt-dlp_linux',
    arm64: 'yt-dlp_linux_aarch64',
  }[arch];
  if (!binary) return;

  env.YOUTUBE_DL_FILENAME ||= binary;
  env.YOUTUBE_DL_DIR ||= runtimeDir;
}

module.exports = { configureYoutubeDlRuntime };
