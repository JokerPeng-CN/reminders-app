const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  let dragStart = null;
  let lastMove = 0;

  document.addEventListener('mousedown', (e) => {
    dragStart = { x: e.screenX, y: e.screenY };
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const now = Date.now();
    if (now - lastMove < 32) return;
    lastMove = now;
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