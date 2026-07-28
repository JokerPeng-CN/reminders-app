const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const DATA_FILE = path.join(DATA_DIR, 'reminders.json');
const TMP_FILE = DATA_FILE + '.tmp';
const BAK_FILE = DATA_FILE + '.bak';
const CORRUPT_FILE = DATA_FILE + '.corrupt';

let cache = null;

// #2 update() 允许修改的字段白名单
const ALLOWED_FIELDS = ['title', 'notes', 'listId', 'priority', 'due', 'repeat', 'tags', 'subtasks'];

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) save(defaultData());
}

function defaultData() {
  const now = new Date();
  const today = (offsetH, m = 0) => {
    const d = new Date(now);
    d.setHours(d.getHours() + offsetH, d.getMinutes() + m, 0, 0);
    return d.toISOString();
  };
  const tomorrow = (h) => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };
  // 优先级: 0=普通, 1=中等, 2=高 (#29)
  return {
    reminders: [
      { id: 1, title: '欢迎使用提醒事项', notes: '双击事项可编辑，关闭主窗口会自动显示悬浮小窗。', listId: 'default', priority: 2, due: today(1), repeat: null, tags: ['帮助'], subtasks: [], completed: false, completedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() },
      { id: 2, title: '回复重要邮件', notes: '', listId: 'work', priority: 1, due: today(2), repeat: null, tags: [], subtasks: [{id:3,title:'整理今日待办',done:false}], completed: false, completedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() },
      { id: 3, title: '每天喝水 8 杯', notes: '保持健康习惯', listId: 'personal', priority: 0, due: today(3, 30), repeat: 'daily', tags: ['健康'], subtasks: [], completed: false, completedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() },
      { id: 4, title: '准备明天会议材料', notes: '', listId: 'work', priority: 2, due: tomorrow(9), repeat: null, tags: [], subtasks: [], completed: false, completedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() },
      { id: 5, title: '买牛奶和面包', notes: '超市', listId: 'personal', priority: 0, due: null, repeat: null, tags: ['购物'], subtasks: [], completed: false, completedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() },
      { id: 6, title: '已完成示例:整理桌面', notes: '', listId: 'default', priority: 0, due: null, repeat: null, tags: [], subtasks: [], completed: true, completedAt: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString() }
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
    nextId: 7,
    version: 2
  };
}

// #5 损坏文件不静默覆盖，移到 .corrupt
function load() {
  ensure();
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    validateData(cache);
  } catch (e) {
    // 尝试 .bak 备份
    let recovered = false;
    if (fs.existsSync(BAK_FILE)) {
      try {
        cache = JSON.parse(fs.readFileSync(BAK_FILE, 'utf-8'));
        validateData(cache);
        recovered = true;
        console.log('Recovered from .bak file');
      } catch (e2) {}
    }
    if (!recovered) {
      // H5: 先删除损坏的 DATA_FILE，避免 save() 将其复制到 .bak
      try {
        if (fs.existsSync(CORRUPT_FILE)) fs.unlinkSync(CORRUPT_FILE);
        fs.renameSync(DATA_FILE, CORRUPT_FILE);
      } catch (e3) {
        try { fs.unlinkSync(DATA_FILE); } catch (e4) {}
      }
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
  // C3: 旧优先级迁移 (v1: 0=普通,1=高,2=中 → v2: 0=普通,1=中,2=高)
  if (!d.version || d.version < 2) {
    d.reminders.forEach(r => {
      if (r.priority === 1) r.priority = 2;      // 旧"高"→新"高"
      else if (r.priority === 2) r.priority = 1;  // 旧"中"→新"中"
    });
    d.version = 2;
  }
  // L4: 钳制越界优先级
  d.reminders.forEach(r => {
    if (typeof r.priority !== 'number' || r.priority < 0 || r.priority > 2) r.priority = 0;
  });
}

// #4 原子写入: 先写 .tmp 再 rename, 保留 .bak 备份
function save(data) {
  if (data) cache = data;
  if (!cache) cache = defaultData();
  const json = JSON.stringify(cache, null, 2);
  fs.writeFileSync(TMP_FILE, json, 'utf-8');
  if (fs.existsSync(DATA_FILE)) {
    try { fs.copyFileSync(DATA_FILE, BAK_FILE); } catch (e) {}
  }
  fs.renameSync(TMP_FILE, DATA_FILE);
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

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
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
    title: (data.title || '').trim(),
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
    } else {
      r[f] = patch[f];
    }
  });
  r.updatedAt = nowISO();
  save();
  return r;
}

// #9 防重复生成: spawned 标记
function toggle(id) {
  const r = getById(id);
  if (!r) return null;
  // C1: 只 toggle 一次 (之前有重复行互相抵消)
  r.completed = !r.completed;
  r.completedAt = r.completed ? nowISO() : null;
  // M1: 取消完成时清除 spawned 标记 + 删除已生成的下一次提醒
  if (!r.completed) {
    // 取消完成: 清除 spawned 标记，删除已生成的下一次
    if (r.spawnedId) {
      const d = get();
      const idx = d.reminders.findIndex(x => x.id === r.spawnedId);
      if (idx >= 0) d.reminders.splice(idx, 1);
      r.spawnedId = null;
    }
    r.spawned = false;
  }
  if (r.completed && r.due && r.repeat && !r.spawned) {
    const nextDue = computeNextDue(r.due, r.repeat);
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
      r.spawnedId = nr.id; // 记录生成的下次提醒 ID
    }
  }
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



// #21 null 守卫
function toggleSubtask(id, subId) {
  const r = getById(id);
  if (!r) return null;
  const subtasks = r.subtasks || [];
  const s = subtasks.find(x => x.id === Number(subId));
  if (s) s.done = !s.done;
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
  Object.assign(d.settings, patch);
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
