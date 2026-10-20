CREATE DATABASE IF NOT EXISTS payroll CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE payroll;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  role ENUM('admin', 'user') DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  default_hourly_rate DECIMAL(10, 2) NOT NULL DEFAULT 0,
  default_hst_applies TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_employee_name (full_name)
);

CREATE TABLE IF NOT EXISTS payroll_weeks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  title VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_week_start (week_start)
);

CREATE TABLE IF NOT EXISTS timesheet_rows (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payroll_week_id INT NOT NULL,
  employee_id INT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  hourly_rate DECIMAL(10, 2) NOT NULL DEFAULT 0,
  hours_mon DECIMAL(5, 2) NOT NULL DEFAULT 0,
  hours_tue DECIMAL(5, 2) NOT NULL DEFAULT 0,
  hours_wed DECIMAL(5, 2) NOT NULL DEFAULT 0,
  hours_thu DECIMAL(5, 2) NOT NULL DEFAULT 0,
  hours_fri DECIMAL(5, 2) NOT NULL DEFAULT 0,
  hours_sat DECIMAL(5, 2) NOT NULL DEFAULT 0,
  hours_sun DECIMAL(5, 2) NOT NULL DEFAULT 0,
  total_hours DECIMAL(6, 2) NOT NULL DEFAULT 0,
  hst_applies TINYINT(1) NOT NULL DEFAULT 1,
  total_pay DECIMAL(12, 2) NOT NULL DEFAULT 0,
  materials DECIMAL(12, 2) NOT NULL DEFAULT 0,
  gas_parking DECIMAL(12, 2) NOT NULL DEFAULT 0,
  extras DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total_to_pay DECIMAL(12, 2) NOT NULL DEFAULT 0,
  use_manual_pay TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (payroll_week_id) REFERENCES payroll_weeks(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
