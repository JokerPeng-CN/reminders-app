const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const DATA_FILE = path.join(DATA_DIR, 'reminders.json');
const TMP_FILE = DATA_FILE + '.tmp';
const BAK_FILE = DATA_FILE + '.bak';
const CORRUPT_FILE = DATA_FILE + '.corrupt';

const BAK_TMP_FILE = BAK_FILE + '.tmp';

let cache = null;

// #2 update() 允许修改的字段白名单
const ALLOWED_FIELDS = ['title', 'notes', 'listId', 'priority', 'due', 'repeat', 'tags', 'subtasks'];
// M5: settings 更新白名单
const ALLOWED_SETTINGS = ['theme', 'floatCount', 'showFloatOnClose', 'autoStart', 'notifySound', 'remindAhead', 'hotkeyMain', 'hotkeyFloat'];

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) save(defaultData());
}

function defaultData() {
  const now = new Date();
  return {
    reminders: [
      { id: 1, title: '欢迎使用提醒事项', notes: '双击事项可编辑，关闭主窗口会自动显示悬浮小窗。', listId: 'default', priority: 0, due: null, repeat: null, tags: [], subtasks: [], completed: false, completedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    ],
    lists: [
      { id: 'default', name: '提醒事项', color: '#007AFF' },
      { id: 'work', name: '工作', color: '#FF9500' },
      { id: 'personal', name: '个人', color: '#34C759' }
    ],
    settings: {
      theme: 'light',
      floatCount: 6,
      showFloatOnClose: true,
      autoStart: false,
      notifySound: true,
      remindAhead: 0,
      hotkeyMain: 'CommandOrControl+Shift+M',
      hotkeyFloat: 'CommandOrControl+Shift+F'
    },
    nextId: 2,
    version: 2
  };
}

// 损坏的 DATA_FILE 移走，防止 save() 将其复制到 .bak
function moveCorruptFile() {
  try {
    if (fs.existsSync(CORRUPT_FILE)) fs.unlinkSync(CORRUPT_FILE);
    fs.renameSync(DATA_FILE, CORRUPT_FILE);
  } catch (e3) {
    try { fs.unlinkSync(DATA_FILE); } catch (e4) {}
  }
}

// #5 损坏文件不静默覆盖，移到 .corrupt
function load() {
  ensure();
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const migrated = validateData(cache);
    if (migrated) save();
  } catch (e) {
    let recovered = false;
    if (fs.existsSync(BAK_FILE)) {
      try {
        cache = JSON.parse(fs.readFileSync(BAK_FILE, 'utf-8'));
        validateData(cache);
        recovered = true;
        console.log('Recovered from .bak file');
        moveCorruptFile();
      } catch (e2) {}
    }
    if (!recovered) {
      moveCorruptFile();
      cache = defaultData();
    }
    save();
  }
  return cache;
}

function validateData(d) {
  if (!d || !Array.isArray(d.reminders) || !Array.isArray(d.lists) || typeof d.settings !== 'object') {
    throw new Error('Invalid data structure');
  }
  if (typeof d.nextId !== 'number') d.nextId = d.reminders.length + 1;
  let migrated = false;
  // C3: 旧优先级迁移 (v1: 0=普通,1=高,2=中 → v2: 0=普通,1=中,2=高)
  if (!d.version || d.version < 2) {
    d.reminders.forEach(r => {
      if (r.priority === 1) r.priority = 2;      // 旧"高"→新"高"
      else if (r.priority === 2) r.priority = 1;  // 旧"中"→新"中"
    });
    d.version = 2;
    migrated = true;
  }
  // L4: 钳制越界优先级
  d.reminders.forEach(r => {
    if (typeof r.priority !== 'number' || r.priority < 0 || r.priority > 2) r.priority = 0;
  });
  return migrated;
}

// #4 原子写入: 先写 .tmp 再 rename, 保留 .bak 备份
function save(data) {
  if (data) cache = data;
  if (!cache) cache = defaultData();
  const json = JSON.stringify(cache, null, 2);
  fs.writeFileSync(TMP_FILE, json, 'utf-8');
  if (fs.existsSync(DATA_FILE)) {
    try {
      fs.copyFileSync(DATA_FILE, BAK_TMP_FILE);
      fs.renameSync(BAK_TMP_FILE, BAK_FILE);
    } catch (e) { console.warn('backup failed', e.message); }
  }
  try {
    fs.renameSync(TMP_FILE, DATA_FILE);
  } catch (e) {
    console.error('save rename failed', e.message);
    throw e;
  }
}

