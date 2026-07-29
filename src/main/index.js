const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, powerMonitor, nativeTheme, globalShortcut } = require('electron');
const path = require('path');
const store = require('./store');
const notify = require('./notify');
const { makeTrayPNG } = require('./tray-icon');

const isDev = process.argv.includes('--dev');

let mainWindow = null;
let floatWindow = null;
let logoWindow = null;
let tray = null;
let quitting = false;
let pendingMainMsgs = []; // #7 + H3: 排队等待主窗口加载的 IPC 消息(数组防丢失)
const FLOAT = 'float', LOGO = 'logo';
let floatMode = FLOAT;
let savedPos = null;

function makeTrayIcon(count) {
  // 用 PNG 位图字体生成托盘图标 (Windows 不支持 SVG data URL)
  const png = makeTrayPNG(32, count);
  const img = nativeImage.createFromBuffer(png, { scaleFactor: 1.0 });
  return img;
}

function applyNativeTheme(theme) {
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light';
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 720,
    minHeight: 500,
    show: false,
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#f5f5f7',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    console.log('[renderer]', message);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev && process.argv.includes('--shot')) {
      setTimeout(async () => {
        const img = await mainWindow.webContents.capturePage();
        require('fs').writeFileSync(path.join(__dirname, '..', '..', 'main-shot.png'), img.toPNG());
        createFloatWindow();
        floatWindow.webContents.once('did-finish-load', () => {
          setTimeout(async () => {
            floatWindow.webContents.send('float-refresh');
            setTimeout(async () => {
              try {
                const f = await floatWindow.webContents.capturePage();
                require('fs').writeFileSync(path.join(__dirname, '..', '..', 'float-shot.png'), f.toPNG());
              } catch (e) {}
              quitting = true; app.quit();
            }, 1500);
          }, 500);
        });
      }, 2500);
    }
  });

  // 关闭时最小化到托盘 (#8: 只在 hide 事件里处理 showFloat，避免双重调用)
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('hide', () => {
    const s = store.getSettings();
    if (s.showFloatOnClose) showFloat();
  });

  mainWindow.on('restore', () => { hideFloat(); });
  mainWindow.on('show', () => { hideFloat(); });

  // #7: 主窗口加载完成后刷新待处理消息
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingMainMsgs.length) {
      const msgs = pendingMainMsgs; pendingMainMsgs = [];
      msgs.forEach(msg => mainWindow.webContents.send(msg.channel, ...msg.args)); // G9: 支持参数
    }
  });

  // H4: 重新注册通知引用
  notify.setMainWindow(mainWindow);
}

