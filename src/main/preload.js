const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAll: () => ipcRenderer.invoke('store:getAll'),
  getActive: () => ipcRenderer.invoke('store:getActive'),
  getRecent: (limit) => ipcRenderer.invoke('store:getRecent', limit),
  getLists: () => ipcRenderer.invoke('store:getLists'),
  create: (data) => ipcRenderer.invoke('store:create', data),
  update: (id, patch) => ipcRenderer.invoke('store:update', id, patch),
  toggle: (id) => ipcRenderer.invoke('store:toggle', id),
  remove: (id) => ipcRenderer.invoke('store:remove', id),
  toggleSubtask: (id, subId) => ipcRenderer.invoke('store:toggleSubtask', id, subId),
  createList: (name, color) => ipcRenderer.invoke('store:createList', name, color),
  updateList: (id, patch) => ipcRenderer.invoke('store:updateList', id, patch),
  deleteList: (id) => ipcRenderer.invoke('store:deleteList', id),
  getSettings: () => ipcRenderer.invoke('store:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('store:updateSettings', patch),
  exportData: () => ipcRenderer.invoke('store:export'),
  importData: (str) => ipcRenderer.invoke('store:import', str),
  toggleFloat: () => ipcRenderer.send('main:toggleFloat'),
  onFocusReminder: (cb) => ipcRenderer.on('focus-reminder', (e, id) => cb(id)),
  onNewReminder: (cb) => ipcRenderer.on('new-reminder', (e) => cb()),
  onToggleTheme: (cb) => ipcRenderer.on('toggle-theme', () => cb()),
  onOpenHelp: (cb) => ipcRenderer.on('open-help', () => cb())
});
