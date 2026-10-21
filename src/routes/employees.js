import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  const status = req.query.status;
  try {
    let sql = 'SELECT * FROM employees WHERE 1=1';
    const params = [];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY full_name';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Subcontractor not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { full_name, default_hourly_rate, default_hst_applies = true } = req.body;
  if (!full_name?.trim()) return res.status(400).json({ error: 'full_name is required' });
  try {
    const [result] = await pool.query(
      'INSERT INTO employees (full_name, default_hourly_rate, default_hst_applies) VALUES (?, ?, ?)',
      [full_name.trim(), default_hourly_rate ?? 0, default_hst_applies ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { full_name, default_hourly_rate, default_hst_applies, status } = req.body;
  try {
    await pool.query(
      `UPDATE employees SET full_name=?, default_hourly_rate=?, default_hst_applies=?, status=COALESCE(?, status) WHERE id=?`,
      [full_name, default_hourly_rate ?? 0, default_hst_applies ? 1 : 0, status, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE employees SET status = ? WHERE id = ?', ['inactive', req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
