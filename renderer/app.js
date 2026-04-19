// ── Helpers ──────────────────────────────────────────────────────

function fmtDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtEta(secs) {
  if (!isFinite(secs) || secs <= 0) return '';
  return `~${fmtDuration(Math.ceil(secs))} remaining`;
}

function getDateSuffix() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setProgress(prefix, ratio, eta) {
  const pct = Math.round(ratio * 100);
  document.getElementById(`${prefix}-progress-pct`).textContent = `${pct}%`;
  document.getElementById(`${prefix}-progress-bar`).style.width = `${pct}%`;
  document.getElementById(`${prefix}-eta`).textContent = ratio < 1 ? fmtEta(eta) : '';
}

function setStatus(prefix, msg, type = '') {
  const el = document.getElementById(`${prefix}-status`);
  el.textContent = msg;
  el.className = `status-msg${type ? ' ' + type : ''}`;
}

function setFfmpegStatus(prefix, msg) {
  if (msg) document.getElementById(`${prefix}-ffmpeg-status`).textContent = msg;
}

function showProgress(prefix, visible) {
  document.getElementById(`${prefix}-progress`).classList.toggle('visible', visible);
}

// ── Tabs ──────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Drag-and-drop helper ──────────────────────────────────────────

function setupDropZone(zone, onDrop) {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const paths = Array.from(e.dataTransfer.files).map(f => f.path);
    if (paths.length) onDrop(paths);
  });
}

// ── MERGE ─────────────────────────────────────────────────────────

const mergeFiles = []; // { name, path, size }
const mergePickBtn = document.getElementById('merge-pick-btn');
const mergeStartBtn = document.getElementById('merge-start-btn');
const mergeFileList = document.getElementById('merge-file-list');

function renderMergeList() {
  mergeFileList.innerHTML = '';
  mergeFiles.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <svg class="file-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
      </svg>
      <span class="file-name">${file.name}</span>
      <span class="file-meta">${(file.size / 1e6).toFixed(1)} MB</span>
      <button class="btn-remove" data-i="${i}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;
    mergeFileList.appendChild(item);
  });
  mergeStartBtn.disabled = mergeFiles.length < 2;

  mergeFileList.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      mergeFiles.splice(+btn.dataset.i, 1);
      renderMergeList();
    });
  });
}

function addMergePaths(paths) {
  for (const p of paths) {
    const name = p.split('/').pop();
    mergeFiles.push({ name, path: p, size: 0 });
  }
  renderMergeList();
}

mergePickBtn.addEventListener('click', async () => {
  const paths = await window.electronAPI.openFiles(true);
  if (paths.length) addMergePaths(paths);
});

setupDropZone(document.getElementById('merge-drop-zone'), addMergePaths);

mergeStartBtn.addEventListener('click', async () => {
  if (mergeFiles.length < 2) return;

  const outputPath = await window.electronAPI.saveFile(`Merged Video ${getDateSuffix()}.mp4`);
  if (!outputPath) return;

  mergeStartBtn.disabled = true;
  showProgress('merge', true);
  setProgress('merge', 0, Infinity);
  setStatus('merge', '');

  const unsub = window.electronAPI.onProgress(({ ratio, eta, status }) => {
    if (ratio !== undefined) setProgress('merge', ratio, eta);
    if (status) setFfmpegStatus('merge', status);
  });

  try {
    await window.electronAPI.merge(mergeFiles.map(f => f.path), outputPath);
    setProgress('merge', 1, 0);
    setStatus('merge', 'Saved to ' + outputPath.split('/').pop(), 'success');
  } catch (err) {
    console.error(err);
    setStatus('merge', `Error: ${err?.message || String(err)}`, 'error');
  } finally {
    unsub();
    mergeStartBtn.disabled = mergeFiles.length < 2;
  }
});

// ── LOOP ──────────────────────────────────────────────────────────

let loopFilePath = null;
const loopPickBtn = document.getElementById('loop-pick-btn');
const loopStartBtn = document.getElementById('loop-start-btn');
const loopInfo = document.getElementById('loop-info');

async function setLoopFile(filePath) {
  loopFilePath = filePath;
  loopStartBtn.disabled = true;
  loopInfo.style.display = 'none';
  setStatus('loop', '');

  try {
    setFfmpegStatus('loop', 'Probing…');
    const { duration, loopCount, totalDuration } = await window.electronAPI.probeLoop(filePath);
    const name = filePath.split('/').pop();

    document.getElementById('loop-file-name').textContent = name.length > 30 ? name.slice(0, 27) + '…' : name;
    document.getElementById('loop-src-duration').textContent = fmtDuration(duration);
    document.getElementById('loop-count').textContent = `${loopCount}×`;
    document.getElementById('loop-out-duration').textContent = fmtDuration(totalDuration);

    loopInfo.style.display = 'flex';
    loopStartBtn.disabled = false;
    setFfmpegStatus('loop', '');
  } catch (err) {
    setStatus('loop', `Failed to probe: ${err?.message || String(err)}`, 'error');
  }
}

loopPickBtn.addEventListener('click', async () => {
  const paths = await window.electronAPI.openFiles(false);
  if (paths[0]) setLoopFile(paths[0]);
});

setupDropZone(document.getElementById('loop-drop-zone'), paths => setLoopFile(paths[0]));

loopStartBtn.addEventListener('click', async () => {
  if (!loopFilePath) return;

  const outputPath = await window.electronAPI.saveFile(`video_loop_${getDateSuffix()}.mp4`);
  if (!outputPath) return;

  loopStartBtn.disabled = true;
  showProgress('loop', true);
  setProgress('loop', 0, Infinity);
  setStatus('loop', '');

  const unsub = window.electronAPI.onProgress(({ ratio, eta, status }) => {
    if (ratio !== undefined) setProgress('loop', ratio, eta);
    if (status) setFfmpegStatus('loop', status);
  });

  try {
    await window.electronAPI.loop(loopFilePath, outputPath);
    setProgress('loop', 1, 0);
    setStatus('loop', 'Saved to ' + outputPath.split('/').pop(), 'success');
  } catch (err) {
    console.error(err);
    setStatus('loop', `Error: ${err?.message || String(err)}`, 'error');
  } finally {
    unsub();
    loopStartBtn.disabled = false;
  }
});
