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
  onFocusReminder: (cb) => { const h = (e, id) => cb(id); ipcRenderer.on('focus-reminder', h); return () => ipcRenderer.removeListener('focus-reminder', h); }, // G5: 返回清理函数
  onNewReminder: (cb) => { const h = (e) => cb(); ipcRenderer.on('new-reminder', h); return () => ipcRenderer.removeListener('new-reminder', h); },
  onToggleTheme: (cb) => { const h = () => cb(); ipcRenderer.on('toggle-theme', h); return () => ipcRenderer.removeListener('toggle-theme', h); },
  onOpenHelp: (cb) => { const h = () => cb(); ipcRenderer.on('open-help', h); return () => ipcRenderer.removeListener('open-help', h); },
  onThemeChanged: (cb) => { const h = (e, theme) => cb(theme); ipcRenderer.on('theme-changed', h); return () => ipcRenderer.removeListener('theme-changed', h); }, // 问题1: 接收主题变更
  onRefresh: (cb) => { const h = () => cb(); ipcRenderer.on('main:refresh', h); return () => ipcRenderer.removeListener('main:refresh', h); } // 问题2: 接收刷新信号
});
