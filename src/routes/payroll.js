import { Router } from 'express';
import Employee from '../models/Employee.js';
import PayrollWeek, {
  applyCalc,
  entryToApi,
  entryToCalcRow,
  weekToApi,
} from '../models/PayrollWeek.js';
import { ensureWeekRows, ensureWeeks2026 } from '../db/ensureWeekRows.js';
import { findCurrentWeekStart } from '../db/weeks2026.js';
import { calcTimesheetRow, rowFromDb } from '../utils/payrollCalc.js';
import { isObjectId } from '../utils/ids.js';

const router = Router();
const num = (v) => (v == null || v === '' ? 0 : Number(v));

function weekEntries(week) {
  return [...week.entries].sort((a, b) => a.sortOrder - b.sortOrder || String(a._id).localeCompare(String(b._id)));
}

function payoutOf(week) {
  return week.entries.reduce((sum, entry) => sum + (Number(entry.totalToPay) || 0), 0);
}

async function employeeMapFor(entries) {
  const ids = [...new Set(entries.filter((e) => e.employeeId).map((e) => String(e.employeeId)))];
  const employees = await Employee.find({ _id: { $in: ids } }).select('fullName status');
  return new Map(
    employees.map((e) => [e._id.toString(), { fullName: e.fullName, status: e.status }])
  );
}

function rowsApi(week, empMap) {
  return weekEntries(week).map((entry) => {
    const meta = entry.employeeId ? empMap.get(String(entry.employeeId)) : null;
    return entryToApi(entry, week._id, meta || '');
  });
}

function statsForWeek(week) {
  let total_pay = 0;
  let total_invoices = 0;
  let total_to_pay = 0;
  for (const entry of week.entries) {
    total_pay += Number(entry.totalPay) || 0;
    total_to_pay += Number(entry.totalToPay) || 0;
    if (entry.hstApplies) total_invoices += Number(entry.totalToPay) || 0;
  }
  const row_count = week.entries.length;
  const avg_pay = row_count ? total_to_pay / row_count : 0;
  return { total_pay, total_invoices, total_to_pay, avg_pay, row_count };
}

