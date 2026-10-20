import { Router } from 'express';
import Employee from '../models/Employee.js';
import { isObjectId } from '../utils/ids.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const rows = await Employee.find(filter).sort({ fullName: 1 });
    res.json(rows.map((row) => row.toApi()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Employee not found' });
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json(employee.toApi());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { full_name, default_hourly_rate, default_hst_applies = true } = req.body;
  if (!full_name?.trim()) return res.status(400).json({ error: 'full_name is required' });
  try {
    const employee = await Employee.create({
      fullName: full_name.trim(),
      defaultHourlyRate: default_hourly_rate ?? 0,
      defaultHstApplies: Boolean(default_hst_applies),
    });
    res.status(201).json({ id: employee._id.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Employee not found' });
  const { full_name, default_hourly_rate, default_hst_applies, status } = req.body;
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    employee.fullName = full_name;
    employee.defaultHourlyRate = default_hourly_rate ?? 0;
    employee.defaultHstApplies = Boolean(default_hst_applies);
    if (status) employee.status = status;
    await employee.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Employee not found' });
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    employee.status = 'inactive';
    await employee.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
