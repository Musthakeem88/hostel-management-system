CREATE TABLE IF NOT EXISTS rooms (
  block VARCHAR(10) NOT NULL, floor INTEGER NOT NULL, room_number INTEGER NOT NULL,
  capacity INTEGER NOT NULL, occupied INTEGER NOT NULL DEFAULT 0,
  under_maintenance BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (block, floor, room_number));
--#
CREATE TABLE IF NOT EXISTS students (
  student_id SERIAL PRIMARY KEY, student_number VARCHAR(30) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL, email VARCHAR(150) NOT NULL UNIQUE, phone VARCHAR(30),
  room_block VARCHAR(10) NOT NULL, room_floor INTEGER NOT NULL, room_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS inspections (
  inspection_id SERIAL PRIMARY KEY, room_block VARCHAR(10) NOT NULL, room_floor INTEGER NOT NULL,
  room_number INTEGER NOT NULL, student_number VARCHAR(30) NOT NULL, inspection_type VARCHAR(20) NOT NULL,
  inspection_items JSONB NOT NULL DEFAULT '[]', inspection_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS damage_reports (
  damage_id SERIAL PRIMARY KEY, report_number VARCHAR(20) NOT NULL UNIQUE, room_block VARCHAR(10) NOT NULL,
  room_floor INTEGER NOT NULL, room_number INTEGER NOT NULL, item_name VARCHAR(80) NOT NULL,
  student_number VARCHAR(30) NOT NULL, description TEXT NOT NULL, fine_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  fine_status VARCHAR(20) NOT NULL DEFAULT 'Pending', dispute_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS repair_requests (
  repair_id SERIAL PRIMARY KEY, request_number VARCHAR(20) NOT NULL UNIQUE, room_block VARCHAR(10) NOT NULL,
  room_floor INTEGER NOT NULL, room_number INTEGER NOT NULL, item_name VARCHAR(80) NOT NULL,
  description TEXT NOT NULL, priority VARCHAR(10) NOT NULL DEFAULT 'Normal',
  repair_status VARCHAR(20) NOT NULL DEFAULT 'Reported', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS maintenance_requests (
  maintenance_id SERIAL PRIMARY KEY, room_block VARCHAR(10) NOT NULL, room_floor INTEGER NOT NULL,
  room_number INTEGER NOT NULL, maintenance_type VARCHAR(20) NOT NULL, description TEXT NOT NULL,
  assigned_staff VARCHAR(100), status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  reported_date DATE NOT NULL DEFAULT CURRENT_DATE, expected_completion_date DATE, completed_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS room_type VARCHAR(30) DEFAULT 'Standard';
--#
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(120);
--#
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(30);
--#
ALTER TABLE students ADD COLUMN IF NOT EXISTS faculty VARCHAR(120);
--#
ALTER TABLE students ADD COLUMN IF NOT EXISTS hostel VARCHAR(30);
--#
ALTER TABLE students ADD COLUMN IF NOT EXISTS check_in_date DATE;
--#
ALTER TABLE students ADD COLUMN IF NOT EXISTS check_out_date DATE;
--#
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_status VARCHAR(20) DEFAULT 'Active';
--#
ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id INTEGER;
--#
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS inspector_user_id INTEGER;
--#
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS inspector_name VARCHAR(120);
--#
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(20);
--#
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS student_confirmed_at TIMESTAMPTZ;
--#
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS student_comment TEXT;
--#
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS general_notes TEXT;
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS damage_type VARCHAR(30);
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS repair_cost NUMERIC(10,2) DEFAULT 0;
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS replacement_cost NUMERIC(10,2) DEFAULT 0;
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS damage_status VARCHAR(20) DEFAULT 'Reported';
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS property_id INTEGER;
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS inspection_id INTEGER;
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS reported_by INTEGER;
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS reported_by_name VARCHAR(120);
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS confirmed_by INTEGER;
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
--#
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS review_note TEXT;
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER;
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS assigned_name VARCHAR(120);
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS reported_by INTEGER;
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS student_number VARCHAR(30);
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS property_id INTEGER;
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS repair_cost NUMERIC(10,2) DEFAULT 0;
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS resolution_note TEXT;
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
--#
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
--#
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER;
--#
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS created_by INTEGER;
--#
UPDATE damage_reports SET damage_status = 'Confirmed' WHERE fine_status IN ('Approved', 'Paid') AND (damage_status IS NULL OR damage_status = 'Reported');
--#
--optional
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
           WHERE rel.relname = 'damage_reports' AND con.contype = 'c'
             AND pg_get_constraintdef(con.oid) ILIKE '%fine_status%'
  LOOP
    EXECUTE format('ALTER TABLE damage_reports DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
--#
--optional
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
           WHERE rel.relname = 'repair_requests' AND con.contype = 'c'
             AND pg_get_constraintdef(con.oid) ILIKE '%priority%'
  LOOP
    EXECUTE format('ALTER TABLE repair_requests DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
