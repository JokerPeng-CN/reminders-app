const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, screen, powerMonitor, nativeTheme, globalShortcut } = require('electron');
const path = require('path');
const store = require('./store');
const notify = require('./notify');
const { makeTrayPNG } = require('./tray-icon');

const isDev = process.argv.includes('--dev');

let mainWindow = null;
let floatWindow = null;
let tray = null;
let quitting = false;
let pendingMainMsgs = []; // #7 + H3: 排队等待主窗口加载的 IPC 消息(数组防丢失)

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
      msgs.forEach(msg => mainWindow.webContents.send(msg));
    }
  });

  // H4: 重新注册通知引用
  notify.setMainWindow(mainWindow);
}

function createFloatWindow() {
  const display = screen.getPrimaryDisplay();
  const fw = 320;
  const fh = 0; // auto height handled in renderer
  floatWindow = new BrowserWindow({
    width: fw,
    height: 420,
    maxWidth: 360,
    minWidth: 280,
    x: display.workArea.width + display.workArea.x - fw - 20,
    y: display.workArea.y + 20,
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

  floatWindow.on('blur', () => {
    // 失焦不自动隐藏，保持悬浮
  });

  return floatWindow;
}

// #6 + H1 + H2: 悬浮窗首次显示时等 did-finish-load，检查窗口销毁和主窗可见性
function showFloat() {
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
}

function toggleFloat() {
  if (!floatWindow || floatWindow.isDestroyed()) floatWindow = null;
  if (!floatWindow) {
    createFloatWindow();
    floatWindow.webContents.once('did-finish-load', () => {
      floatWindow.webContents.send('float-refresh');
      floatWindow.showInactive();
    });
    return;
  }
  if (floatWindow.isVisible()) floatWindow.hide();
  else {
    if (!floatWindow.webContents.isLoading()) floatWindow.webContents.send('float-refresh');
    floatWindow.showInactive();
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
        { label: '退出', accelerator: isMac ? 'CmdOrCtrl+Q' : 'Alt+F4', click: () => { quitting = true; app.quit(); } }
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
        { label: '切换主题', accelerator: 'CmdOrCtrl+Shift+T', click: () => mainWindow && mainWindow.webContents.send('toggle-theme') },
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
        { label: '关于提醒事项', click: () => { require('electron').dialog.showMessageBox(mainWindow, { type: 'info', title: '关于', message: '提醒事项 1.0', detail: '一款轻量级桌面待办提醒应用。\n\n功能特点：\n· 分类管理与自定义清单\n· 悬浮小窗快速查看\n· 系统通知与重复提醒\n· 深色 / 浅色主题\n· 全局快捷键支持\n\n数据存储在本地，安全可靠。' }); } }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 全局快捷键 ----------
function registerShortcuts(settings) {
  globalShortcut.unregisterAll();
  try {
    if (settings.hotkeyMain) {
      const ok = globalShortcut.register(settings.hotkeyMain, () => toggleMainWindow());
      if (!ok) console.warn('快捷键注册失败:', settings.hotkeyMain);
    }
    if (settings.hotkeyFloat) {
      const ok = globalShortcut.register(settings.hotkeyFloat, () => toggleFloat());
      if (!ok) console.warn('快捷键注册失败:', settings.hotkeyFloat);
    }
  } catch (e) {
    console.error('register shortcut error', e.message);
  }
}

// ---------- IPC ----------
ipcMain.handle('store:getAll', () => store.getAll());
ipcMain.handle('store:getActive', () => store.getActive());
ipcMain.handle('store:getRecent', (e, limit) => store.getRecentActive(limit));
ipcMain.handle('store:getLists', () => store.getLists());
ipcMain.handle('store:create', (e, data) => { const r = store.create(data); updateTray(); refreshFloat(); return r; });
ipcMain.handle('store:update', (e, id, patch) => { const r = store.update(id, patch); updateTray(); refreshFloat(); return r; });
ipcMain.handle('store:toggle', (e, id) => { const r = store.toggle(id); updateTray(); refreshFloat(); return r; });
ipcMain.handle('store:remove', (e, id) => { const r = store.remove(id); updateTray(); refreshFloat(); return r; });
ipcMain.handle('store:toggleSubtask', (e, id, subId) => { const r = store.toggleSubtask(id, subId); return r; });
ipcMain.handle('store:createList', (e, name, color) => { return store.createList(name, color); });
ipcMain.handle('store:updateList', (e, id, patch) => { return store.updateList(id, patch); });
ipcMain.handle('store:deleteList', (e, id) => { return store.deleteList(id); });
ipcMain.handle('store:getSettings', () => store.getSettings());
ipcMain.handle('store:updateSettings', (e, patch) => {
  const s = store.updateSettings(patch);
  applyAutoStart(s);
  applyNativeTheme(s.theme);
  registerShortcuts(s);
  return s;
});
ipcMain.handle('store:export', () => store.exportData());
ipcMain.handle('store:import', (e, str) => { const r = store.importData(str); updateTray(); return r; });

ipcMain.on('float:hide', () => hideFloat());
ipcMain.on('float:showMain', () => showMain());

ipcMain.on('main:toggleFloat', () => toggleFloat());

// #7 + H3: 安全发送主窗口 IPC 消息 (处理窗口未加载完成的情况)
function sendToMain(channel) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(channel);
  } else {
    pendingMainMsgs.push(channel);
  }
}

function refreshFloat() {
  if (floatWindow && !floatWindow.isDestroyed() && floatWindow.isVisible()) {
    floatWindow.webContents.send('float-refresh');
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
    if (process.platform === 'win32') app.setAppUserModelId('com.local.reminders');
    const s = store.getSettings();
    applyNativeTheme(s.theme);
    setupMenu();
    createMainWindow();
    createTray();
    notify.setMainWindow(mainWindow);
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
