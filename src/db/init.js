import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { seedWeeklySheet } from './seedSheet.js';
import { ensureWeeks2026 } from './ensureWeekRows.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function init() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  const drops = [
    'payroll_items',
    'payroll_runs',
    'salary_structures',
    'timesheet_rows',
    'payroll_weeks',
    'employees',
    'departments',
  ];

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

  const [existing] = await connection.query('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!existing.length) {
    const hash = await bcrypt.hash('admin123', 10);
    await connection.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      ['admin', hash, 'Administrator', 'admin']
    );
    console.log('Default login: admin / admin123');
  }

  const weekCount = await ensureWeeks2026(connection);
  console.log(`Created ${weekCount} weeks for 2026 with subcontractor rows`);

  const weekId = await seedWeeklySheet(connection);
  console.log(`Imported sample sheet week id=${weekId} (Mon 5 Oct – Sun 11 Oct 2026)`);

  await connection.end();
  console.log('Database initialized: payroll');
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
