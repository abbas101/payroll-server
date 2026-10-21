import mongoose from 'mongoose';
import { connectDb } from './connect.js';
import { ensureWeeks2026 } from './ensureWeekRows.js';

async function migrate() {
  await connectDb();
  const count = await ensureWeeks2026();
  console.log(`2026 weeks synced: ${count}`);
  await mongoose.disconnect();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
