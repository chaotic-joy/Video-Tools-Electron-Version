const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: (multiple) => ipcRenderer.invoke('dialog:open-files', { multiple }),
  saveFile: (defaultName) => ipcRenderer.invoke('dialog:save-file', { defaultName }),
  merge: (paths, outputPath) => ipcRenderer.invoke('ffmpeg:merge', { paths, outputPath }),
  probeLoop: (filePath) => ipcRenderer.invoke('ffmpeg:probe-loop', { filePath }),
  loop: (filePath, outputPath) => ipcRenderer.invoke('ffmpeg:loop', { filePath, outputPath }),
  onProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('ffmpeg:progress', handler);
    return () => ipcRenderer.removeListener('ffmpeg:progress', handler);
  },
});
