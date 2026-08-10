const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = Object.freeze({
  version: 1,
  selectAudioFiles: () => ipcRenderer.invoke('dialog:open-audio'),
  listAudioFiles: () => ipcRenderer.invoke('library:list-audio'),
  readAudioHeader: (id) => ipcRenderer.invoke('library:read-audio-header', id),
  removeAudioFile: (id) => ipcRenderer.invoke('library:remove-audio', id),
  clearAudioFiles: () => ipcRenderer.invoke('library:clear-audio'),
  loadSettings: () => ipcRenderer.invoke('settings:read'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:write', settings),
  importBackgroundImage: () => ipcRenderer.invoke('background:import'),
  removeBackgroundImage: (url) => ipcRenderer.invoke('background:remove', url),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
});

contextBridge.exposeInMainWorld('mareaDesktop', desktopApi);
