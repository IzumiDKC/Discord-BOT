const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const UPDATE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

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

async function isBinaryHealthy(binaryPath, checkFn = execFileAsync) {
  try {
    await fsp.access(binaryPath, fs.constants.F_OK);
    const { stdout } = await checkFn(binaryPath, ['--version'], { timeout: 5_000 });
    return Boolean(String(stdout || '').trim());
  } catch {
    return false;
  }
}

// Download to a PID-scoped temp file and atomically rename so interrupted updates never leave a truncated binary.
async function downloadYoutubeDlAtomically({
  binaryPath,
  binaryDir,
  binaryFile,
  releaseHost,
  fetchFn = fetch,
}) {
  await fsp.mkdir(binaryDir, { recursive: true });
  let response = await fetchFn(releaseHost, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Failed to fetch yt-dlp release metadata (HTTP ${response.status}).`);

  if (response.headers.get('content-type') !== 'application/octet-stream') {
    const release = await response.json();
    const asset = release.assets?.find(item => item.name === binaryFile);
    if (!asset?.browser_download_url) {
      throw new Error(`Release asset "${binaryFile}" not found.`);
    }
    response = await fetchFn(asset.browser_download_url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Failed to download ${binaryFile} (HTTP ${response.status}).`);
  }

  if (!response.body) throw new Error('Empty yt-dlp download body.');

  const tempPath = `${binaryPath}.${process.pid}.tmp`;
  try {
    await pipeline(response.body, fs.createWriteStream(tempPath));
    await fsp.chmod(tempPath, 0o755);
    await fsp.rename(tempPath, binaryPath);
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function ensureYoutubeDlBinary(options = {}) {
  const constants = options.constants || require('youtube-dl-exec').constants;
  const binaryPath = constants.YOUTUBE_DL_PATH;
  const binaryDir = constants.YOUTUBE_DL_DIR;
  const binaryFile = constants.YOUTUBE_DL_FILE;
  const releaseHost = constants.YOUTUBE_DL_HOST;
  const checkFn = options.checkFn || execFileAsync;
  const fetchFn = options.fetchFn || fetch;
  const now = options.now ?? Date.now();

  const healthy = await isBinaryHealthy(binaryPath, checkFn);
  if (!healthy) {
    console.log(`[yt-dlp] Installing/repairing binary at ${binaryPath}...`);
    await downloadYoutubeDlAtomically({ binaryPath, binaryDir, binaryFile, releaseHost, fetchFn });
    return { status: 'installed', binaryPath };
  }

  try {
    const stat = await fsp.stat(binaryPath);
    if (now - stat.mtimeMs > UPDATE_MAX_AGE_MS) {
      void downloadYoutubeDlAtomically({ binaryPath, binaryDir, binaryFile, releaseHost, fetchFn })
        .catch(err => console.warn('[yt-dlp] Background update skipped:', err.message));
      return { status: 'updating_background', binaryPath };
    }
  } catch {}

  return { status: 'healthy', binaryPath };
}

module.exports = {
  configureYoutubeDlRuntime,
  downloadYoutubeDlAtomically,
  ensureYoutubeDlBinary,
  isBinaryHealthy,
};
