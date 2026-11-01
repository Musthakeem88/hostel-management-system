-- =====================================================================
-- Hostel Management System - PostgreSQL schema
--
-- This file is generated from backend/migrations/*.sql (the real source of truth).
-- You normally do NOT need to run it: the server applies the migrations itself
-- when it starts (npm start). Use it to create the tables by hand if you prefer:
--
--     createdb hostel_management
--     psql -d hostel_management -f database/schema.sql
--
-- Every statement is idempotent (IF NOT EXISTS), so running it and then
-- starting the server is safe.
-- =====================================================================

-- ---------- 001_base.sql ----------
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

-- ---------- 002_features.sql ----------
CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY, username VARCHAR(60) NOT NULL UNIQUE, full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150), phone VARCHAR(30), role VARCHAR(20) NOT NULL, password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Active', student_number VARCHAR(30),
  must_change_password INTEGER NOT NULL DEFAULT 0, last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS staff (
  staff_id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, staff_number VARCHAR(30),
  position VARCHAR(80), hostel VARCHAR(30), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(60) PRIMARY KEY, setting_value TEXT);
--#
CREATE TABLE IF NOT EXISTS hostels (
  hostel_id SERIAL PRIMARY KEY, block VARCHAR(10) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL,
  gender VARCHAR(20), warden_user_id INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS floors (
  floor_id SERIAL PRIMARY KEY, block VARCHAR(10) NOT NULL, floor INTEGER NOT NULL, label VARCHAR(50),
  UNIQUE (block, floor));
--#
CREATE TABLE IF NOT EXISTS beds (
  bed_id SERIAL PRIMARY KEY, room_block VARCHAR(10) NOT NULL, room_floor INTEGER NOT NULL,
  room_number INTEGER NOT NULL, bed_number INTEGER NOT NULL, student_number VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'Available',
  UNIQUE (room_block, room_floor, room_number, bed_number));
--#
CREATE TABLE IF NOT EXISTS property_types (
  type_id SERIAL PRIMARY KEY, name VARCHAR(60) NOT NULL UNIQUE, code VARCHAR(4) NOT NULL,
  per_bed INTEGER NOT NULL DEFAULT 0, standard_qty INTEGER NOT NULL DEFAULT 1,
  replacement_cost NUMERIC(10,2) NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
--#
CREATE TABLE IF NOT EXISTS properties (
  property_id SERIAL PRIMARY KEY, item_code VARCHAR(30) NOT NULL UNIQUE, type_id INTEGER NOT NULL,
  item_name VARCHAR(60) NOT NULL, room_block VARCHAR(10) NOT NULL, room_floor INTEGER NOT NULL,
  room_number INTEGER NOT NULL, item_condition VARCHAR(20) NOT NULL DEFAULT 'Good',
  status VARCHAR(20) NOT NULL DEFAULT 'In use', acquired_date DATE,
  repair_cost_total NUMERIC(10,2) NOT NULL DEFAULT 0, replacement_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS room_properties (
  rp_id SERIAL PRIMARY KEY, property_id INTEGER NOT NULL, room_block VARCHAR(10) NOT NULL,
  room_floor INTEGER NOT NULL, room_number INTEGER NOT NULL,
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE, removed_date DATE);
--#
CREATE TABLE IF NOT EXISTS property_history (
  history_id SERIAL PRIMARY KEY, property_id INTEGER NOT NULL, event_type VARCHAR(30) NOT NULL,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE, item_condition VARCHAR(20), note TEXT,
  student_number VARCHAR(30), ref_type VARCHAR(30), ref_id INTEGER, actor VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS files (
  file_id VARCHAR(40) PRIMARY KEY, storage_key VARCHAR(200) NOT NULL, mime VARCHAR(60) NOT NULL,
  size_bytes INTEGER NOT NULL, original_name VARCHAR(150), sha256 VARCHAR(64), purpose VARCHAR(30),
  uploaded_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS inspection_items (
  ii_id SERIAL PRIMARY KEY, inspection_id INTEGER NOT NULL, property_id INTEGER,
  item_name VARCHAR(80) NOT NULL, item_code VARCHAR(30), item_condition VARCHAR(20) NOT NULL,
  note TEXT, photo_ids TEXT NOT NULL DEFAULT '[]');
--#
CREATE TABLE IF NOT EXISTS damage_evidence (
  evidence_id SERIAL PRIMARY KEY, damage_id INTEGER NOT NULL, file_id VARCHAR(40) NOT NULL,
  caption VARCHAR(200), uploaded_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS fines (
  fine_id SERIAL PRIMARY KEY, fine_number VARCHAR(20) NOT NULL UNIQUE, damage_id INTEGER NOT NULL,
  student_number VARCHAR(30) NOT NULL, item_name VARCHAR(80), reason TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL, due_date DATE NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'Approved',
  approved_by INTEGER, approved_by_name VARCHAR(120), approved_at TIMESTAMPTZ, approval_note TEXT,
  paid_at TIMESTAMPTZ, waived_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS fine_appeals (
  appeal_id SERIAL PRIMARY KEY, fine_id INTEGER NOT NULL, student_number VARCHAR(30) NOT NULL,
  reason TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'Open', decision_note TEXT,
  decided_by INTEGER, decided_by_name VARCHAR(120), decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS fees (
  fee_id SERIAL PRIMARY KEY, invoice_number VARCHAR(20) NOT NULL UNIQUE, student_number VARCHAR(30) NOT NULL,
  fee_type VARCHAR(30) NOT NULL, description VARCHAR(200), amount NUMERIC(10,2) NOT NULL,
  due_date DATE NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'Unpaid', created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS payments (
  payment_id SERIAL PRIMARY KEY, receipt_number VARCHAR(20) NOT NULL UNIQUE, student_number VARCHAR(30) NOT NULL,
  fee_id INTEGER, fine_id INTEGER, kind VARCHAR(15) NOT NULL DEFAULT 'Payment', amount NUMERIC(10,2) NOT NULL,
  method VARCHAR(30) NOT NULL, reference VARCHAR(80), note TEXT, recorded_by INTEGER,
  recorded_by_name VARCHAR(120), paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS room_applications (
  application_id SERIAL PRIMARY KEY, application_number VARCHAR(20) NOT NULL UNIQUE,
  student_number VARCHAR(30) NOT NULL, full_name VARCHAR(120) NOT NULL, email VARCHAR(150),
  phone VARCHAR(30), faculty VARCHAR(120), preferred_block VARCHAR(10), preferred_room_type VARCHAR(30),
  notes TEXT, status VARCHAR(20) NOT NULL DEFAULT 'Pending', waitlist_position INTEGER,
  assigned_block VARCHAR(10), assigned_floor INTEGER, assigned_number INTEGER,
  decided_by INTEGER, decided_at TIMESTAMPTZ, decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS notifications (
  notification_id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, title VARCHAR(150) NOT NULL, message TEXT,
  type VARCHAR(30), page VARCHAR(30), related_id INTEGER, dedupe_key VARCHAR(120), read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id SERIAL PRIMARY KEY, user_id INTEGER, username VARCHAR(60), role VARCHAR(20),
  action VARCHAR(60) NOT NULL, entity_type VARCHAR(40), entity_id VARCHAR(40), details TEXT,
  ip VARCHAR(60), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS student_documents (
  doc_id SERIAL PRIMARY KEY, student_number VARCHAR(30) NOT NULL, doc_type VARCHAR(40) NOT NULL,
  file_id VARCHAR(40) NOT NULL, note VARCHAR(200), uploaded_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS report_archive (
  report_id SERIAL PRIMARY KEY, report_key VARCHAR(30) NOT NULL, period VARCHAR(10) NOT NULL,
  file_id VARCHAR(40) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS visitors (
  visitor_id SERIAL PRIMARY KEY, student_number VARCHAR(30) NOT NULL, visitor_name VARCHAR(120) NOT NULL,
  visitor_ic VARCHAR(30), relationship VARCHAR(40), purpose VARCHAR(200), visit_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending', time_in TIMESTAMPTZ, time_out TIMESTAMPTZ,
  decided_by INTEGER, recorded_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS leave_requests (
  leave_id SERIAL PRIMARY KEY, student_number VARCHAR(30) NOT NULL, leave_type VARCHAR(30) NOT NULL,
  destination VARCHAR(150), reason TEXT NOT NULL, leave_from DATE NOT NULL, leave_to DATE NOT NULL,
  return_time VARCHAR(5), status VARCHAR(20) NOT NULL DEFAULT 'Pending', decision_note TEXT, decided_by INTEGER,
  returned_at TIMESTAMPTZ, returned_late INTEGER NOT NULL DEFAULT 0, recorded_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS room_transfers (
  transfer_id SERIAL PRIMARY KEY, student_number VARCHAR(30) NOT NULL, from_block VARCHAR(10),
  from_floor INTEGER, from_number INTEGER, preferred_block VARCHAR(10), to_block VARCHAR(10),
  to_floor INTEGER, to_number INTEGER, reason TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  decision_note TEXT, decided_by INTEGER, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS complaints (
  complaint_id SERIAL PRIMARY KEY, student_number VARCHAR(30) NOT NULL, category VARCHAR(30) NOT NULL,
  subject VARCHAR(150) NOT NULL, message TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'Open',
  response TEXT, responded_by INTEGER, responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS notices (
  notice_id SERIAL PRIMARY KEY, title VARCHAR(150) NOT NULL, body TEXT NOT NULL,
  audience VARCHAR(20) NOT NULL DEFAULT 'All', priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
  publish_date DATE NOT NULL DEFAULT CURRENT_DATE, expires_date DATE, status VARCHAR(20) NOT NULL DEFAULT 'Published',
  posted_by INTEGER, posted_by_name VARCHAR(120), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE TABLE IF NOT EXISTS key_records (
  key_id SERIAL PRIMARY KEY, room_block VARCHAR(10) NOT NULL, room_floor INTEGER NOT NULL,
  room_number INTEGER NOT NULL, key_number VARCHAR(30) NOT NULL, student_number VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'Issued', issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at TIMESTAMPTZ, note VARCHAR(200), issued_by INTEGER);
--#
CREATE TABLE IF NOT EXISTS incidents (
  incident_id SERIAL PRIMARY KEY, incident_type VARCHAR(40) NOT NULL, severity VARCHAR(20) NOT NULL,
  location VARCHAR(150), room_block VARCHAR(10), room_floor INTEGER, room_number INTEGER,
  student_number VARCHAR(30), description TEXT NOT NULL, action_taken TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Open', reported_by INTEGER, reported_by_name VARCHAR(120),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TIMESTAMPTZ);
--#
CREATE TABLE IF NOT EXISTS lost_found (
  item_id SERIAL PRIMARY KEY, kind VARCHAR(10) NOT NULL, item_name VARCHAR(100) NOT NULL, description TEXT,
  location VARCHAR(150), date_reported DATE NOT NULL, student_number VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'Open', resolution_note TEXT, recorded_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
--#
CREATE INDEX IF NOT EXISTS idx_students_user ON students (user_id);
--#
CREATE INDEX IF NOT EXISTS idx_properties_room ON properties (room_block, room_floor, room_number);
--#
CREATE INDEX IF NOT EXISTS idx_history_property ON property_history (property_id);
--#
CREATE INDEX IF NOT EXISTS idx_inspection_items_ins ON inspection_items (inspection_id);
--#
CREATE INDEX IF NOT EXISTS idx_damage_student ON damage_reports (student_number);
--#
CREATE INDEX IF NOT EXISTS idx_fines_student ON fines (student_number);
--#
CREATE INDEX IF NOT EXISTS idx_fees_student ON fees (student_number);
--#
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments (student_number);
--#
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read_at);
--#
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at);
--#
CREATE INDEX IF NOT EXISTS idx_repairs_assigned ON repair_requests (assigned_user_id);

-- ---------- 003_entity_files.sql ----------
CREATE TABLE IF NOT EXISTS entity_files (
  ef_id SERIAL PRIMARY KEY, entity_type VARCHAR(30) NOT NULL, entity_id INTEGER NOT NULL,
  file_id VARCHAR(40) NOT NULL, caption VARCHAR(200), uploaded_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--#
CREATE INDEX IF NOT EXISTS idx_entity_files ON entity_files (entity_type, entity_id);
