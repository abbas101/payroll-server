# payroll-server

Node.js + Express + MySQL API for weekly payroll timesheets (CAD, HST).

## Setup

```bash
npm install
cp .env.example .env
npm run db:init
npm run dev
```

API: http://localhost:5000

Default login user is created in DB init: `admin` / `admin123`
