import { Router } from 'express';
import pool from '../db/pool.js';
import { ensureWeekRows } from '../db/ensureWeekRows.js';
import { findCurrentWeekStart } from '../db/weeks2026.js';
import { calcTimesheetRow, rowFromDb } from '../utils/payrollCalc.js';

const router = Router();

function mapRow(r) {
  return {
    ...r,
    hst_applies: Boolean(r.hst_applies),
    use_manual_pay: Boolean(r.use_manual_pay),
    full_name: r.full_name || '',
    subcontractor_status: r.subcontractor_status || null,
  };
}

const rowSelect = `
  SELECT tr.*, e.full_name, e.status AS subcontractor_status
  FROM timesheet_rows tr
  LEFT JOIN employees e ON e.id = tr.employee_id
`;

router.get('/dashboard', async (_req, res) => {
  try {
    const currentWeekStart = findCurrentWeekStart();
    const year = new Date().getFullYear();

    const [[empStats]] = await pool.query(
      "SELECT COUNT(*) AS total, SUM(status='active') AS active FROM employees"
    );

    const [[currentWeek]] = await pool.query('SELECT id FROM payroll_weeks WHERE week_start = ?', [
      currentWeekStart,
    ]);

    let currentWeekId = currentWeek?.id;
    if (!currentWeekId) {
      const { ensureWeeks2026 } = await import('../db/ensureWeekRows.js');
      await ensureWeeks2026();
      const [[again]] = await pool.query('SELECT id FROM payroll_weeks WHERE week_start = ?', [currentWeekStart]);
      currentWeekId = again?.id;
    }

    let currentWeekStats = { total_pay: 0, total_invoices: 0, total_to_pay: 0, avg_pay: 0, row_count: 0 };
    if (currentWeekId) {
      const [[stats]] = await pool.query(
        `SELECT
          COALESCE(SUM(total_pay), 0) AS total_pay,
          COALESCE(SUM(CASE WHEN hst_applies = 1 THEN total_to_pay ELSE 0 END), 0) AS total_invoices,
          COALESCE(SUM(total_to_pay), 0) AS total_to_pay,
          COALESCE(AVG(total_to_pay), 0) AS avg_pay,
          COUNT(*) AS row_count
         FROM timesheet_rows WHERE payroll_week_id = ?`,
        [currentWeekId]
      );
      currentWeekStats = stats;
    }

    const [[yearStats]] = await pool.query(
      `SELECT COALESCE(SUM(tr.total_to_pay), 0) AS total_paid_ytd
       FROM timesheet_rows tr
       INNER JOIN payroll_weeks pw ON pw.id = tr.payroll_week_id
       WHERE YEAR(pw.week_start) = ? AND pw.week_start <= CURDATE()`,
      [year]
    );

    const [recentWeeks] = await pool.query(
      `SELECT pw.*,
        (SELECT COALESCE(SUM(total_to_pay), 0) FROM timesheet_rows tr WHERE tr.payroll_week_id = pw.id) AS total_payout
       FROM payroll_weeks pw ORDER BY week_start DESC LIMIT 8`
    );

    res.json({
      activeSubcontractors: empStats.active ?? 0,
      totalSubcontractors: empStats.total ?? 0,
      currentWeekStart,
      currentWeekId,
      currentWeekTotalPay: Number(currentWeekStats.total_pay),
      currentWeekInvoices: Number(currentWeekStats.total_invoices),
      currentWeekTotalToPay: Number(currentWeekStats.total_to_pay),
      averagePayCurrentWeek: Number(currentWeekStats.avg_pay),
      totalPaidYtd: Number(yearStats.total_paid_ytd),
      recentWeeks,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks', async (req, res) => {
  const year = req.query.year || 2026;
  try {
    const [rows] = await pool.query(
      `SELECT pw.*,
        (SELECT COUNT(*) FROM timesheet_rows tr WHERE tr.payroll_week_id = pw.id) AS row_count,
        (SELECT COALESCE(SUM(total_to_pay), 0) FROM timesheet_rows tr WHERE tr.payroll_week_id = pw.id) AS total_payout
       FROM payroll_weeks pw
       WHERE YEAR(pw.week_start) = ?
       ORDER BY pw.week_start ASC`,
      [year]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/weeks/sync-2026', async (_req, res) => {
  try {
    const { ensureWeeks2026 } = await import('../db/ensureWeekRows.js');
    const count = await ensureWeeks2026();
    res.json({ ok: true, weeks: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks/by-date/:weekStart', async (req, res) => {
  try {
    let [weeks] = await pool.query('SELECT * FROM payroll_weeks WHERE week_start = ?', [req.params.weekStart]);
    if (!weeks.length) {
      const { ensureWeeks2026 } = await import('../db/ensureWeekRows.js');
      await ensureWeeks2026();
      [weeks] = await pool.query('SELECT * FROM payroll_weeks WHERE week_start = ?', [req.params.weekStart]);
    }
    if (!weeks.length) return res.status(404).json({ error: 'Week not found' });
    res.json(weeks[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks/:id', async (req, res) => {
  try {
    const [weeks] = await pool.query('SELECT * FROM payroll_weeks WHERE id = ?', [req.params.id]);
    if (!weeks.length) return res.status(404).json({ error: 'Week not found' });
    await ensureWeekRows(req.params.id);
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
    new_subcontractor_name,
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
    if (!employee_id && new_subcontractor_name?.trim()) {
      const name = new_subcontractor_name.trim();
      const [ins] = await pool.query(
        'INSERT INTO employees (full_name, default_hourly_rate, default_hst_applies) VALUES (?, ?, ?)',
        [name, hourly_rate ?? 0, hst_applies ? 1 : 0]
      );
      employee_id = ins.insertId;
    }

    const [maxSort] = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM timesheet_rows WHERE payroll_week_id = ?',
      [req.params.id]
    );

    let rate = hourly_rate ?? 0;
    let hst = hst_applies ? 1 : 0;
    if (employee_id) {
      const [emp] = await pool.query('SELECT * FROM employees WHERE id = ?', [employee_id]);
      if (!emp.length) return res.status(404).json({ error: 'Subcontractor not found' });
      rate = hourly_rate ?? emp[0].default_hourly_rate;
      hst = hst_applies !== undefined ? (hst_applies ? 1 : 0) : emp[0].default_hst_applies;
    }

    const draft = {
      hours_mon,
      hours_tue,
      hours_wed,
      hours_thu,
      hours_fri,
      hours_sat,
      hours_sun,
      hourly_rate: rate,
      hst_applies: hst,
      materials,
      gas_parking,
      extras,
      total_pay: use_manual_pay ? total_pay : undefined,
      use_manual_pay: use_manual_pay ? 1 : 0,
    };
    const calc = calcTimesheetRow(rowFromDb(draft));

    const [result] = await pool.query(
      `INSERT INTO timesheet_rows (
        payroll_week_id, employee_id, sort_order, hourly_rate,
        hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat, hours_sun,
        total_hours, hst_applies, total_pay, materials, gas_parking, extras, total_to_pay, use_manual_pay, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        employee_id || null,
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
        hst,
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
  try {
    const [rows] = await pool.query('SELECT * FROM timesheet_rows WHERE id = ? AND payroll_week_id = ?', [
      req.params.rowId,
      req.params.weekId,
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Row not found' });

    const merged = { ...rows[0], ...req.body, use_manual_pay: 0 };

    if (req.body.employee_id !== undefined) {
      const eid =
        req.body.employee_id === null || req.body.employee_id === '' ? null : Number(req.body.employee_id);
      merged.employee_id = eid;
      if (eid) {
        const [emp] = await pool.query('SELECT * FROM employees WHERE id = ?', [eid]);
        if (emp.length) {
          merged.hourly_rate = emp[0].default_hourly_rate;
          merged.hst_applies = emp[0].default_hst_applies ? 1 : 0;
        }
      }
    }

    if (req.body.hst_applies !== undefined) merged.hst_applies = req.body.hst_applies ? 1 : 0;

    const calc = calcTimesheetRow(rowFromDb(merged));

    await pool.query(
      `UPDATE timesheet_rows SET
        employee_id = ?, hourly_rate = ?, hours_mon = ?, hours_tue = ?, hours_wed = ?, hours_thu = ?,
        hours_fri = ?, hours_sat = ?, hours_sun = ?, hst_applies = ?, materials = ?, gas_parking = ?,
        extras = ?, notes = ?, total_hours = ?, total_pay = ?, total_to_pay = ?, use_manual_pay = 0
       WHERE id = ?`,
      [
        merged.employee_id,
        merged.hourly_rate,
        merged.hours_mon,
        merged.hours_tue,
        merged.hours_wed,
        merged.hours_thu,
        merged.hours_fri,
        merged.hours_sat,
        merged.hours_sun,
        merged.hst_applies,
        merged.materials ?? 0,
        merged.gas_parking ?? 0,
        merged.extras ?? 0,
        merged.notes ?? null,
        calc.total_hours,
        calc.total_pay,
        calc.total_to_pay,
        req.params.rowId,
      ]
    );

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
