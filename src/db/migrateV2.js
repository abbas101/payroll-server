import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { ensureWeeks2026 } from './ensureWeekRows.js';

dotenv.config();

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: 'payroll',
  });

  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await connection.query(
      'ALTER TABLE timesheet_rows MODIFY employee_id INT NULL'
    );
  } catch (e) {
    if (!e.message.includes('Duplicate')) console.warn(e.message);
  }
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');

  const count = await ensureWeeks2026(connection);
  console.log(`2026 weeks ready: ${count} weeks synced with subcontractor rows.`);

  await connection.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
