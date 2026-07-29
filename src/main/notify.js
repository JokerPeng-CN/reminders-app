const { Notification } = require('electron');
const store = require('./store');

let timer = null;
let notifiedIds = new Set();
let mainWindowRef = null;

function setMainWindow(w) { mainWindowRef = w; }

// M4: 导入数据后清理已通知记录，避免抑制新数据的通知
function reset() {
  notifiedIds.clear();
}

function check() {
  const now = Date.now();
  const aheadMs = (store.getSettings().remindAhead || 0) * 60 * 1000;
  // M5: 只通知最近15分钟内到期(含提前量)的项，避免重启时通知风暴
  const windowMs = 15 * 60 * 1000;
  const due = store.getDueSoon();
  due.forEach(r => {
    const dueTime = new Date(r.due).getTime();
    if (isNaN(dueTime)) return;
    if (dueTime - now <= aheadMs && !notifiedIds.has(r.id)) {
      // 到期时间在现在或过去，但不超过 windowMs+aheadMs 前(避免老逾期项全部弹出)
      const overdueBy = now - dueTime;
      if (overdueBy > windowMs + aheadMs) return; // H1: 移除 && aheadMs===0，所有情况都防风暴
      notifiedIds.add(r.id);
      showNotify(r);
    }
  });
  const active = new Set(store.getActive().map(r => r.id));
  notifiedIds.forEach(id => { if (!active.has(id)) notifiedIds.delete(id); });
}

function showNotify(r) {
  const settings = store.getSettings();
  const when = new Date(r.due);
  let body = r.notes;
  if (!body && !isNaN(when.getTime())) body = when.toLocaleString('zh-CN');
  if (!body) body = '';
  const n = new Notification({
    title: '提醒：' + r.title,
    body,
    silent: !settings.notifySound
  });
  n.on('click', () => {
    // #11 + M3: 检查窗口和 webContents 是否已销毁
    if (mainWindowRef && !mainWindowRef.isDestroyed() && !mainWindowRef.webContents.isDestroyed()) {
      if (mainWindowRef.isMinimized()) mainWindowRef.restore();
      if (!mainWindowRef.isVisible()) mainWindowRef.show();
      mainWindowRef.focus();
      mainWindowRef.webContents.send('focus-reminder', r.id);
    }
  });
  n.show();
}

function start() {
  stop();
  timer = setInterval(check, 15000);
  check();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, setMainWindow, check, reset };
