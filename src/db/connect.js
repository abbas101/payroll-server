import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

dotenv.config({ path: path.join(serverRoot, '.env') });
dotenv.config({ path: path.join(serverRoot, 'env') });

export function mongoUri() {
  return process.env.MONGODB_URI?.trim() || '';
}

export async function connectDb() {
  const uri = mongoUri();
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Add it to server/env or server/.env');
  }

  if (uri.startsWith('mongodb+srv://')) {
    const servers = process.env.MONGODB_DNS_SERVERS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (servers?.length) dns.setServers(servers);
    else dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    dbName: process.env.MONGODB_DB?.trim() || undefined,
  });

  const { name } = mongoose.connection;
  console.log(`MongoDB connected (database: ${name})`);
  return mongoose.connection;
}
