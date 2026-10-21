# payroll-server

Node.js + Express + **MongoDB** API for weekly payroll timesheets (CAD, HST).

## Setup

```bash
npm install
cp .env.example .env
# Set MONGODB_URI in .env
npm run db:seed
npm run dev
```

Optional: import legacy MySQL dump into MongoDB:

```bash
npm run db:import -- ../payroll.sql
```

Sync all 2026 Monday-start weeks:

```bash
npm run db:migrate
```

API: http://localhost:5000 — default login after seed: `admin` / `admin123`