router.get('/dashboard', async (_req, res) => {
  try {
    const currentWeekStart = findCurrentWeekStart();
    const year = String(new Date().getFullYear());

    const [total, active] = await Promise.all([
      Employee.countDocuments(),
      Employee.countDocuments({ status: 'active' }),
    ]);

    let currentWeek = await PayrollWeek.findOne({ weekStart: currentWeekStart });
    if (!currentWeek) {
      await ensureWeeks2026();
      currentWeek = await PayrollWeek.findOne({ weekStart: currentWeekStart });
    }

    let currentWeekStats = { total_pay: 0, total_invoices: 0, total_to_pay: 0, avg_pay: 0 };
    if (currentWeek) {
      currentWeekStats = statsForWeek(currentWeek);
    }

    const weeksYtd = await PayrollWeek.find({
      weekStart: { $gte: `${year}-01-01`, $lte: currentWeekStart },
    });
    const totalPaidYtd = weeksYtd.reduce((sum, w) => sum + payoutOf(w), 0);

    const recentWeeks = await PayrollWeek.find().sort({ weekStart: -1 }).limit(8);

    res.json({
      activeSubcontractors: active,
      totalSubcontractors: total,
      currentWeekStart,
      currentWeekId: currentWeek?._id?.toString() ?? null,
      currentWeekTotalPay: currentWeekStats.total_pay,
      currentWeekInvoices: currentWeekStats.total_invoices,
      currentWeekTotalToPay: currentWeekStats.total_to_pay,
      averagePayCurrentWeek: currentWeekStats.avg_pay,
      totalPaidYtd,
      recentWeeks: recentWeeks.map((w) => ({ ...weekToApi(w), total_payout: payoutOf(w) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks', async (req, res) => {
  const year = String(req.query.year || 2026);
  try {
    const weeks = await PayrollWeek.find({ weekStart: { $regex: `^${year}-` } }).sort({ weekStart: 1 });
    res.json(
      weeks.map((week) => ({
        ...weekToApi(week),
        row_count: week.entries.length,
        total_payout: payoutOf(week),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/weeks/sync-2026', async (_req, res) => {
  try {
    const count = await ensureWeeks2026();
    res.json({ ok: true, weeks: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks/by-date/:weekStart', async (req, res) => {
  try {
    let week = await PayrollWeek.findOne({ weekStart: req.params.weekStart.slice(0, 10) });
    if (!week) {
      await ensureWeeks2026();
      week = await PayrollWeek.findOne({ weekStart: req.params.weekStart.slice(0, 10) });
    }
    if (!week) return res.status(404).json({ error: 'Week not found' });
    res.json(weekToApi(week));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Week not found' });
  try {
    const week = await PayrollWeek.findById(req.params.id);
    if (!week) return res.status(404).json({ error: 'Week not found' });
    await ensureWeekRows(week._id);
    const refreshed = await PayrollWeek.findById(req.params.id);
    const empMap = await employeeMapFor(refreshed.entries);
    res.json({ week: weekToApi(refreshed), rows: rowsApi(refreshed, empMap) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/weeks/:id/rows', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Week not found' });

  let {
    employee_id,
    new_subcontractor_name,
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

  const newName = new_subcontractor_name || new_worker_name;

  try {
    const week = await PayrollWeek.findById(req.params.id);
    if (!week) return res.status(404).json({ error: 'Week not found' });

    if (!employee_id && newName?.trim()) {
      const created = await Employee.create({
        fullName: newName.trim(),
        defaultHourlyRate: hourly_rate ?? 0,
        defaultHstApplies: Boolean(hst_applies),
      });
      employee_id = created._id.toString();
    }

    let rate = num(hourly_rate);
    let hst = Boolean(hst_applies);
    let employee = null;

    if (employee_id) {
      if (!isObjectId(String(employee_id))) return res.status(404).json({ error: 'Subcontractor not found' });
      employee = await Employee.findById(employee_id);
      if (!employee) return res.status(404).json({ error: 'Subcontractor not found' });
      rate = hourly_rate ?? employee.defaultHourlyRate;
      hst = hst_applies !== undefined ? Boolean(hst_applies) : employee.defaultHstApplies;
    }

    const draft = {
      hours: {
        mon: num(hours_mon),
        tue: num(hours_tue),
        wed: num(hours_wed),
        thu: num(hours_thu),
        fri: num(hours_fri),
        sat: num(hours_sat),
        sun: num(hours_sun),
      },
      hourlyRate: num(rate),
      hstApplies: hst,
      materials: num(materials),
      gasParking: num(gas_parking),
      extras: num(extras),
      totalPay: use_manual_pay ? num(total_pay) : undefined,
      useManualPay: Boolean(use_manual_pay),
    };
    const calc = calcTimesheetRow(rowFromDb(entryToCalcRow(draft)));
    const sortOrder = week.entries.reduce((max, entry) => Math.max(max, entry.sortOrder), -1) + 1;

    week.entries.push({
      employeeId: employee?._id ?? null,
      sortOrder,
      hourlyRate: num(rate),
      hours: draft.hours,
      totalHours: calc.total_hours,
      hstApplies: hst,
      totalPay: calc.total_pay,
      materials: num(materials),
      gasParking: num(gas_parking),
      extras: num(extras),
      totalToPay: calc.total_to_pay,
      useManualPay: Boolean(use_manual_pay),
      notes: notes || null,
    });
    await week.save();

    const created = week.entries[week.entries.length - 1];
    const meta = employee ? { fullName: employee.fullName, status: employee.status } : '';
    res.status(201).json(entryToApi(created, week._id, meta));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/weeks/:weekId/rows/:rowId', async (req, res) => {
  if (!isObjectId(req.params.weekId) || !isObjectId(req.params.rowId)) {
    return res.status(404).json({ error: 'Row not found' });
  }
  try {
    const week = await PayrollWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: 'Row not found' });
    const entry = week.entries.id(req.params.rowId);
    if (!entry) return res.status(404).json({ error: 'Row not found' });
    week.entries.pull(req.params.rowId);
    await week.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/weeks/:weekId/rows/:rowId', async (req, res) => {
  if (!isObjectId(req.params.weekId) || !isObjectId(req.params.rowId)) {
    return res.status(404).json({ error: 'Row not found' });
  }

  try {
    const week = await PayrollWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: 'Row not found' });
    const entry = week.entries.id(req.params.rowId);
    if (!entry) return res.status(404).json({ error: 'Row not found' });

    const body = req.body;

    if (body.employee_id !== undefined) {
      const eid =
        body.employee_id === null || body.employee_id === '' ? null : String(body.employee_id);
      if (eid && !isObjectId(eid)) return res.status(404).json({ error: 'Subcontractor not found' });
      entry.employeeId = eid || undefined;
      if (eid) {
        const employee = await Employee.findById(eid);
        if (employee) {
          entry.hourlyRate = employee.defaultHourlyRate;
          entry.hstApplies = employee.defaultHstApplies;
        }
      }
    }

    if (body.hourly_rate !== undefined) entry.hourlyRate = num(body.hourly_rate);
    if (body.hours_mon !== undefined) entry.hours.mon = num(body.hours_mon);
    if (body.hours_tue !== undefined) entry.hours.tue = num(body.hours_tue);
    if (body.hours_wed !== undefined) entry.hours.wed = num(body.hours_wed);
    if (body.hours_thu !== undefined) entry.hours.thu = num(body.hours_thu);
    if (body.hours_fri !== undefined) entry.hours.fri = num(body.hours_fri);
    if (body.hours_sat !== undefined) entry.hours.sat = num(body.hours_sat);
    if (body.hours_sun !== undefined) entry.hours.sun = num(body.hours_sun);
    if (body.hst_applies !== undefined) entry.hstApplies = Boolean(body.hst_applies);
    if (body.materials !== undefined) entry.materials = num(body.materials);
    if (body.gas_parking !== undefined) entry.gasParking = num(body.gas_parking);
    if (body.extras !== undefined) entry.extras = num(body.extras);
    if (body.notes !== undefined) entry.notes = body.notes || null;

    if (body.use_manual_pay !== undefined) {
      entry.useManualPay = Boolean(body.use_manual_pay);
    }
    if (body.total_pay !== undefined) {
      if (body.use_manual_pay === false) {
        entry.useManualPay = false;
      } else if (body.total_pay !== '' && body.total_pay !== null) {
        entry.useManualPay = true;
        entry.totalPay = num(body.total_pay);
      }
    }

    applyCalc(entry, calcTimesheetRow(rowFromDb(entryToCalcRow(entry))));
    week.markModified('entries');
    await week.save();

    let meta = '';
    if (entry.employeeId) {
      const employee = await Employee.findById(entry.employeeId).select('fullName status');
      if (employee) meta = { fullName: employee.fullName, status: employee.status };
    }
    res.json(entryToApi(entry, week._id, meta));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/weeks/:id/recalculate', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Week not found' });
  try {
    const week = await PayrollWeek.findById(req.params.id);
    if (!week) return res.status(404).json({ error: 'Week not found' });
    for (const entry of week.entries) {
      applyCalc(entry, calcTimesheetRow(rowFromDb(entryToCalcRow(entry))));
    }
    week.markModified('entries');
    await week.save();
    res.json({ ok: true, rows: week.entries.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
