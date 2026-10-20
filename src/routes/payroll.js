import { Router } from 'express';
import Employee from '../models/Employee.js';
import PayrollWeek, { applyCalc, entryToApi, entryToCalcRow, weekToApi } from '../models/PayrollWeek.js';
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

async function namesFor(entries) {
  const ids = [...new Set(entries.map((entry) => String(entry.employeeId)))];
  const employees = await Employee.find({ _id: { $in: ids } }).select('fullName');
  return new Map(employees.map((employee) => [employee._id.toString(), employee.fullName]));
}

function rowsApi(week, names) {
  return weekEntries(week).map((entry) =>
    entryToApi(entry, week._id, names.get(String(entry.employeeId)) || '')
  );
}

router.get('/dashboard', async (_req, res) => {
  try {
    const [total, active, weeks] = await Promise.all([
      Employee.countDocuments(),
      Employee.countDocuments({ status: 'active' }),
      PayrollWeek.find().sort({ weekStart: -1 }).limit(6),
    ]);
    res.json({
      employees: { total, active },
      recentWeeks: weeks.map((week) => ({ ...weekToApi(week), total_payout: payoutOf(week) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks', async (_req, res) => {
  try {
    const weeks = await PayrollWeek.find().sort({ weekStart: -1 });
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

router.post('/weeks', async (req, res) => {
  const { week_start, week_end, title } = req.body;
  if (!week_start || !week_end || !title) {
    return res.status(400).json({ error: 'week_start, week_end, and title are required' });
  }
  try {
    const week = await PayrollWeek.create({
      weekStart: String(week_start).slice(0, 10),
      weekEnd: String(week_end).slice(0, 10),
      title,
      entries: [],
    });
    res.status(201).json({ id: week._id.toString() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Week already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/weeks/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Week not found' });
  try {
    const week = await PayrollWeek.findById(req.params.id);
    if (!week) return res.status(404).json({ error: 'Week not found' });
    const names = await namesFor(week.entries);
    res.json({ week: weekToApi(week), rows: rowsApi(week, names) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/weeks/:id/rows', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Week not found' });

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
    const week = await PayrollWeek.findById(req.params.id);
    if (!week) return res.status(404).json({ error: 'Week not found' });

    if (!employee_id && new_worker_name?.trim()) {
      const created = await Employee.create({
        fullName: new_worker_name.trim(),
        defaultHourlyRate: hourly_rate ?? 0,
        defaultHstApplies: Boolean(hst_applies),
      });
      employee_id = created._id.toString();
    }
    if (!employee_id) return res.status(400).json({ error: 'employee_id or new_worker_name is required' });
    if (!isObjectId(String(employee_id))) return res.status(404).json({ error: 'Employee not found' });

    const employee = await Employee.findById(employee_id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const rate = hourly_rate ?? employee.defaultHourlyRate;
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
      hstApplies: Boolean(hst_applies),
      materials: num(materials),
      gasParking: num(gas_parking),
      extras: num(extras),
      totalPay: use_manual_pay ? num(total_pay) : undefined,
      useManualPay: Boolean(use_manual_pay),
    };
    const calc = calcTimesheetRow(rowFromDb(entryToCalcRow(draft)));
    const sortOrder = week.entries.reduce((max, entry) => Math.max(max, entry.sortOrder), -1) + 1;

    week.entries.push({
      employeeId: employee._id,
      sortOrder,
      hourlyRate: num(rate),
      hours: draft.hours,
      totalHours: calc.total_hours,
      hstApplies: Boolean(hst_applies),
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
    res.status(201).json(entryToApi(created, week._id, employee.fullName));
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
  if (!fields.some((field) => req.body[field] !== undefined)) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    const week = await PayrollWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: 'Row not found' });
    const entry = week.entries.id(req.params.rowId);
    if (!entry) return res.status(404).json({ error: 'Row not found' });

    const body = req.body;
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
    if (body.total_pay !== undefined) entry.totalPay = num(body.total_pay);
    if (body.use_manual_pay !== undefined) entry.useManualPay = Boolean(body.use_manual_pay);
    if (body.notes !== undefined) entry.notes = body.notes || null;

    applyCalc(entry, calcTimesheetRow(rowFromDb(entryToCalcRow(entry))));
    week.markModified('entries');
    await week.save();

    const employee = await Employee.findById(entry.employeeId).select('fullName');
    res.json(entryToApi(entry, week._id, employee?.fullName || ''));
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