function get() {
  if (!cache) load();
  return cache;
}

// 不触发 save 的 ID 生成（用于批量操作内部）
function genIdNoSave() {
  const d = get();
  return d.nextId++;
}


function nowISO() {
  return new Date().toISOString();
}

// #45 月重复处理月末溢出
function computeNextDue(due, repeat) {
  if (!due || !repeat) return null;
  const d = new Date(due);
  switch (repeat) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekdays':
      d.setDate(d.getDate() + 1);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': {
      const origDay = d.getDate();
      d.setMonth(d.getMonth() + 1);
      if (d.getDate() !== origDay) d.setDate(0); // 月末溢出，回退到目标月最后一天
      break;
    }
    case 'yearly': {
      const origMonth = d.getMonth();
      d.setFullYear(d.getFullYear() + 1);
      // L6: 闰年2月29日yearly重复在非闰年会漂移到3月1日，回退到2月28日
      if (d.getMonth() !== origMonth) {
        d.setMonth(origMonth);
        d.setDate(28);
      }
      break;
    }
    default: return null;
  }
  return d.toISOString();
}

function getAll() { return get().reminders; }
function getActive() { return get().reminders.filter(r => !r.completed); }

function getDueSoon() {
  return get().reminders
    .filter(r => !r.completed && r.due)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
}

// #29 优先级降序: 高(2) > 中等(1) > 普通(0)
function getRecentActive(limit) {
  const d = get();
  const lim = limit || d.settings.floatCount || 6;
  return d.reminders
    .filter(r => !r.completed)
    .sort((a, b) => {
      const ad = a.due ? new Date(a.due).getTime() : Infinity;
      const bd = b.due ? new Date(b.due).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return (b.priority || 0) - (a.priority || 0);
    })
    .slice(0, lim);
}

function getById(id) {
  return get().reminders.find(r => r.id === Number(id));
}

