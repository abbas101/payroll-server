import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';
import { calcTimesheetRow, round2, sumHours } from '../utils/payrollCalc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEEK_START = '2026-10-05';
const WEEK_END = '2026-10-11';
const WEEK_TITLE = 'Mon 5th Oct – Sun 11th Oct';

function laborFromSheet(row) {
  const hours = Number(row.total_hrs) || sumHours(row);
  const computed = round2(Number(row.rate) * hours);
  const sheetPay = Number(row.total_pay) || 0;
  const useManual = Math.abs(sheetPay - computed) > 0.02 || hours === 0;
  return { hours, sheetPay, computed, useManual };
}

export async function seedWeeklySheet(connection) {
  const seedPath = path.join(__dirname, 'sheetSeed.json');
  const rows = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const [weeks] = await connection.query('SELECT id FROM payroll_weeks WHERE week_start = ?', [WEEK_START]);
  let weekId;
  if (weeks.length) {
    weekId = weeks[0].id;
    await connection.query('DELETE FROM timesheet_rows WHERE payroll_week_id = ?', [weekId]);
  } else {
    const [w] = await connection.query(
      'INSERT INTO payroll_weeks (week_start, week_end, title) VALUES (?, ?, ?)',
      [WEEK_START, WEEK_END, WEEK_TITLE]
    );
    weekId = w.insertId;
  }

  const employeeCache = new Map();
  let sort = 0;

  for (const row of rows) {
    let employeeId = employeeCache.get(row.name);
    if (!employeeId) {
      const [existing] = await connection.query('SELECT id FROM employees WHERE full_name = ? LIMIT 1', [row.name]);
      if (existing.length) {
        employeeId = existing[0].id;
      } else {
        const [ins] = await connection.query(
          'INSERT INTO employees (full_name, default_hourly_rate, default_hst_applies) VALUES (?, ?, ?)',
          [row.name, row.rate, row.hst ? 1 : 0]
        );
        employeeId = ins.insertId;
      }
      employeeCache.set(row.name, employeeId);
    }

    const { hours, sheetPay, computed, useManual } = laborFromSheet(row);
    const calcInput = {
      mon: row.mon,
      tue: row.tue,
      wed: row.wed,
      thu: row.thu,
      fri: row.fri,
      sat: row.sat,
      sun: row.sun,
      hourly_rate: row.rate,
      hst_applies: row.hst,
      materials: row.materials,
      gas_parking: row.gas_parking,
      extras: row.extras,
      total_pay: useManual ? sheetPay : computed,
      use_manual_pay: useManual,
    };
    const calc = calcTimesheetRow(calcInput);
    const totalToPay = Number(row.total_to_pay) || calc.total_to_pay;

    await connection.query(
      `INSERT INTO timesheet_rows (
        payroll_week_id, employee_id, sort_order, hourly_rate,
        hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat, hours_sun,
        total_hours, hst_applies, total_pay, materials, gas_parking, extras, total_to_pay, use_manual_pay, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        weekId,
        employeeId,
        sort++,
        row.rate,
        row.mon,
        row.tue,
        row.wed,
        row.thu,
        row.fri,
        row.sat,
        row.sun,
        hours,
        row.hst ? 1 : 0,
        useManual ? sheetPay : computed,
        row.materials,
        row.gas_parking,
        row.extras,
        totalToPay,
        useManual ? 1 : 0,
        row.notes || null,
      ]
    );
  }

  return weekId;
}
