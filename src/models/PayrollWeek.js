import mongoose from 'mongoose';

const entrySchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    hourlyRate: { type: Number, required: true, default: 0 },
    hours: {
      mon: { type: Number, default: 0 },
      tue: { type: Number, default: 0 },
      wed: { type: Number, default: 0 },
      thu: { type: Number, default: 0 },
      fri: { type: Number, default: 0 },
      sat: { type: Number, default: 0 },
      sun: { type: Number, default: 0 },
    },
    totalHours: { type: Number, required: true, default: 0 },
    hstApplies: { type: Boolean, required: true, default: true },
    totalPay: { type: Number, required: true, default: 0 },
    materials: { type: Number, required: true, default: 0 },
    gasParking: { type: Number, required: true, default: 0 },
    extras: { type: Number, required: true, default: 0 },
    totalToPay: { type: Number, required: true, default: 0 },
    useManualPay: { type: Boolean, required: true, default: false },
    useManualToPay: { type: Boolean, required: true, default: false },
    notes: { type: String, default: null },
  },
  { _id: true }
);

const payrollWeekSchema = new mongoose.Schema(
  {
    weekStart: { type: String, required: true, unique: true },
    weekEnd: { type: String, required: true },
    title: { type: String, required: true },
    entries: { type: [entrySchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'payrollWeeks' }
);

export function weekToApi(week) {
  return {
    id: week._id.toString(),
    week_start: week.weekStart,
    week_end: week.weekEnd,
    title: week.title,
    created_at: week.createdAt,
  };
}

export function entryToApi(entry, weekId, employeeMeta) {
  const hours = entry.hours || {};
  const fullName = typeof employeeMeta === 'string' ? employeeMeta : employeeMeta?.fullName || '';
  const subcontractorStatus =
    typeof employeeMeta === 'object' && employeeMeta ? employeeMeta.status : null;
  return {
    id: entry._id.toString(),
    payroll_week_id: String(weekId),
    employee_id: entry.employeeId ? String(entry.employeeId) : null,
    sort_order: entry.sortOrder,
    hourly_rate: entry.hourlyRate,
    hours_mon: hours.mon ?? 0,
    hours_tue: hours.tue ?? 0,
    hours_wed: hours.wed ?? 0,
    hours_thu: hours.thu ?? 0,
    hours_fri: hours.fri ?? 0,
    hours_sat: hours.sat ?? 0,
    hours_sun: hours.sun ?? 0,
    total_hours: entry.totalHours,
    hst_applies: Boolean(entry.hstApplies),
    total_pay: entry.totalPay,
    materials: entry.materials,
    gas_parking: entry.gasParking,
    extras: entry.extras,
    total_to_pay: entry.totalToPay,
    use_manual_pay: Boolean(entry.useManualPay),
    use_manual_to_pay: Boolean(entry.useManualToPay),
    notes: entry.notes ?? null,
    full_name: fullName ?? '',
    subcontractor_status: subcontractorStatus,
  };
}

export function entryToCalcRow(entry) {
  const hours = entry.hours || {};
  return {
    hours_mon: hours.mon ?? 0,
    hours_tue: hours.tue ?? 0,
    hours_wed: hours.wed ?? 0,
    hours_thu: hours.thu ?? 0,
    hours_fri: hours.fri ?? 0,
    hours_sat: hours.sat ?? 0,
    hours_sun: hours.sun ?? 0,
    hourly_rate: entry.hourlyRate,
    hst_applies: entry.hstApplies,
    materials: entry.materials,
    gas_parking: entry.gasParking,
    extras: entry.extras,
    total_pay: entry.totalPay,
    use_manual_pay: entry.useManualPay,
    use_manual_to_pay: entry.useManualToPay,
    total_to_pay: entry.totalToPay,
    total_hours: entry.totalHours,
  };
}

export function applyCalc(entry, calc) {
  entry.totalHours = calc.total_hours;
  entry.totalPay = calc.total_pay;
  entry.totalToPay = calc.total_to_pay;
}

export default mongoose.model('PayrollWeek', payrollWeekSchema);
