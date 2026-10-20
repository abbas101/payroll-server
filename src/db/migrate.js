import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const drops = [
  'payroll_items',
  'payroll_runs',
  'salary_structures',
  'timesheet_rows',
  'payroll_weeks',
  'employees',
  'departments',
];

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  await connection.query('CREATE DATABASE IF NOT EXISTS payroll CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await connection.query('USE payroll');

  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of drops) {
    await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('CREATE DATABASE') && !s.startsWith('USE payroll'));

  for (const stmt of statements) {
    await connection.query(stmt);
  }

  await connection.end();
  console.log('Migration complete (timesheet schema).');
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