function createFloatWindow() {
  const display = screen.getPrimaryDisplay();
  const fw = 320;
  const fx = savedPos ? savedPos.x : display.workArea.width + display.workArea.x - fw - 20;
  const fy = savedPos ? savedPos.y : display.workArea.y + 20;
  floatWindow = new BrowserWindow({
    width: fw,
    height: 420,
    maxWidth: 360,
    minWidth: 280,
    x: fx,
    y: fy,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-float.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  floatWindow.loadFile(path.join(__dirname, '..', 'renderer', 'float.html'));
  floatWindow.setAlwaysOnTop(true, 'screen-saver');

  // 问题1: 拖动时记忆位置
  floatWindow.on('move', () => {
    if (floatWindow && !floatWindow.isDestroyed()) {
      const [x, y] = floatWindow.getPosition();
      savedPos = { x, y };
    }
  });

  return floatWindow;
}

// 问题1: logo窗口 — 与悬浮窗共享位置
function createLogoWindow() {
  const display = screen.getPrimaryDisplay();
  const lw = 48;
  const lx = savedPos ? savedPos.x : display.workArea.width + display.workArea.x - lw - 20;
  const ly = savedPos ? savedPos.y : display.workArea.y + 20;
  logoWindow = new BrowserWindow({
    width: lw, height: lw,
    x: lx, y: ly,
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    hasShadow: false, focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-logo.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  logoWindow.loadFile(path.join(__dirname, '..', 'renderer', 'logo.html'));
  logoWindow.setAlwaysOnTop(true, 'screen-saver');

  // 问题1: 拖动时记忆位置
  logoWindow.on('move', () => {
    if (logoWindow && !logoWindow.isDestroyed()) {
      const [x, y] = logoWindow.getPosition();
      savedPos = { x, y };
    }
  });

  return logoWindow;
}

function showLogo() {
  if (!logoWindow || logoWindow.isDestroyed()) {
    logoWindow = null;
    createLogoWindow();
    logoWindow.webContents.once('did-finish-load', () => logoWindow.showInactive());
    return;
  }
  logoWindow.showInactive();
}

function hideLogo() {
  if (logoWindow && !logoWindow.isDestroyed()) logoWindow.hide();
}

// 问题1: 悬浮窗→logo (保存位置，互斥显示)
function minimizeToLogo() {
  if (floatWindow && !floatWindow.isDestroyed()) {
    const [x, y] = floatWindow.getPosition();
    savedPos = { x, y };
    floatWindow.hide();
  }
  floatMode = LOGO;
  showLogo();
}

// #6 + H1 + H2: 悬浮窗首次显示时等 did-finish-load，检查窗口销毁和主窗可见性
function showFloat() {
  // 问题1: 如果当前是logo模式，先切换回float
  if (floatMode === LOGO && logoWindow && !logoWindow.isDestroyed() && logoWindow.isVisible()) {
    const [x, y] = logoWindow.getPosition();
    savedPos = { x, y };
    logoWindow.hide();
  }
  floatMode = FLOAT;
  if (!floatWindow || floatWindow.isDestroyed()) {
    floatWindow = null;
    createFloatWindow();
    floatWindow.webContents.once('did-finish-load', () => {
      // H2: 主窗可见时不弹悬浮窗
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) return;
      floatWindow.webContents.send('float-refresh');
      floatWindow.showInactive();
    });
    return;
  }
  if (!floatWindow.webContents.isLoading()) floatWindow.webContents.send('float-refresh');
  floatWindow.showInactive();
}

function hideFloat() {
  if (floatWindow && !floatWindow.isDestroyed()) floatWindow.hide();
  // 问题1: 隐藏float同时也隐藏logo
  if (logoWindow && !logoWindow.isDestroyed()) logoWindow.hide();
}

// 问题1: 切换悬浮窗显示/隐藏 (按当前模式)
function toggleFloat() {
  const win = floatMode === LOGO ? logoWindow : floatWindow;
  if (!win || win.isDestroyed()) {
    // 窗口不存在，创建并显示float模式
    floatMode = FLOAT;
    if (!floatWindow || floatWindow.isDestroyed()) {
      createFloatWindow();
      floatWindow.webContents.once('did-finish-load', () => {
        floatWindow.webContents.send('float-refresh');
        floatWindow.showInactive();
      });
      return;
    }
    floatWindow.showInactive();
    return;
  }
  if (win.isVisible()) {
    win.hide();
    if (floatMode === LOGO) floatMode = FLOAT;
  }
  else {
    if (floatMode === FLOAT && !floatWindow.webContents.isLoading()) floatWindow.webContents.send('float-refresh');
    win.showInactive();
  }
}

function updateTray() {
  if (!tray) return;
  const count = store.getActive().length;
  tray.setImage(makeTrayIcon(count));
  tray.setToolTip('提醒事项 - ' + count + ' 项未完成');
}

function createTray() {
  const count = store.getActive().length;
  tray = new Tray(makeTrayIcon(count));
  tray.setToolTip('提醒事项 - ' + count + ' 项未完成'); // #35: 初始 tooltip 带计数
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { showMain(); } },
    { label: '显示/隐藏悬浮窗', click: () => toggleFloat() },
    { type: 'separator' },
    { label: '新建提醒', click: () => { showMain(); sendToMain('new-reminder'); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { showMain(); });
  tray.on('double-click', () => { showMain(); });
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) { createMainWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  hideFloat();
}

// 切换主窗口显示/隐藏
function toggleMainWindow() {
  if (!mainWindow) { createMainWindow(); return; }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
  else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
}

// 中文应用菜单
function setupMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建提醒', accelerator: 'CmdOrCtrl+N', click: () => { showMain(); sendToMain('new-reminder'); } },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { label: '关闭窗口', accelerator: 'CmdOrCtrl+W', click: () => { if (mainWindow) mainWindow.close(); } },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '切换主题', accelerator: 'CmdOrCtrl+Shift+T', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toggle-theme'); } },
        { type: 'separator' },
        { label: '显示/隐藏悬浮窗', click: () => toggleFloat() },
        isDev ? { role: 'toggleDevTools', label: '开发者工具' } : { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '缩放', role: 'zoom' },
        ...(isMac ? [{ role: 'front', label: '前置全部窗口' }] : [])
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用说明', accelerator: 'F1', click: () => { showMain(); sendToMain('open-help'); } },
        { label: '关于提醒事项', click: () => { require('electron').dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : null, { type: 'info', title: '关于', message: '提醒事项 ' + require('../package.json').version, detail: '一款轻量级桌面待办提醒应用。\n\n功能特点：\n· 分类管理与自定义清单\n· 悬浮小窗快速查看\n· 系统通知与重复提醒\n· 深色 / 浅色主题\n· 全局快捷键支持\n\n数据存储在本地，安全可靠。' }); } }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 全局快捷键 ----------
