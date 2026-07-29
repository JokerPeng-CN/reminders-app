// L5: 主窗口与悬浮窗共享的日期工具函数

function formatDate(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }

function dueClass(r) {
  const d = new Date(r.due);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(today); t.setDate(t.getDate() + 1);
  if (d < today) return 'overdue';
  if (d < t) return 'today';
  return '';
}

function dueText(r, opts) {
  opts = opts || {};
  const d = new Date(r.due);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(today); t.setDate(t.getDate() + 1);
  const time = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  if (d < today) return opts.overduePrefix != null ? opts.overduePrefix : '已逾期 · ' + formatDate(d);
  if (d < t) return '今天 ' + time;
  const t2 = new Date(today); t2.setDate(t2.getDate() + 2);
  if (d < t2) return '明天 ' + time;
  return formatDate(d);
}

window.ReminderUtil = { formatDate, dueClass, dueText };