function create(data) {
  data = data || {}; // H2: null 守卫
  const d = get();
  const r = {
    id: genIdNoSave(),
    title: String(data.title || '').trim(), // G6: 类型强制
    notes: data.notes || '',
    listId: data.listId || 'default',
    priority: data.priority || 0,
    due: data.due || null,
    repeat: data.repeat || null,
    tags: data.tags || [],
    subtasks: (data.subtasks || []).map(s => ({ id: genIdNoSave(), title: s.title, done: !!s.done })),
    completed: false,
    completedAt: null,
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  d.reminders.push(r);
  save();
  return r;
}

// #1 #2 字段白名单 + 子任务 ID 保留
function update(id, patch) {
  const r = getById(id);
  if (!r) return null;
  patch = patch || {}; // H2: null 守卫
  ALLOWED_FIELDS.forEach(f => {
    if (!(f in patch)) return;
    if (f === 'subtasks') {
      r.subtasks = (patch.subtasks || []).map(s => {
        const existing = (r.subtasks || []).find(x => x.id === Number(s.id));
        return {
          id: existing ? existing.id : genIdNoSave(),
          title: s.title || '',
          done: !!s.done
        };
      });
    } else if (f === 'title') {
      r.title = String(patch.title || '').trim(); // G6: 类型强制
    } else {
      r[f] = patch[f];
    }
  });
  r.updatedAt = nowISO();
  save();
  return r;
}

// 问题3: 完成提醒事项（可联动子任务），并处理重复生成
function completeReminder(r, cascadeSubtasks) {
  r.completed = true;
  r.completedAt = nowISO();
  if (cascadeSubtasks && r.subtasks && r.subtasks.length) {
    r.subtasks.forEach(s => { s.done = true; });
  }
  if (r.due && r.repeat && !r.spawned) {
    let nextDue = computeNextDue(r.due, r.repeat);
    const now = Date.now();
    while (nextDue && new Date(nextDue).getTime() <= now) {
      nextDue = computeNextDue(nextDue, r.repeat);
    }
    if (nextDue) {
      const d = get();
      const nr = {
        ...r,
        id: genIdNoSave(),
        due: nextDue,
        completed: false,
        completedAt: null,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        subtasks: (r.subtasks || []).map(s => ({ id: genIdNoSave(), title: s.title, done: false }))
      };
      d.reminders.push(nr);
      r.spawned = true;
      r.spawnedId = nr.id;
    }
  }
}

// 问题3: 取消完成提醒事项（可联动子任务），清理重复生成
function uncompleteReminder(r, cascadeSubtasks) {
  r.completed = false;
  r.completedAt = null;
  if (cascadeSubtasks && r.subtasks && r.subtasks.length) {
    r.subtasks.forEach(s => { s.done = false; });
  }
  if (r.spawnedId) {
    const d = get();
    const idx = d.reminders.findIndex(x => x.id === r.spawnedId);
    if (idx >= 0) d.reminders.splice(idx, 1);
    r.spawnedId = null;
  }
  r.spawned = false;
}

// #9 防重复生成: spawned 标记
function toggle(id) {
  const r = getById(id);
  if (!r) return null;
  if (r.completed) uncompleteReminder(r, true);  // 问题3: 联动子任务
  else completeReminder(r, true);
  save();
  return r;
}

function remove(id) {
  const d = get();
  const idx = d.reminders.findIndex(r => r.id === Number(id));
  if (idx >= 0) {
    const [removed] = d.reminders.splice(idx, 1);
    save();
    return removed;
  }
  return null;
}



// #21 null 守卫 + 问题3: 子任务联动提醒事项完成状态
function toggleSubtask(id, subId) {
  const r = getById(id);
  if (!r) return null;
  const subtasks = r.subtasks || [];
  const s = subtasks.find(x => x.id === Number(subId));
  if (s) s.done = !s.done;
  // 问题3: 所有子任务完成 → 自动完成提醒事项
  if (subtasks.length > 0 && subtasks.every(x => x.done)) {
    if (!r.completed) completeReminder(r, false);
  } else if (r.completed && subtasks.some(x => !x.done)) {
    // 问题3: 有子任务取消完成 → 自动取消完成提醒事项
    uncompleteReminder(r, false);
  }
  save();
  return r;
}

function getLists() { return get().lists; }

function createList(name, color) {
  const d = get();
  const l = { id: 'l' + genIdNoSave(), name: name || '新清单', color: color || '#007AFF' };
  d.lists.push(l);
  save();
  return l;
}

function updateList(id, patch) {
  const d = get();
  const l = d.lists.find(x => x.id === id);
  if (l) {
    if (patch.name !== undefined) l.name = patch.name;
    if (patch.color !== undefined) l.color = patch.color;
    save();
  }
  return l;
}

function deleteList(id) {
  if (id === 'default') return false;
  const d = get();
  d.lists = d.lists.filter(l => l.id !== id);
  d.reminders.filter(r => r.listId === id).forEach(r => { r.listId = 'default'; });
  save();
  return true;
}

function getSettings() { return get().settings; }

function updateSettings(patch) {
  const d = get();
  patch = patch || {};
  // M5: 白名单过滤，防止注入任意键
  ALLOWED_SETTINGS.forEach(k => {
    if (k in patch) d.settings[k] = patch[k];
  });
  save();
  return d.settings;
}

function exportData() { return JSON.stringify(get(), null, 2); }

// #3 导入校验
function importData(jsonStr) {
  let obj;
  try { obj = JSON.parse(jsonStr); }
  catch (e) { throw new Error('JSON 格式错误，无法解析'); }
  if (!obj || !Array.isArray(obj.reminders) || !Array.isArray(obj.lists) || typeof obj.settings !== 'object') {
    throw new Error('数据结构不合法：缺少 reminders/lists/settings 字段');
  }
  // L10: 校验单条提醒必填字段
  obj.reminders.forEach((r, i) => {
    if (typeof r.id !== 'number' || !r.title || r.listId === undefined) {
      throw new Error(`第 ${i+1} 条提醒数据不完整：缺少 id/title/listId`);
    }
    if (r.priority === undefined) r.priority = 0;
    if (r.completed === undefined) r.completed = false;
  });
  validateData(obj); // C3: 导入也执行迁移校验
  cache = obj;
  save();
  return obj;
}

module.exports = {
  load, get, save, getAll, getActive, getDueSoon, getRecentActive, getById,
  create, update, toggle, remove, toggleSubtask,
  getLists, createList, updateList, deleteList,
  getSettings, updateSettings, exportData, importData
};
