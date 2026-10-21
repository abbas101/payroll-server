function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatTitle(weekStart) {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return `${days[0]} ${ordinal(weekStart.getDate())} ${months[weekStart.getMonth()]} – ${days[6]} ${ordinal(end.getDate())} ${months[end.getMonth()]} ${end.getFullYear()}`;
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** All Monday-start weeks in 2026 */
export function getWeeks2026() {
  const weeks = [];
  const d = new Date(2026, 0, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  while (d.getFullYear() === 2026) {
    const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weeks.push({
      week_start: toIsoDate(weekStart),
      week_end: toIsoDate(weekEnd),
      title: formatTitle(weekStart),
    });
    d.setDate(d.getDate() + 7);
  }
  return weeks;
}

export function findCurrentWeekStart(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toIsoDate(d);
}
