import Employee from '../models/Employee.js';
import PayrollWeek from '../models/PayrollWeek.js';
import { getWeeks2026 } from './weeks2026.js';

const BLANK_ROWS = 8;

export async function ensureWeekRows(weekId) {
  const week = await PayrollWeek.findById(weekId);
  if (!week) return;

  const subs = await Employee.find().sort({ fullName: 1 });
  const existingEmpIds = new Set(
    week.entries.filter((e) => e.employeeId).map((e) => String(e.employeeId))
  );

  let sortOrder = week.entries.reduce((max, e) => Math.max(max, e.sortOrder), -1) + 1;

  for (const sub of subs) {
    if (existingEmpIds.has(sub._id.toString())) continue;
    week.entries.push({
      employeeId: sub._id,
      sortOrder: sortOrder++,
      hourlyRate: sub.defaultHourlyRate,
      hstApplies: sub.defaultHstApplies,
      hours: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    });
  }

  let blankCount = week.entries.filter((e) => !e.employeeId).length;
  while (blankCount < BLANK_ROWS) {
    week.entries.push({
      sortOrder: sortOrder++,
      hourlyRate: 0,
      hstApplies: true,
      hours: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    });
    blankCount++;
  }

  week.markModified('entries');
  await week.save();
}

export async function ensureWeeks2026() {
  const weeks = getWeeks2026();
  for (const w of weeks) {
    let week = await PayrollWeek.findOne({ weekStart: w.week_start });
    if (!week) {
      week = await PayrollWeek.create({
        weekStart: w.week_start,
        weekEnd: w.week_end,
        title: w.title,
        entries: [],
      });
    }
    await ensureWeekRows(week._id);
  }
  return weeks.length;
}
