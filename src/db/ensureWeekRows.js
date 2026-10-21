import pool from './pool.js';

const BLANK_ROWS = 8;

/** One blank row + rows for every subcontractor (active/inactive) with rate/HST prefilled, hours empty. */
export async function ensureWeekRows(weekId, connection = pool) {
  const [subs] = await connection.query(
    'SELECT id, full_name, default_hourly_rate, default_hst_applies, status FROM employees ORDER BY full_name'
  );

  const [existing] = await connection.query(
    'SELECT id, employee_id FROM timesheet_rows WHERE payroll_week_id = ?',
    [weekId]
  );

  const byEmployee = new Map();
  let blankCount = 0;
  for (const r of existing) {
    if (r.employee_id == null) blankCount++;
    else byEmployee.set(r.employee_id, r.id);
  }

  let sort = existing.length;
  for (const sub of subs) {
    if (byEmployee.has(sub.id)) continue;
    await connection.query(
      `INSERT INTO timesheet_rows (
        payroll_week_id, employee_id, sort_order, hourly_rate, hst_applies
      ) VALUES (?, ?, ?, ?, ?)`,
      [weekId, sub.id, sort++, sub.default_hourly_rate, sub.default_hst_applies ? 1 : 0]
    );
  }

  while (blankCount < BLANK_ROWS) {
    await connection.query(
      `INSERT INTO timesheet_rows (payroll_week_id, employee_id, sort_order, hourly_rate, hst_applies)
       VALUES (?, NULL, ?, 0, 1)`,
      [weekId, sort++]
    );
    blankCount++;
  }
}

export async function ensureWeeks2026(connection = pool) {
  const { getWeeks2026 } = await import('./weeks2026.js');
  const weeks = getWeeks2026();
  for (const w of weeks) {
    const [found] = await connection.query('SELECT id FROM payroll_weeks WHERE week_start = ?', [w.week_start]);
    let weekId;
    if (found.length) weekId = found[0].id;
    else {
      const [ins] = await connection.query(
        'INSERT INTO payroll_weeks (week_start, week_end, title) VALUES (?, ?, ?)',
        [w.week_start, w.week_end, w.title]
      );
      weekId = ins.insertId;
    }
    await ensureWeekRows(weekId, connection);
  }
  return weeks.length;
}
