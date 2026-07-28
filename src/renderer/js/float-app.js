const { createApp, ref, onMounted, nextTick } = Vue;

createApp({
  setup() {
    const items = ref([]);
    const settings = ref({});
    const adding = ref(false);
    const newTitle = ref('');
    const addInput = ref(null);

    async function refresh() { // #25: 加错误处理
      try {
        settings.value = await window.floatApi.getSettings();
        items.value = await window.floatApi.getRecent(settings.value.floatCount || 6);
        applyTheme(settings.value.theme);
      } catch (e) { console.error('float refresh error', e); }
    }

    function applyTheme(t) {
      document.documentElement.setAttribute('data-theme', t || 'light');
    }

    async function toggle(id) {
      try { await window.floatApi.toggle(id); await refresh(); }
      catch (e) { console.error('float toggle error', e); }
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

    function dueClass(r) {
      const d = new Date(r.due);
      const today = new Date(); today.setHours(0,0,0,0);
      const t = new Date(today); t.setDate(t.getDate()+1);
      if (d < today) return 'overdue';
      if (d < t) return 'today';
      return 'normal';
    }

    function dueText(r) {
      const d = new Date(r.due);
      const today = new Date(); today.setHours(0,0,0,0);
      const t = new Date(today); t.setDate(t.getDate()+1);
      const time = d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
      if (d < today) return '已逾期';
      if (d < t) return '今天 ' + time;
      const t2 = new Date(today); t2.setDate(t2.getDate()+2);
      if (d < t2) return '明天 ' + time;
      return (d.getMonth()+1)+'月'+d.getDate()+'日';
    }

    onMounted(() => {
      refresh();
      window.floatApi.onRefresh(() => refresh());
    });

    return { items, settings, adding, newTitle, addInput,
             toggle, hide, showMain, startAdd, confirmAdd, cancelAdd,
             dueClass, dueText };
  }
}).mount('#app');
