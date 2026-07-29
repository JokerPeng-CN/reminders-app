const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatApi', {
  getRecent: (limit) => ipcRenderer.invoke('store:getRecent', limit),
  getActive: () => ipcRenderer.invoke('store:getActive'),
  create: (data) => ipcRenderer.invoke('store:create', data),
  toggle: (id) => ipcRenderer.invoke('store:toggle', id),
  toggleSubtask: (id, subId) => ipcRenderer.invoke('store:toggleSubtask', id, subId),
  getSettings: () => ipcRenderer.invoke('store:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('store:updateSettings', patch),
  hide: () => ipcRenderer.send('float:hide'),
  showMain: () => ipcRenderer.send('float:showMain'),
  minimize: () => ipcRenderer.send('float:minimize'),
  onRefresh: (cb) => { const h = () => cb(); ipcRenderer.on('float-refresh', h); return () => ipcRenderer.removeListener('float-refresh', h); }
});
