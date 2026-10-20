import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { seedWeeklySheet } from './seedSheet.js';

dotenv.config();

async function seed() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: 'payroll',
  });
  const weekId = await seedWeeklySheet(connection);
  await connection.end();
  console.log(`Re-imported sheet into week id=${weekId}`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
