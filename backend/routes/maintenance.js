
const express = require("express");
const pool = require("../db");

const router = express.Router();

const TYPES = [
  "Electrical",
  "Plumbing",
  "Furniture",
  "Cleaning"
];

const STATUSES = [
  "Pending",
  "In Progress",
  "Completed"
];

const COLUMNS = `
  maintenance_id,
  room_block,
  room_floor,
  room_number,
  maintenance_type,
  description,
  assigned_staff,
  status,
  TO_CHAR(reported_date, 'YYYY-MM-DD') AS reported_date,
  TO_CHAR(expected_completion_date, 'YYYY-MM-DD') AS expected_completion_date,
  TO_CHAR(completed_date, 'YYYY-MM-DD') AS completed_date
`;

let tableReady = null;

/* ---------- Create table if needed ---------- */

function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS public.maintenance_requests (
        maintenance_id SERIAL PRIMARY KEY,
        room_block VARCHAR(10) NOT NULL,
        room_floor INTEGER NOT NULL,
        room_number INTEGER NOT NULL,
        maintenance_type VARCHAR(20) NOT NULL,
        description TEXT NOT NULL,
        assigned_staff VARCHAR(100),
        status VARCHAR(20) NOT NULL DEFAULT 'Pending',
        reported_date DATE NOT NULL DEFAULT CURRENT_DATE,
        expected_completion_date DATE,
        completed_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch((error) => {
      tableReady = null;
      throw error;
    });
  }

  return tableReady;
}

/* ---------- Ensure database table exists ---------- */

router.use(async (req, res, next) => {
  try {
    await ensureTable();
    next();
  } catch (error) {
    console.error("Maintenance table error:", error);

    return res.status(500).json({
      error: "Maintenance table could not be initialized."
    });
  }
});

/* ---------- Helpers ---------- */

function clean(value) {
  return String(value ?? "").trim();
}

function isDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function readFields(body) {
  const maintenanceType = clean(body.maintenance_type);
  const description = clean(body.description);
  const staff = clean(body.assigned_staff);
  const status = clean(body.status) || "Pending";
  const reported = clean(body.reported_date);
  const expected = clean(body.expected_completion_date);

  if (!TYPES.includes(maintenanceType)) {
    return { error: "Select a valid maintenance type." };
  }

  if (!description) {
    return { error: "Problem description is required." };
  }

  if (description.length > 1000) {
    return {
      error: "Description cannot exceed 1000 characters."
    };
  }

  if (staff.length > 100) {
    return {
      error: "Assigned staff cannot exceed 100 characters."
    };
  }

  if (!STATUSES.includes(status)) {
    return { error: "Invalid maintenance status." };
  }

  if (reported && !isDate(reported)) {
    return { error: "Reported date is invalid." };
  }

  if (expected && !isDate(expected)) {
    return { error: "Expected completion date is invalid." };
  }

  if (reported && expected && expected < reported) {
    return {
      error: "Expected completion cannot be before the reported date."
    };
  }

  return {
    value: {
      maintenanceType,
      description,
      staff: staff || null,
      status,
      reported: reported || null,
      expected: expected || null
    }
  };
}

function parseId(value) {
  const id = Number(value);

  return Number.isInteger(id) && id > 0 ? id : null;
}

