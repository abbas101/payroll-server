import { Router } from 'express';
import pool from '../db/pool.js';
import { calcTimesheetRow, rowFromDb } from '../utils/payrollCalc.js';

const router = Router();

function mapRow(r) {
  return {
    ...r,
    hst_applies: Boolean(r.hst_applies),
    use_manual_pay: Boolean(r.use_manual_pay),
  };
}

const rowSelect = `
  SELECT tr.*, e.full_name
  FROM timesheet_rows tr
  JOIN employees e ON e.id = tr.employee_id
`;

router.get('/dashboard', async (_req, res) => {
  try {
    const [[empStats]] = await pool.query(
      "SELECT COUNT(*) AS total, SUM(status='active') AS active FROM employees"
    );
    const [weeks] = await pool.query(
      `SELECT pw.*,
        (SELECT COALESCE(SUM(total_to_pay), 0) FROM timesheet_rows tr WHERE tr.payroll_week_id = pw.id) AS total_payout
       FROM payroll_weeks pw ORDER BY week_start DESC LIMIT 6`
    );
    res.json({ employees: empStats, recentWeeks: weeks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pw.*,
        (SELECT COUNT(*) FROM timesheet_rows tr WHERE tr.payroll_week_id = pw.id) AS row_count,
        (SELECT COALESCE(SUM(total_to_pay), 0) FROM timesheet_rows tr WHERE tr.payroll_week_id = pw.id) AS total_payout
       FROM payroll_weeks pw ORDER BY week_start DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/weeks', async (req, res) => {
  const { week_start, week_end, title } = req.body;
  if (!week_start || !week_end || !title) {
    return res.status(400).json({ error: 'week_start, week_end, and title are required' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO payroll_weeks (week_start, week_end, title) VALUES (?, ?, ?)',
      [week_start, week_end, title]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Week already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks/:id', async (req, res) => {
  try {
    const [weeks] = await pool.query('SELECT * FROM payroll_weeks WHERE id = ?', [req.params.id]);
    if (!weeks.length) return res.status(404).json({ error: 'Week not found' });
    const [rows] = await pool.query(`${rowSelect} WHERE tr.payroll_week_id = ? ORDER BY tr.sort_order, tr.id`, [
      req.params.id,
    ]);
    res.json({ week: weeks[0], rows: rows.map(mapRow) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/weeks/:id/rows', async (req, res) => {
  let {
    employee_id,
    new_worker_name,
    hourly_rate,
    hours_mon = 0,
    hours_tue = 0,
    hours_wed = 0,
    hours_thu = 0,
    hours_fri = 0,
    hours_sat = 0,
    hours_sun = 0,
    hst_applies = true,
    use_manual_pay = false,
    total_pay,
    materials = 0,
    gas_parking = 0,
    extras = 0,
    notes = '',
  } = req.body;

  try {
    if (!employee_id && new_worker_name?.trim()) {
      const name = new_worker_name.trim();
      const [ins] = await pool.query(
        'INSERT INTO employees (full_name, default_hourly_rate, default_hst_applies) VALUES (?, ?, ?)',
        [name, hourly_rate ?? 0, hst_applies ? 1 : 0]
      );
      employee_id = ins.insertId;
    }
    if (!employee_id) return res.status(400).json({ error: 'employee_id or new_worker_name is required' });

    const [emp] = await pool.query('SELECT * FROM employees WHERE id = ?', [employee_id]);
    if (!emp.length) return res.status(404).json({ error: 'Employee not found' });

    const rate = hourly_rate ?? emp[0].default_hourly_rate;
    const draft = {
      hours_mon,
      hours_tue,
      hours_wed,
      hours_thu,
      hours_fri,
      hours_sat,
      hours_sun,
      hourly_rate: rate,
      hst_applies: hst_applies ? 1 : 0,
      materials,
      gas_parking,
      extras,
      total_pay: use_manual_pay ? total_pay : undefined,
      use_manual_pay: use_manual_pay ? 1 : 0,
    };
    const calc = calcTimesheetRow(rowFromDb(draft));

    const [maxSort] = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM timesheet_rows WHERE payroll_week_id = ?',
      [req.params.id]
    );

    const [result] = await pool.query(
      `INSERT INTO timesheet_rows (
        payroll_week_id, employee_id, sort_order, hourly_rate,
        hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat, hours_sun,
        total_hours, hst_applies, total_pay, materials, gas_parking, extras, total_to_pay, use_manual_pay, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        employee_id,
        maxSort[0].next_sort,
        rate,
        hours_mon,
        hours_tue,
        hours_wed,
        hours_thu,
        hours_fri,
        hours_sat,
        hours_sun,
        calc.total_hours,
        hst_applies ? 1 : 0,
        calc.total_pay,
        materials,
        gas_parking,
        extras,
        calc.total_to_pay,
        use_manual_pay ? 1 : 0,
        notes || null,
      ]
    );

    const [created] = await pool.query(`${rowSelect} WHERE tr.id = ?`, [result.insertId]);
    res.status(201).json(mapRow(created[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/weeks/:weekId/rows/:rowId', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM timesheet_rows WHERE id = ? AND payroll_week_id = ?', [
      req.params.rowId,
      req.params.weekId,
    ]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/weeks/:weekId/rows/:rowId', async (req, res) => {
  const fields = [
    'hourly_rate',
    'hours_mon',
    'hours_tue',
    'hours_wed',
    'hours_thu',
    'hours_fri',
    'hours_sat',
    'hours_sun',
    'hst_applies',
    'materials',
    'gas_parking',
    'extras',
    'total_pay',
    'use_manual_pay',
    'notes',
  ];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      if (f === 'hst_applies' || f === 'use_manual_pay') params.push(req.body[f] ? 1 : 0);
      else params.push(req.body[f]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  try {
    const [rows] = await pool.query('SELECT * FROM timesheet_rows WHERE id = ? AND payroll_week_id = ?', [
      req.params.rowId,
      req.params.weekId,
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Row not found' });

    const merged = { ...rows[0], ...req.body };
    if (req.body.hst_applies !== undefined) merged.hst_applies = req.body.hst_applies ? 1 : 0;
    if (req.body.use_manual_pay !== undefined) merged.use_manual_pay = req.body.use_manual_pay ? 1 : 0;

    const calc = calcTimesheetRow(rowFromDb(merged));
    const allUpdates = [...updates, 'total_hours = ?', 'total_pay = ?', 'total_to_pay = ?'];
    const allParams = [...params, calc.total_hours, calc.total_pay, calc.total_to_pay, req.params.rowId];

    await pool.query(`UPDATE timesheet_rows SET ${allUpdates.join(', ')} WHERE id = ?`, allParams);
    const [updated] = await pool.query(`${rowSelect} WHERE tr.id = ?`, [req.params.rowId]);
    res.json(mapRow(updated[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/weeks/:id/recalculate', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM timesheet_rows WHERE payroll_week_id = ?', [req.params.id]);
    for (const r of rows) {
      const calc = calcTimesheetRow(rowFromDb(r));
      await pool.query('UPDATE timesheet_rows SET total_hours=?, total_pay=?, total_to_pay=? WHERE id=?', [
        calc.total_hours,
        calc.total_pay,
        calc.total_to_pay,
        r.id,
      ]);
    }
    res.json({ ok: true, rows: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
