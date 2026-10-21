import bcrypt from 'bcryptjs';
import { connectDb } from './connect.js';
import User from '../models/User.js';
import { ensureWeeks2026 } from './ensureWeekRows.js';
import mongoose from 'mongoose';

async function seed() {
  await connectDb();

  const existing = await User.findOne({ username: 'admin' });
  if (!existing) {
    const hash = await bcrypt.hash('admin123', 10);
    await User.create({
      username: 'admin',
      passwordHash: hash,
      fullName: 'Administrator',
      role: 'admin',
    });
    console.log('Default login: admin / admin123');
  }

  const count = await ensureWeeks2026();
  console.log(`2026 weeks ready: ${count} weeks with subcontractor rows.`);

  await mongoose.disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
