import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import mongoose from 'mongoose';
import { connectDb } from './connect.js';
import { parsePayrollDump } from './parseSqlDump.js';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import PayrollWeek from '../models/PayrollWeek.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function dumpPath() {
  const arg = process.argv.find((a) => a.endsWith('.sql'));
  return path.resolve(arg || path.join(serverRoot, '..', 'payroll.sql'));
}

export async function importDump(sql, { replace = true } = {}) {
  const dump = parsePayrollDump(sql);
  if (!dump.users.length || !dump.employees.length || !dump.weeks.length) {
    throw new Error('SQL dump did not contain users, employees, and payroll weeks');
  }

  if (replace) {
    await Promise.all([User.deleteMany({}), Employee.deleteMany({}), PayrollWeek.deleteMany({})]);
  }

  await User.insertMany(
    dump.users.map((u) => ({
      username: u.username,
      passwordHash: u.passwordHash,
      fullName: u.fullName,
      role: u.role,
      createdAt: u.createdAt,
    }))
  );

  const employeeIds = new Map();
  for (const employee of dump.employees) {
    const doc = await Employee.create({
      fullName: employee.fullName,
      defaultHourlyRate: employee.defaultHourlyRate,
      defaultHstApplies: employee.defaultHstApplies,
      status: employee.status,
      createdAt: employee.createdAt,
    });
    employeeIds.set(employee.legacyId, doc._id);
  }

  const rowsByWeek = new Map();
  for (const row of dump.rows) {
    const list = rowsByWeek.get(row.weekLegacyId) || [];
    list.push(row);
    rowsByWeek.set(row.weekLegacyId, list);
  }

  let entryCount = 0;
  for (const week of dump.weeks) {
    const entries = (rowsByWeek.get(week.legacyId) || [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => {
        const employeeId = employeeIds.get(row.employeeLegacyId);
        if (!employeeId) {
          throw new Error(`Timesheet row ${row.legacyId} points at missing employee ${row.employeeLegacyId}`);
        }
        entryCount += 1;
        return {
          employeeId,
          sortOrder: row.sortOrder,
          hourlyRate: row.hourlyRate,
          hours: row.hours,
          totalHours: row.totalHours,
          hstApplies: row.hstApplies,
          totalPay: row.totalPay,
          materials: row.materials,
          gasParking: row.gasParking,
          extras: row.extras,
          totalToPay: row.totalToPay,
          useManualPay: row.useManualPay,
          notes: row.notes,
        };
      });

    await PayrollWeek.create({
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      title: week.title,
      createdAt: week.createdAt,
      entries,
    });
  }

  return {
    users: dump.users.length,
    employees: dump.employees.length,
    weeks: dump.weeks.length,
    entries: entryCount,
  };
}

const dryRun = process.argv.includes('--dry-run');
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const file = dumpPath();
  const sql = fs.readFileSync(file, 'utf8');

  if (dryRun) {
    const dump = parsePayrollDump(sql);
    const payout = dump.rows.reduce((sum, row) => sum + row.totalToPay, 0);
    console.log(
      `Parsed ${path.basename(file)}: ${dump.users.length} users, ${dump.employees.length} employees, ${dump.weeks.length} weeks, ${dump.rows.length} entries, payout ${payout.toFixed(2)}`
    );
    process.exit(0);
  }

  connectDb()
    .then(() => importDump(sql))
    .then((summary) => {
      console.log(
        `Imported ${summary.users} users, ${summary.employees} employees, ${summary.weeks} weeks, ${summary.entries} timesheet entries`
      );
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });
}
