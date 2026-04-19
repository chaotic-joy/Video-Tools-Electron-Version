const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, 'ffmpeg')
  : require('ffmpeg-static');

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 700,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile('renderer/index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── Helpers ──────────────────────────────────────────────────────

function parseSecs(h, m, s) {
  return +h * 3600 + +m * 60 + parseFloat(s);
}

function escapeConcatPath(p) {
  return p.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function runFFmpeg(args, { onProgress, totalDuration }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', ...args]);
    proc.stderr.on('data', chunk => {
      const msg = chunk.toString();
      const m = msg.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && totalDuration > 0) {
        const elapsed = parseSecs(m[1], m[2], m[3]);
        onProgress?.(Math.min(elapsed / totalDuration, 1));
      }
    });
    proc.on('close', code => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

// Probe a file for duration and audio presence
function probeFile(filePath) {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', filePath]);
    let output = '';
    proc.stderr.on('data', d => { output += d.toString(); });
    proc.on('close', () => {
      const dm = output.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      const duration = dm ? parseSecs(dm[1], dm[2], dm[3]) : 0;
      const hasAudio = output.includes('Audio:');
      resolve({ duration, hasAudio });
    });
  });
}

const ENCODE_ARGS = (hasAudio, inputArgs, mapArgs) => [
  ...inputArgs,
  ...mapArgs,
  '-c:v', 'libx264', '-preset', 'fast',
  '-profile:v', 'main', '-level:v', '4.0',
  '-pix_fmt', 'yuv420p',
  '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
  '-r', '30',
  '-maxrate', '2000k', '-bufsize', '4000k',
  '-flags', '+cgop',
  '-c:a', 'aac', '-ar', '48000', '-ac', '2',
  '-shortest',
];

// ── IPC: file dialogs ─────────────────────────────────────────────

ipcMain.handle('dialog:open-files', async (_, { multiple }) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv'] }],
  });
  return canceled ? [] : filePaths;
});

ipcMain.handle('dialog:save-file', async (_, { defaultName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  return canceled ? null : filePath;
});

// ── IPC: merge ────────────────────────────────────────────────────

ipcMain.handle('ffmpeg:merge', async (event, { paths, outputPath }) => {
  const send = data => event.sender.send('ffmpeg:progress', data);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmerge-'));

  try {
    // Probe all files, normalize any without audio
    let totalDuration = 0;
    const normalized = [];

    for (let i = 0; i < paths.length; i++) {
      send({ status: `Analyzing file ${i + 1}/${paths.length}…` });
      const { duration, hasAudio } = await probeFile(paths[i]);
      totalDuration += duration;

      if (hasAudio) {
        normalized.push(paths[i]);
      } else {
        const normPath = path.join(tmpDir, `norm_${i}.mp4`);
        send({ status: `Adding silent audio to file ${i + 1}…` });
        await runFFmpeg([
          '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
          '-i', paths[i],
          '-map', '1:v', '-map', '0:a',
          '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
          '-shortest', normPath,
        ], {});
        normalized.push(normPath);
      }
    }

    send({ status: 'Encoding…' });
    const filelistPath = path.join(tmpDir, 'filelist.txt');
    fs.writeFileSync(filelistPath, normalized.map(p => `file '${escapeConcatPath(p)}'`).join('\n'));

    const startMs = Date.now();
    await runFFmpeg([
      '-f', 'concat', '-safe', '0', '-i', filelistPath,
      '-c:v', 'libx264', '-preset', 'fast',
      '-profile:v', 'main', '-level:v', '4.0',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
      '-r', '30',
      '-maxrate', '2000k', '-bufsize', '4000k',
      '-c:a', 'aac', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ], {
      totalDuration,
      onProgress: ratio => {
        const elapsedSec = (Date.now() - startMs) / 1000;
        const eta = ratio > 0.01 ? elapsedSec / ratio - elapsedSec : Infinity;
        send({ ratio, eta });
      },
    });

    send({ status: 'Done!', ratio: 1, eta: 0 });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── IPC: loop ─────────────────────────────────────────────────────

ipcMain.handle('ffmpeg:probe-loop', async (_, { filePath }) => {
  const { duration, hasAudio } = await probeFile(filePath);
  const loopCount = duration > 0 ? Math.ceil(3600 / duration) : 0;
  return { duration, hasAudio, loopCount, totalDuration: loopCount * duration };
});

ipcMain.handle('ffmpeg:loop', async (event, { filePath, outputPath }) => {
  const send = data => event.sender.send('ffmpeg:progress', data);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vloop-'));

  try {
    const { duration, hasAudio } = await probeFile(filePath);
    const normPath = path.join(tmpDir, 'norm.mp4');

    // Pass 1: normalize source clip
    send({ status: 'Normalizing clip (pass 1/2)…' });
    const startMs = Date.now();
    const inputArgs = hasAudio
      ? ['-i', filePath]
      : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-i', filePath];
    const mapArgs = hasAudio
      ? ['-map', '0:v', '-map', '0:a']
      : ['-map', '1:v', '-map', '0:a'];

    await runFFmpeg([
      ...inputArgs, ...mapArgs,
      '-c:v', 'libx264', '-preset', 'fast',
      '-profile:v', 'main', '-level:v', '4.0',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
      '-r', '30',
      '-maxrate', '2000k', '-bufsize', '4000k',
      '-flags', '+cgop',
      '-c:a', 'aac', '-ar', '48000', '-ac', '2',
      '-shortest', normPath,
    ], {
      totalDuration: duration,
      onProgress: ratio => {
        const elapsedSec = (Date.now() - startMs) / 1000;
        const eta = ratio > 0.01 ? elapsedSec / ratio - elapsedSec : Infinity;
        send({ ratio: ratio * 0.8, eta, status: 'Normalizing clip (pass 1/2)…' });
      },
    });

    // Pass 2: stitch with stream copy
    const loopCount = Math.ceil(3600 / duration);
    send({ status: `Stitching ${loopCount} copies (pass 2/2)…`, ratio: 0.8 });
    const filelistPath = path.join(tmpDir, 'filelist.txt');
    fs.writeFileSync(filelistPath,
      Array.from({ length: loopCount }, () => `file '${escapeConcatPath(normPath)}'`).join('\n')
    );

    await runFFmpeg([
      '-f', 'concat', '-safe', '0', '-i', filelistPath,
      '-c:v', 'copy', '-c:a', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ], {});

    send({ status: 'Done!', ratio: 1, eta: 0 });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
