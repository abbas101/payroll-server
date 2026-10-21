import { connectDb } from './db/connect.js';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRouter from './routes/auth.js';
import employeesRouter from './routes/employees.js';
import payrollRouter from './routes/payroll.js';
import { requireAuth } from './middleware/auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/employees', requireAuth, employeesRouter);
app.use('/api/subcontractors', requireAuth, employeesRouter);
app.use('/api/payroll', requireAuth, payrollRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Payroll API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
