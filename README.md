# payroll-server

Node.js + Express + MongoDB API for weekly payroll timesheets (CAD, HST).

Timesheet lines live inside each payroll week document. Workers and login users are their own collections.

## Setup

```bash
npm install
```

Put your connection string in `env` or `.env`:

```
MONGODB_URI=mongodb+srv://...
```

Import the MySQL dump, then start the API:

```bash
npm run db:import
npm run dev
```

`db:import` reads `../payroll.sql`, replaces the `users`, `employees`, and `payrollWeeks` collections, and keeps the stored pay figures from that dump.

API: http://localhost:5000

Default login from the dump: `admin` / `admin123`