let lastShortcuts = null; // M3: 记录上一组成功的快捷键，用于回滚

function registerShortcuts(settings) {
  globalShortcut.unregisterAll();
  let allOk = true;
  try {
    if (settings.hotkeyMain) {
      const ok = globalShortcut.register(settings.hotkeyMain, () => toggleMainWindow());
      if (!ok) { console.warn('快捷键注册失败:', settings.hotkeyMain); allOk = false; }
    }
    if (settings.hotkeyFloat) {
      const ok = globalShortcut.register(settings.hotkeyFloat, () => toggleFloat());
      if (!ok) { console.warn('快捷键注册失败:', settings.hotkeyFloat); allOk = false; }
    }
  } catch (e) {
    console.error('register shortcut error', e.message);
    allOk = false;
  }
  if (!allOk && lastShortcuts) {
    // M3: 回滚到上一组成功的快捷键
    globalShortcut.unregisterAll();
    try {
      if (lastShortcuts.hotkeyMain) globalShortcut.register(lastShortcuts.hotkeyMain, () => toggleMainWindow());
      if (lastShortcuts.hotkeyFloat) globalShortcut.register(lastShortcuts.hotkeyFloat, () => toggleFloat());
    } catch (e) { console.error('rollback shortcut error', e.message); }
  } else if (allOk) {
    lastShortcuts = { hotkeyMain: settings.hotkeyMain, hotkeyFloat: settings.hotkeyFloat };
  }
}

// ---------- IPC ----------
// M6: 统一 try/catch 包装，记录异常日志
function wrapHandler(fn) {
  return async (e, ...args) => {
    try { return await fn(e, ...args); }
    catch (err) { console.error(`IPC error:`, err.message); throw err; }
  };
}

