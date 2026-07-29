const { createApp, ref, reactive, computed, onMounted, onUnmounted, nextTick } = Vue;

createApp({
  setup() {
    const reminders = ref([]);
    const lists = ref([]);
    const view = ref('all');
    const query = ref('');
    const quickTitle = ref('');
    const theme = ref('light');
    const editor = reactive({ open: false, data: null, newSub: '', error: '' });
    const settings = reactive({ open: false, data: {} });
    const listEditor = reactive({ open: false, data: { id: null, name: '', color: '#007AFF' }, error: '', isEdit: false });
    const helpOpen = ref(false);

    const settingDefs = [
      { key: 'showFloatOnClose', label: '关闭主窗口时显示悬浮窗' },
      { key: 'autoStart', label: '开机自启动' },
      { key: 'notifySound', label: '通知声音' }
    ];

    const presetColors = ['#007AFF','#FF9500','#34C759','#FF2D55','#AF52DE','#5856D6','#FFCC00','#A2845E','#FF6482','#64D2FF'];

    async function loadAll() {
      try {
        reminders.value = await window.api.getAll();
        lists.value = await window.api.getLists();
        const s = await window.api.getSettings();
        theme.value = s.theme;
        applyTheme();
        settings.data = JSON.parse(JSON.stringify(s)); // M1: 深拷贝，避免直接引用主进程缓存
      } catch (e) { console.error('loadAll error', e); }
    }

    function applyTheme() {
      document.documentElement.setAttribute('data-theme', theme.value);
    }

    async function toggleTheme() {
      theme.value = theme.value === 'light' ? 'dark' : 'light';
      applyTheme();
      settings.data.theme = theme.value; // C4: 同步 settings 防止保存时回退
      try { await window.api.updateSettings({ theme: theme.value }); } catch (e) { console.error(e); }
    }

    const listMap = computed(() => {
      const m = {};
      lists.value.forEach(l => m[l.id] = l);
      return m;
    });

    function listName(id) { return listMap.value[id] ? listMap.value[id].name : ''; }
    function listColor(id) { return listMap.value[id] ? listMap.value[id].color : '#888'; }

    const counts = computed(() => {
      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
      const c = { today: 0, scheduled: 0, all: 0, flagged: 0, completed: 0 };
      reminders.value.forEach(r => {
        if (r.completed) { c.completed++; return; }
        c.all++;
        if (r.priority === 2) c.flagged++;
        if (r.due) {
          const d = new Date(r.due);
          if (d < tomorrow) c.today++;
          c.scheduled++;
        }
      });
      return c;
    });

    const listCounts = computed(() => {
      const m = {};
      reminders.value.forEach(r => { if (!r.completed) m[r.listId] = (m[r.listId]||0)+1; });
      return m;
    });


    const filtered = computed(() => {
      let arr = reminders.value.slice();
      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);

      if (view.value === 'today') {
        arr = arr.filter(r => !r.completed && r.due && new Date(r.due) < tomorrow);
      } else if (view.value === 'scheduled') {
        arr = arr.filter(r => !r.completed && r.due);
      } else if (view.value === 'all') {
        arr = arr.filter(r => !r.completed);
      } else if (view.value === 'flagged') {
        arr = arr.filter(r => !r.completed && r.priority === 2);
      } else if (view.value === 'completed') {
        arr = arr.filter(r => r.completed);
      } else if (view.value.startsWith('list:')) {
        const lid = view.value.split(':')[1];
        arr = arr.filter(r => !r.completed && r.listId === lid);
      }

      if (query.value.trim()) {
        const q = query.value.toLowerCase();
        arr = arr.filter(r => (r.title||'').toLowerCase().includes(q) || (r.notes||'').toLowerCase().includes(q));
      }

      arr.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const ad = a.due ? new Date(a.due).getTime() : Infinity;
        const bd = b.due ? new Date(b.due).getTime() : Infinity;
        if (ad !== bd) return ad - bd;
        return (b.priority||0) - (a.priority||0); // #29: 优先级降序 高>中>普通
      });
      return arr;
    });

    const viewTitle = computed(() => {
      const map = { today:'今天', scheduled:'计划', all:'全部', flagged:'已标记', completed:'已完成' };
      if (map[view.value]) return map[view.value];
      if (view.value.startsWith('list:')) return listName(view.value.split(':')[1]);
      return '提醒事项';
    });

    function setView(v) { view.value = v; }

    // L5: 使用共享工具函数
    function dueClass(r) { return window.ReminderUtil.dueClass(r); }
    function dueText(r) { return window.ReminderUtil.dueText(r); }

    function prioText(p) { return p===2?'高':(p===1?'中':''); } // #29: 2=高, 1=中
    function repeatText(rp) {
      return { daily:'每天', weekdays:'工作日', weekly:'每周', monthly:'每月', yearly:'每年' }[rp] || rp;
    }

    function openEditor(r) {
      editor.error = '';
      if (r) {
        editor.data = {
          id: r.id, title: r.title, notes: r.notes, listId: r.listId,
          priority: r.priority || 0, due: r.due ? toLocalInput(r.due) : '',
          repeat: r.repeat || null, tagsStr: (r.tags||[]).join(', '),
          subtasks: (r.subtasks||[]).map(s => ({...s}))
        };
      } else {
        editor.data = {
          id: null, title: '', notes: '', listId: currentListId(),
          priority: 0, due: '', repeat: null, tagsStr: '', subtasks: []
        };
      }
      editor.newSub = '';
      editor.open = true;
    }

    function currentListId() {
      if (view.value.startsWith('list:')) return view.value.split(':')[1];
      return 'default';
    }

    function toLocalInput(iso) {
      const d = new Date(iso);
      const off = d.getTimezoneOffset();
      const local = new Date(d.getTime() - off*60000);
      return local.toISOString().slice(0,16);
    }

    function fromLocalInput(val) {
      if (!val) return null;
      const d = new Date(val);
      if (isNaN(d.getTime())) return null; // #20: 无效日期不抛异常
      return d.toISOString();
    }

    function addSub() {
      if (!editor.newSub.trim()) return;
      editor.data.subtasks.push({ id: Date.now() + Math.random(), title: editor.newSub.trim(), done: false });
      editor.newSub = '';
    }

    function removeSubtask(id) { // L8: 按 ID 删除子任务
      const idx = editor.data.subtasks.findIndex(s => s.id === id);
      if (idx >= 0) editor.data.subtasks.splice(idx, 1);
    }

    function toPlain(obj) { return JSON.parse(JSON.stringify(obj)); }

    async function save() {
      const d = editor.data;
      if (!d || !d.title || !d.title.trim()) {
        editor.error = '请输入提醒事项标题（必填）';
        return;
      }
      editor.error = '';
      try {
        const payload = toPlain({
          title: d.title.trim(), notes: d.notes, listId: d.listId, priority: d.priority,
          due: fromLocalInput(d.due), repeat: d.repeat,
          tags: (d.tagsStr||'').split(',').map(t=>t.trim()).filter(Boolean),
          subtasks: (d.subtasks||[]).map(s => ({ id: s.id, title: s.title, done: !!s.done }))
        });
        if (d.id) await window.api.update(d.id, payload);
        else await window.api.create(payload);
        editor.open = false;
        await loadAll();
      } catch (e) {
        editor.error = '保存失败: ' + e.message;
        console.error('save error', e);
      }
    }

    async function quickAdd() {
      if (!quickTitle.value.trim()) return;
      try {
        const payload = {
          title: quickTitle.value.trim(), listId: currentListId(),
          priority: 0, due: null, repeat: null, tags: [], subtasks: []
        };
        await window.api.create(payload);
        quickTitle.value = '';
        await loadAll();
      } catch (e) { console.error('quickAdd error', e); }
    }

    async function toggle(id) {
      try { await window.api.toggle(id); await loadAll(); }
      catch (e) { console.error('toggle error', e); }
    }
    async function toggleSub(id, subId) {
      try { await window.api.toggleSubtask(id, subId); await loadAll(); }
      catch (e) { console.error('toggleSub error', e); }
    }
    async function remove(id) {
      try { await window.api.remove(id); await loadAll(); }
      catch (e) { console.error('remove error', e); }
    }

    // ---------- 清单管理 ----------
    function openListEditor(list) {
      listEditor.error = '';
      if (list) {
        listEditor.isEdit = true;
        listEditor.data = { id: list.id, name: list.name, color: list.color };
      } else {
        listEditor.isEdit = false;
        listEditor.data = { id: null, name: '', color: presetColors[Math.floor(Math.random()*presetColors.length)] };
      }
      listEditor.open = true;
    }

    async function saveList() {
      const d = listEditor.data;
      if (!d.name || !d.name.trim()) {
        listEditor.error = '请输入清单名称';
        return;
      }
      listEditor.error = '';
      try {
        if (d.id) {
          await window.api.updateList(d.id, { name: d.name.trim(), color: d.color });
        } else {
          await window.api.createList(d.name.trim(), d.color);
        }
        listEditor.open = false;
        await loadAll();
      } catch (e) {
        listEditor.error = '操作失败: ' + e.message;
        console.error('saveList error', e);
      }
    }

    async function deleteListFromEditor() {
      const d = listEditor.data;
      if (!d.id || d.id === 'default') {
        listEditor.error = '默认清单不可删除';
        return;
      }
      try {
        await window.api.deleteList(d.id);
        listEditor.open = false;
        if (view.value === 'list:' + d.id) view.value = 'all';
        await loadAll();
      } catch (e) {
        listEditor.error = '删除失败: ' + e.message;
      }
    }

    function toggleFloat() { window.api.toggleFloat(); }
    function openHelp() { helpOpen.value = true; }

    function openSettings() {
      settings.open = true;
    }
    function closeSettings() {
      loadAll();
      settings.open = false;
    }
    async function saveSettings() {
      try {
        await window.api.updateSettings(toPlain(settings.data));
        settings.open = false;
        await loadAll();
      } catch (e) {
        console.error('saveSettings error', e);
        alert('保存设置失败: ' + e.message);
      }
    }
    async function exportData() {
      try {
        const data = await window.api.exportData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'reminders-backup-' + new Date().toISOString().slice(0,10) + '.json';
        a.click(); URL.revokeObjectURL(url);
      } catch (e) { alert('导出失败: ' + e.message); }
    }
    function importData() {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        try {
          const text = await file.text();
          await window.api.importData(text);
          await loadAll();
        } catch (e) { alert('导入失败: ' + e.message); }
      };
      input.click();
    }

    function captureKey(e, field) {
      e.preventDefault();
      const mods = [];
      if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      const key = e.key;
      if (['Control','Alt','Shift','Meta'].includes(key)) return;
      if (mods.length === 0) return;
      // L7: 特殊键映射为 Electron accelerator 名称
      const keyMap = { 'ArrowUp':'Up','ArrowDown':'Down','ArrowLeft':'Left','ArrowRight':'Right',
        'Enter':'Return','Escape':'Escape','Tab':'Tab','Backspace':'Backspace',
        'Delete':'Delete','Space':'Space' };
      let keyName = keyMap[key] || key;
      if (keyName.length === 1) keyName = keyName.toUpperCase();
      settings.data[field] = mods.join('+') + '+' + keyName;
    }

    // ---------- ESC 关闭弹窗 ----------
    function handleKeydown(e) {
      if (e.key === 'Escape') {
        if (listEditor.open) listEditor.open = false;
        else if (editor.open) editor.open = false;
        else if (settings.open) closeSettings();
        else if (helpOpen.value) helpOpen.value = false;
      }
    }

    const cleanups = [];

    onMounted(async () => {
      await loadAll();
      document.addEventListener('keydown', handleKeydown);
      cleanups.push(window.api.onFocusReminder(async (id) => {
        view.value = 'all';
        await loadAll();
        await nextTick();
        setTimeout(() => {
          const el = document.querySelector('.reminder[data-id="' + id + '"]');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('flash');
            setTimeout(() => el.classList.remove('flash'), 2000);
          }
        }, 200);
      }));
      cleanups.push(window.api.onNewReminder(() => { openEditor(null); }));
      cleanups.push(window.api.onToggleTheme(() => { toggleTheme(); }));
      cleanups.push(window.api.onOpenHelp(() => { helpOpen.value = true; }));
      cleanups.push(window.api.onThemeChanged((newTheme) => { theme.value = newTheme; applyTheme(); settings.data.theme = newTheme; }));
      cleanups.push(window.api.onRefresh(() => loadAll()));
    });

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeydown);
      cleanups.forEach(fn => fn());
    });

    return {
      reminders, lists, view, query, quickTitle, theme, editor, settings, settingDefs,
      listEditor, helpOpen, presetColors,
      counts, listCounts, filtered, viewTitle,
      setView, listName, listColor, dueClass, dueText, prioText, repeatText,
      openEditor, save, quickAdd, toggle, toggleSub, remove,
      openListEditor, saveList, deleteListFromEditor,
      toggleFloat, toggleTheme, openSettings, closeSettings, saveSettings, exportData, importData, addSub, removeSubtask,
      captureKey, openHelp
    };
  }
}).mount('#app');
