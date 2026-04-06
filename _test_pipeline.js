// Test script: play-dl stream → ffmpeg → check audio output
const { spawn } = require('child_process');
const play = require('play-dl');
const ffmpegPath = require('ffmpeg-static');

(async () => {
  try {
    // Init SoundCloud
    const clientID = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientID } });
    console.log('[1] SoundCloud init OK');

    // Search
    const results = await play.search('Noi Nay Co Anh', { limit: 1, source: { soundcloud: 'tracks' } });
    if (!results.length) { console.log('No results'); return; }
    console.log('[2] Found:', results[0].name, results[0].url);

    // Stream
    const pdStream = await play.stream(results[0].url);
    console.log('[3] play-dl stream type:', pdStream.type);

    // Check if play-dl stream has data
    let pdBytes = 0;
    pdStream.stream.on('data', (chunk) => {
      pdBytes += chunk.length;
    });

    // Wait a bit then check
    setTimeout(() => {
      console.log('[4] play-dl stream bytes received:', pdBytes);
      if (pdBytes === 0) {
        console.log('❌ play-dl stream produced NO DATA!');
        process.exit(1);
      }
    }, 3000);

    // ffmpeg pipeline
    const ffmpeg = spawn(ffmpegPath, [
      '-i', 'pipe:0',
      '-analyzeduration', '0',
      '-loglevel', 'warning',
      '-ar', '48000',
      '-ac', '2',
      '-f', 's16le',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    pdStream.stream.pipe(ffmpeg.stdin);

    ffmpeg.stderr.on('data', d => console.log('[ffmpeg stderr]', d.toString().trim()));
    ffmpeg.stdin.on('error', e => console.log('[ffmpeg stdin error]', e.message));

    let ffmpegBytes = 0;
    ffmpeg.stdout.on('data', (chunk) => {
      ffmpegBytes += chunk.length;
    });

    ffmpeg.on('close', (code) => {
      console.log('[5] ffmpeg exit code:', code, 'output bytes:', ffmpegBytes);
    });

    setTimeout(() => {
      console.log('[5] ffmpeg output bytes after 5s:', ffmpegBytes);
      if (ffmpegBytes > 0) {
        console.log('✅ Pipeline works! Audio data flowing.');
      } else {
        console.log('❌ ffmpeg produced NO output');
      }
      process.exit(0);
    }, 6000);

  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();
