export const HST_RATE = 0.13;

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function sumHours(row) {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return round2(days.reduce((s, d) => s + (Number(row[d]) || 0), 0));
}

/** Labor pay: use sheet total_pay when manual, else rate × hours */
export function calcLaborPay(row) {
  if (row.use_manual_pay) return round2(row.total_pay);
  const hours = row.total_hours != null ? Number(row.total_hours) : sumHours(row);
  return round2(Number(row.hourly_rate) * hours);
}

/**
 * Ontario-style sheet logic:
 * - HST on (labor + materials + gas + extras) when hst_applies
 * - Some rows store labor with HST already in total_pay; use use_manual_pay to keep sheet values
 */
export function calcTimesheetRow(row) {
  const total_hours = sumHours(row);
  const labor = row.use_manual_pay ? round2(row.total_pay) : round2(Number(row.hourly_rate) * total_hours);
  const materials = Number(row.materials) || 0;
  const gas_parking = Number(row.gas_parking) || 0;
  const extras = Number(row.extras) || 0;
  const subtotal = labor + materials + gas_parking + extras;
  const hst = Boolean(row.hst_applies);
  const total_to_pay = hst ? round2(subtotal * (1 + HST_RATE)) : round2(subtotal);

  return {
    total_hours,
    total_pay: labor,
    total_to_pay,
  };
}

export function rowFromDb(r) {
  return {
    mon: r.hours_mon,
    tue: r.hours_tue,
    wed: r.hours_wed,
    thu: r.hours_thu,
    fri: r.hours_fri,
    sat: r.hours_sat,
    sun: r.hours_sun,
    hourly_rate: r.hourly_rate,
    hst_applies: Boolean(r.hst_applies),
    materials: r.materials,
    gas_parking: r.gas_parking,
    extras: r.extras,
    total_pay: r.total_pay,
    use_manual_pay: Boolean(r.use_manual_pay),
    total_hours: r.total_hours,
  };
}
