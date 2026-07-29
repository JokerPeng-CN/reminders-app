const { contextBridge, ipcRenderer } = require('electron');

// 在 preload 中处理拖拽+点击，避免 drag region 吞掉鼠标事件
window.addEventListener('DOMContentLoaded', () => {
  let dragStart = null;

  document.addEventListener('mousedown', (e) => {
    dragStart = { x: e.screenX, y: e.screenY };
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const dx = e.screenX - dragStart.x;
    const dy = e.screenY - dragStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      ipcRenderer.send('logo:drag', dx, dy);
      dragStart = { x: e.screenX, y: e.screenY };
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (dragStart) {
      const dx = Math.abs(e.screenX - dragStart.x);
      const dy = Math.abs(e.screenY - dragStart.y);
      if (dx < 5 && dy < 5) {
        ipcRenderer.send('logo:click');
      }
      dragStart = null;
    }
  });
});

contextBridge.exposeInMainWorld('logoApi', {
  // 保留兼容，但实际点击和拖拽已由 preload 直接处理
});