ipcMain.handle('store:getAll', wrapHandler(() => store.getAll()));
ipcMain.handle('store:getActive', wrapHandler(() => store.getActive()));
ipcMain.handle('store:getRecent', wrapHandler((e, limit) => store.getRecentActive(limit)));
ipcMain.handle('store:getLists', wrapHandler(() => store.getLists()));
ipcMain.handle('store:create', wrapHandler((e, data) => { const r = store.create(data); updateTray(); refreshFloat(); refreshMain(); return r; }));
ipcMain.handle('store:update', wrapHandler((e, id, patch) => { const r = store.update(id, patch); updateTray(); refreshFloat(); refreshMain(); return r; }));
ipcMain.handle('store:toggle', wrapHandler((e, id) => { const r = store.toggle(id); updateTray(); refreshFloat(); refreshMain(); return r; }));
ipcMain.handle('store:remove', wrapHandler((e, id) => { const r = store.remove(id); updateTray(); refreshFloat(); refreshMain(); return r; }));
ipcMain.handle('store:toggleSubtask', wrapHandler((e, id, subId) => { const r = store.toggleSubtask(id, subId); updateTray(); refreshFloat(); refreshMain(); return r; })); // L3+问题2: 刷新悬浮窗+主窗
ipcMain.handle('store:createList', wrapHandler((e, name, color) => { const r = store.createList(name, color); refreshFloat(); refreshMain(); return r; }));
ipcMain.handle('store:updateList', wrapHandler((e, id, patch) => { const r = store.updateList(id, patch); refreshFloat(); refreshMain(); return r; }));
ipcMain.handle('store:deleteList', wrapHandler((e, id) => { const r = store.deleteList(id); refreshFloat(); refreshMain(); return r; }));
ipcMain.handle('store:getSettings', wrapHandler(() => store.getSettings()));
ipcMain.handle('store:updateSettings', wrapHandler((e, patch) => {
  const s = store.updateSettings(patch);
  applyAutoStart(s);
  applyNativeTheme(s.theme);
  registerShortcuts(s);
  refreshFloat(); // G10: 主题切换后立即刷新悬浮窗
  if ('theme' in patch) sendToMain('theme-changed', s.theme); // 问题1: 悬浮窗主题切换同步到主程序
  refreshMain(); // 问题2: 设置变更刷新主窗
  return s;
}));
ipcMain.handle('store:export', wrapHandler(() => store.exportData()));
ipcMain.handle('store:import', wrapHandler((e, str) => { const r = store.importData(str); updateTray(); notify.reset(); refreshFloat(); refreshMain(); return r; })); // M4+L4+问题2: 清理notifiedIds+刷新悬浮窗+主窗

ipcMain.on('float:hide', () => hideFloat());
ipcMain.on('float:showMain', () => showMain());
ipcMain.on('float:minimize', () => minimizeToLogo()); // 问题1: 悬浮窗→logo
ipcMain.on('logo:click', () => showFloat()); // 问题1: logo→悬浮窗
ipcMain.on('logo:drag', (e, dx, dy) => { // 修复logo拖动
  if (logoWindow && !logoWindow.isDestroyed()) {
    const [x, y] = logoWindow.getPosition();
    logoWindow.setPosition(x + dx, y + dy);
    savedPos = { x: x + dx, y: y + dy };
  }
});

ipcMain.on('main:toggleFloat', () => toggleFloat());

// #7 + H3: 安全发送主窗口 IPC 消息 (处理窗口未加载完成的情况)
// G9: 支持携带参数
function sendToMain(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(channel, ...args);
  } else {
    pendingMainMsgs.push({ channel, args });
  }
}

function refreshFloat() {
  if (floatWindow && !floatWindow.isDestroyed() && floatWindow.isVisible()) {
    floatWindow.webContents.send('float-refresh');
  }
}

// 问题2: 刷新主窗口数据
function refreshMain() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendToMain('main:refresh');
  }
}

function applyAutoStart(settings) {
  app.setLoginItemSettings({ openAtLogin: !!settings.autoStart });
}

// 单例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showMain(); });

  app.whenReady().then(() => {
    store.load();
    if (process.platform === 'win32') app.setAppUserModelId('Reminders');
    const s = store.getSettings();
    applyNativeTheme(s.theme);
    setupMenu();
    createMainWindow();
    createTray();
    notify.start();
    applyAutoStart(s);
    registerShortcuts(s);

    // 默认隐藏悬浮窗直到主窗关闭
    app.on('activate', () => { showMain(); });
  });

  app.on('window-all-closed', (e) => {
    // 不退出，保持托盘运行
    e.preventDefault();
  });

  app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); });

  powerMonitor.on('resume', () => { notify.start(); }); // #33: 重启定时器而非仅检查一次
}
