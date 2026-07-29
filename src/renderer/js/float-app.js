const { createApp, ref, onMounted, nextTick } = Vue;

createApp({
  setup() {
    const items = ref([]);
    const settings = ref({});
    const adding = ref(false);
    const newTitle = ref('');
    const addInput = ref(null);
    const expandedId = ref(null); // 需求1: 当前展开子任务的提醒ID

    async function refresh() {
      try {
        settings.value = await window.floatApi.getSettings();
        items.value = await window.floatApi.getRecent(settings.value.floatCount || 6);
        applyTheme(settings.value.theme);
      } catch (e) { console.error('float refresh error', e); }
    }

    function applyTheme(t) {
      document.documentElement.setAttribute('data-theme', t || 'light');
    }

    // 需求4: 主题切换
    async function toggleTheme() {
      const newTheme = settings.value.theme === 'light' ? 'dark' : 'light';
      settings.value.theme = newTheme;
      applyTheme(newTheme);
      try { await window.floatApi.updateSettings({ theme: newTheme }); } catch (e) { console.error(e); }
    }

    // 需求4: 最小化为logo
    function minimize() { window.floatApi.minimize(); }

    // 需求1: 展开/折叠子任务
    function toggleExpand(id) {
      if (expandedId.value === id) expandedId.value = null;
      else expandedId.value = id;
    }

    async function toggle(id) {
      try { await window.floatApi.toggle(id); await refresh(); }
      catch (e) { console.error('float toggle error', e); }
    }

    // 需求1: 子任务勾选
    async function toggleSub(id, subId) {
      try { await window.floatApi.toggleSubtask(id, subId); await refresh(); }
      catch (e) { console.error('float toggleSub error', e); }
    }

    function hide() { window.floatApi.hide(); }
    function showMain() { window.floatApi.showMain(); }

    async function startAdd() {
      adding.value = true;
      newTitle.value = '';
      await nextTick();
      if (addInput.value) addInput.value.focus();
    }

    async function confirmAdd() {
      if (!newTitle.value.trim()) { adding.value = false; return; }
      try {
        await window.floatApi.create({
          title: newTitle.value.trim(),
          listId: 'default',
          priority: 0, due: null, repeat: null, tags: [], subtasks: []
        });
        newTitle.value = '';
        adding.value = false;
        await refresh();
      } catch (e) { console.error('add error', e); }
    }

    function cancelAdd() {
      adding.value = false;
      newTitle.value = '';
    }

    // L5: 使用共享工具函数（悬浮窗逾期显示简短文本）
    function dueClass(r) {
      const cls = window.ReminderUtil.dueClass(r);
      return cls || 'normal';
    }
    function dueText(r) { return window.ReminderUtil.dueText(r, { overduePrefix: '已逾期' }); }

    onMounted(() => {
      refresh();
      window.floatApi.onRefresh(() => refresh());
    });

    return { items, settings, adding, newTitle, addInput, expandedId,
             toggle, toggleSub, hide, showMain, startAdd, confirmAdd, cancelAdd,
             toggleExpand, toggleTheme, minimize,
             dueClass, dueText };
  }
}).mount('#app');
