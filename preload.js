const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateLyrics: (callback) => {
    ipcRenderer.on('update-lyrics', (event, data) => callback(data));
  },
  onAuthRequired: (callback) => {
    ipcRenderer.on('auth-required', (event, status) => callback(status));
  },
  onAuthStatus: (callback) => {
    ipcRenderer.on('auth-status', (event, status) => callback(status));
  },
  requestLogin: () => {
    ipcRenderer.send('request-login');
  }
});