/* ---------- List maintenance requests ---------- */

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ${COLUMNS}
      FROM public.maintenance_requests
      ORDER BY maintenance_id DESC
    `);

    return res.json(result.rows);
  } catch (error) {
    console.error("Error fetching maintenance:", error);

    return res.status(500).json({
      error: "Could not load maintenance requests."
    });
  }
});

/* ---------- Add maintenance request ---------- */

router.post("/", async (req, res) => {
  const body = req.body || {};

  const block = clean(body.room_block);
  const floor = Number(body.room_floor);
  const roomNumber = Number(body.room_number);

  if (
    !block ||
    !Number.isInteger(floor) ||
    !Number.isInteger(roomNumber) ||
    floor < 1 ||
    roomNumber < 1
  ) {
    return res.status(400).json({
      error: "Please select a valid room."
    });
  }

  const fields = readFields(body);

  if (fields.error) {
    return res.status(400).json({
      error: fields.error
    });
  }

  const {
    maintenanceType,
    description,
    staff,
    status,
    reported,
    expected
  } = fields.value;

  try {
    const roomResult = await pool.query(
      `SELECT id
       FROM public.rooms
       WHERE TRIM(block::text) = TRIM($1::text)
         AND floor = $2::integer
         AND room_number = $3::integer`,
      [block, floor, roomNumber]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({
        error: "Room not found. Check the selected room."
      });
    }

    const result = await pool.query(
      `INSERT INTO public.maintenance_requests (
        room_block,
        room_floor,
        room_number,
        maintenance_type,
        description,
        assigned_staff,
        status,
        reported_date,
        expected_completion_date,
        completed_date
      )
      VALUES (
        $1::varchar,
        $2::integer,
        $3::integer,
        $4::varchar,
        $5::text,
        $6::varchar,
        $7::varchar,
        COALESCE($8::date, CURRENT_DATE),
        $9::date,
        CASE
          WHEN $7::varchar = 'Completed'
          THEN CURRENT_DATE
          ELSE NULL
        END
      )
      RETURNING ${COLUMNS}`,
      [
        block,
        floor,
        roomNumber,
        maintenanceType,
        description,
        staff,
        status,
        reported,
        expected
      ]
    );

    return res.status(201).json({
      message: "Maintenance request added successfully.",
      maintenance: result.rows[0]
    });
  } catch (error) {
    console.error("Error adding maintenance:", error);

    return res.status(500).json({
      error: "Could not add the maintenance request."
    });
  }
});

/* ---------- Edit maintenance request ---------- */

router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({
      error: "Invalid maintenance ID."
    });
  }

  const fields = readFields(req.body || {});

  if (fields.error) {
    return res.status(400).json({
      error: fields.error
    });
  }

  const {
    maintenanceType,
    description,
    staff,
    status,
    reported,
    expected
  } = fields.value;

  try {
    // Retrieve the existing request.
    // TO_CHAR ensures reported_date is returned as YYYY-MM-DD.
    const existing = await pool.query(
      `SELECT
         status,
         TO_CHAR(reported_date, 'YYYY-MM-DD') AS reported_date
       FROM public.maintenance_requests
       WHERE maintenance_id = $1::integer`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        error: "Maintenance request not found."
      });
    }

    if (existing.rows[0].status === "Completed") {
      return res.status(409).json({
        error: "Completed maintenance requests cannot be edited."
      });
    }

    const existingReported = existing.rows[0].reported_date;
    const finalReported = reported || existingReported;

    // Compare dates in YYYY-MM-DD format.
    if (expected && finalReported && expected < finalReported) {
      return res.status(400).json({
        error: `Expected completion (${expected}) cannot be before the reported date (${finalReported}).`
      });
    }

    const result = await pool.query(
      `UPDATE public.maintenance_requests
       SET maintenance_type = $1::varchar,
           description = $2::text,
           assigned_staff = $3::varchar,
           status = $4::varchar,
           reported_date = COALESCE($5::date, reported_date),
           expected_completion_date = $6::date,
           completed_date = CASE
             WHEN $4::varchar = 'Completed'
             THEN CURRENT_DATE
             ELSE NULL
           END
       WHERE maintenance_id = $7::integer
         AND status <> 'Completed'
       RETURNING ${COLUMNS}`,
      [
        maintenanceType,
        description,
        staff,
        status,
        reported,
        expected,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: "This request can no longer be edited."
      });
    }

    return res.json({
      message: "Maintenance request updated successfully.",
      maintenance: result.rows[0]
    });
  } catch (error) {
    console.error("Error updating maintenance:", error);

    return res.status(500).json({
      error: "Could not update the maintenance request."
    });
  }
});

/* ---------- Mark request as completed ---------- */

router.patch("/:id/complete", async (req, res) => {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({
      error: "Invalid maintenance ID."
    });
  }

  try {
    const result = await pool.query(
      `UPDATE public.maintenance_requests
       SET status = 'Completed',
           completed_date = CURRENT_DATE
       WHERE maintenance_id = $1::integer
         AND status <> 'Completed'
       RETURNING ${COLUMNS}`,
      [id]
    );

    if (result.rows.length === 0) {
      const existing = await pool.query(
        `SELECT status
         FROM public.maintenance_requests
         WHERE maintenance_id = $1::integer`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({
          error: "Maintenance request not found."
        });
      }

      return res.status(409).json({
        error: "This request is already completed and locked."
      });
    }

    return res.json({
      message: "Maintenance marked as completed.",
      maintenance: result.rows[0]
    });
  } catch (error) {
    console.error("Error completing maintenance:", error);

    return res.status(500).json({
      error: "Could not complete the maintenance request."
    });
  }
});

module.exports = router;
