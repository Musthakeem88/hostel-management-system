-- =====================================================================
-- Hostel Management System — database reference (PostgreSQL)
--
-- Rebuilt from the queries in backend/routes/*.js, so column NAMES match
-- the code exactly. Column TYPES/limits are best guesses: compare with
-- your real database before relying on this file. It only uses
-- CREATE TABLE IF NOT EXISTS, so it will not overwrite existing tables.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.rooms (
  block              VARCHAR(10) NOT NULL,
  floor              INTEGER     NOT NULL,
  room_number        INTEGER     NOT NULL,
  capacity           INTEGER     NOT NULL CHECK (capacity > 0),
  occupied           INTEGER     NOT NULL DEFAULT 0 CHECK (occupied >= 0),
  under_maintenance  BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (block, floor, room_number)
);

CREATE TABLE IF NOT EXISTS public.students (
  student_id      SERIAL PRIMARY KEY,
  student_number  VARCHAR(30)  NOT NULL UNIQUE,
  full_name       VARCHAR(120) NOT NULL,
  email           VARCHAR(150) NOT NULL UNIQUE,
  phone           VARCHAR(30),
  room_block      VARCHAR(10)  NOT NULL,
  room_floor      INTEGER      NOT NULL,
  room_number     INTEGER      NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inspections (
  inspection_id     SERIAL PRIMARY KEY,
  room_block        VARCHAR(10) NOT NULL,
  room_floor        INTEGER     NOT NULL,
  room_number       INTEGER     NOT NULL,
  student_number    VARCHAR(30) NOT NULL,
  inspection_type   VARCHAR(20) NOT NULL CHECK (inspection_type IN ('Check-in', 'Check-out')),
  inspection_items  JSONB       NOT NULL DEFAULT '[]',
  inspection_date   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.damage_reports (
  damage_id       SERIAL PRIMARY KEY,
  report_number   VARCHAR(20)   NOT NULL UNIQUE,
  room_block      VARCHAR(10)   NOT NULL,
  room_floor      INTEGER       NOT NULL,
  room_number     INTEGER       NOT NULL,
  item_name       VARCHAR(80)   NOT NULL,
  student_number  VARCHAR(30)   NOT NULL,
  description     TEXT          NOT NULL,
  fine_amount     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (fine_amount >= 0),
  fine_status     VARCHAR(20)   NOT NULL DEFAULT 'Pending'
                  CHECK (fine_status IN ('Pending', 'Under Review', 'Approved', 'Paid')),
  dispute_reason  TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.repair_requests (
  repair_id       SERIAL PRIMARY KEY,
  request_number  VARCHAR(20) NOT NULL UNIQUE,
  room_block      VARCHAR(10) NOT NULL,
  room_floor      INTEGER     NOT NULL,
  room_number     INTEGER     NOT NULL,
  item_name       VARCHAR(80) NOT NULL,
  description     TEXT        NOT NULL,
  priority        VARCHAR(10) NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal', 'Urgent')),
  repair_status   VARCHAR(20) NOT NULL DEFAULT 'Reported'
                  CHECK (repair_status IN ('Reported', 'Assigned', 'In Progress', 'Completed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
