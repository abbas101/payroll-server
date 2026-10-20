function extractInsertBody(sql, table) {
  const marker = `INSERT INTO \`${table}\``;
  const start = sql.indexOf(marker);
  if (start === -1) throw new Error(`No INSERT for ${table}`);
  const valuesAt = sql.indexOf('VALUES', start);
  if (valuesAt === -1) throw new Error(`No VALUES for ${table}`);
  const end = sql.indexOf(';', valuesAt);
  if (end === -1) throw new Error(`Unclosed INSERT for ${table}`);
  return sql.slice(valuesAt + 'VALUES'.length, end);
}

export function parseTuples(valuesSql) {
  const rows = [];
  const s = valuesSql;
  let i = 0;

  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i += 1;
    if (i >= s.length) break;
    if (s[i] !== '(') throw new Error(`Expected ( near offset ${i}`);
    i += 1;
    const values = [];

    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i += 1;
      if (s[i] === ')') {
        i += 1;
        break;
      }

      if (s.startsWith('NULL', i) && (i + 4 >= s.length || /[\s,)]/.test(s[i + 4]))) {
        values.push(null);
        i += 4;
      } else if (s[i] === "'") {
        i += 1;
        let str = '';
        while (i < s.length) {
          if (s[i] === '\\') {
            str += s[i + 1] ?? '';
            i += 2;
            continue;
          }
          if (s[i] === "'") {
            if (s[i + 1] === "'") {
              str += "'";
              i += 2;
              continue;
            }
            i += 1;
            break;
          }
          str += s[i];
          i += 1;
        }
        values.push(str);
      } else {
        let raw = '';
        while (i < s.length && s[i] !== ',' && s[i] !== ')') {
          raw += s[i];
          i += 1;
        }
        const trimmed = raw.trim();
        if (trimmed === '') throw new Error(`Empty SQL value near offset ${i}`);
        values.push(Number(trimmed));
      }

      while (i < s.length && /\s/.test(s[i])) i += 1;
      if (s[i] === ',') i += 1;
    }

    rows.push(values);
  }

  return rows;
}

function rowsFor(sql, table, width) {
  const tuples = parseTuples(extractInsertBody(sql, table));
  for (const row of tuples) {
    if (row.length !== width) {
      throw new Error(`${table} row has ${row.length} columns, expected ${width}`);
    }
  }
  return tuples;
}

function asDate(value) {
  if (!value) return new Date();
  return new Date(String(value).replace(' ', 'T') + 'Z');
}

export function parsePayrollDump(sql) {
  const users = rowsFor(sql, 'users', 6).map((r) => ({
    legacyId: r[0],
    username: r[1],
    passwordHash: r[2],
    fullName: r[3] || '',
    role: r[4] || 'admin',
    createdAt: asDate(r[5]),
  }));

  const employees = rowsFor(sql, 'employees', 6).map((r) => ({
    legacyId: r[0],
    fullName: r[1],
    defaultHourlyRate: r[2],
    defaultHstApplies: Boolean(r[3]),
    status: r[4] || 'active',
    createdAt: asDate(r[5]),
  }));

  const weeks = rowsFor(sql, 'payroll_weeks', 5).map((r) => ({
    legacyId: r[0],
    weekStart: String(r[1]).slice(0, 10),
    weekEnd: String(r[2]).slice(0, 10),
    title: r[3],
    createdAt: asDate(r[4]),
  }));

  const rows = rowsFor(sql, 'timesheet_rows', 21).map((r) => ({
    legacyId: r[0],
    weekLegacyId: r[1],
    employeeLegacyId: r[2],
    sortOrder: r[3],
    hourlyRate: r[4],
    hours: {
      mon: r[5],
      tue: r[6],
      wed: r[7],
      thu: r[8],
      fri: r[9],
      sat: r[10],
      sun: r[11],
    },
    totalHours: r[12],
    hstApplies: Boolean(r[13]),
    totalPay: r[14],
    materials: r[15],
    gasParking: r[16],
    extras: r[17],
    totalToPay: r[18],
    useManualPay: Boolean(r[19]),
    notes: r[20],
  }));

  return { users, employees, weeks, rows };
}
