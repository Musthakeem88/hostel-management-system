const express = require("express");
const pool = require("../db");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { notifyUsers, notifyRoles } = require("../lib/notify");
const { roomId } = require("../lib/validate");

const router = express.Router();

const TYPES = ["Electrical", "Plumbing", "Furniture", "Cleaning"];
const STATUSES = ["Pending", "In Progress", "Completed"];

// Dates are returned as plain YYYY-MM-DD text so time zones can never shift them.
const COLUMNS = `
  maintenance_id, room_block, room_floor, room_number,
  maintenance_type, description, assigned_staff, assigned_user_id, status,
  to_char(reported_date, 'YYYY-MM-DD') AS reported_date,
  to_char(expected_completion_date, 'YYYY-MM-DD') AS expected_completion_date,
  to_char(completed_date, 'YYYY-MM-DD') AS completed_date
`;

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function clean(value) {
  return String(value ?? "").trim();
}

// Reads and validates the fields shared by "add" and "edit".
function readFields(body) {
  const maintenanceType = clean(body.maintenance_type);
  const description = clean(body.description);
  const staff = clean(body.assigned_staff);
  const status = clean(body.status) || "Pending";
  const expected = clean(body.expected_completion_date);

  if (!TYPES.includes(maintenanceType)) return { error: "Select a valid maintenance type." };
  if (!description) return { error: "Problem description is required." };
  if (description.length > 1000) return { error: "Problem description is too long (max 1000 characters)." };
  if (staff.length > 100) return { error: "Assigned staff name is too long (max 100 characters)." };
  if (!STATUSES.includes(status)) return { error: "Invalid status." };
  if (expected && !isDate(expected)) return { error: "Expected completion date is not a valid date." };

  return {
    value: {
      maintenanceType,
      description,
      staff: staff || null,
      status,
      expected: expected || null
    }
  };
}

async function resolveAssignee(body) {
  const id = body.assigned_user_id;
  if (id == null || id === "") return { id: null, name: null };
  const r = await pool.query("SELECT user_id, full_name FROM users WHERE user_id = $1 AND role = 'maintenance' AND status = 'Active'", [Number(id)]);
  if (!r.rows.length) return { error: "Choose an active maintenance staff member." };
  return { id: r.rows[0].user_id, name: r.rows[0].full_name };
}

// List
router.get("/", requireRole("warden", "administrator", "maintenance", "management"), async (req, res) => {
  try {
    const mine = req.user.role === "maintenance";
    const result = await pool.query(`
      SELECT ${COLUMNS}
      FROM public.maintenance_requests
      ${mine ? "WHERE assigned_user_id = $1 OR LOWER(assigned_staff) = LOWER($2)" : ""}
      ORDER BY maintenance_id DESC
    `, mine ? [req.user.id, req.user.name] : []);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching maintenance:", error);
    res.status(500).json({ error: "Could not load maintenance requests." });
  }
});

// Add
router.post("/", requireRole("warden", "administrator"), async (req, res) => {
  const body = req.body || {};
  const block = clean(body.room_block);
  const floor = Number(body.room_floor);
  const roomNumber = Number(body.room_number);
  const reported = clean(body.reported_date);

  if (!block || !Number.isInteger(floor) || !Number.isInteger(roomNumber)) {
    return res.status(400).json({ error: "Select a valid room." });
  }

  if (reported && !isDate(reported)) {
    return res.status(400).json({ error: "Reported date is not a valid date." });
  }

  const fields = readFields(body);

  if (fields.error) return res.status(400).json({ error: fields.error });

  const assignee = await resolveAssignee(body);
  if (assignee.error) return res.status(400).json({ error: assignee.error });

  const { maintenanceType, description, status, expected } = fields.value;
  const staff = assignee.name || fields.value.staff;

  if (expected && expected < (reported || new Date().toISOString().slice(0, 10))) {
    return res.status(400).json({ error: "Expected completion cannot be before the reported date." });
  }

  try {
    const room = await pool.query(
      `SELECT 1 FROM public.rooms
       WHERE block = $1 AND floor = $2 AND room_number = $3`,
      [block, floor, roomNumber]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({ error: "Room not found." });
    }

    const result = await pool.query(
      `INSERT INTO public.maintenance_requests
         (room_block, room_floor, room_number, maintenance_type, description,
          assigned_staff, status, reported_date, expected_completion_date, completed_date,
          assigned_user_id, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9::date,
               CASE WHEN $7 = 'Completed' THEN CURRENT_DATE ELSE NULL END, $10, $11, CURRENT_TIMESTAMP)
       RETURNING ${COLUMNS}`,
      [block, floor, roomNumber, maintenanceType, description, staff, status, reported || null, expected, assignee.id, req.user.id]
    );

    const where = roomId(block, floor, roomNumber);
    if (assignee.id) await notifyUsers([assignee.id], { title: "New maintenance job", message: `${maintenanceType} in room ${where}: ${description.slice(0, 100)}`, type: "maintenance", page: "maintenance", related_id: result.rows[0].maintenance_id });
    await audit(req, "create_maintenance", "maintenance", result.rows[0].maintenance_id, { room: where, type: maintenanceType });

    res.status(201).json({
      message: "Maintenance request added successfully.",
      maintenance: result.rows[0]
    });
  } catch (error) {
    console.error("Error adding maintenance:", error);
    res.status(500).json({ error: "Could not add the maintenance request." });
  }
});

// Check that a request exists and is not completed (completed requests are locked)
async function notFoundOrLocked(id, res) {
  const existing = await pool.query(
    "SELECT status FROM public.maintenance_requests WHERE maintenance_id = $1",
    [id]
  );

  if (existing.rows.length === 0) {
    res.status(404).json({ error: "Maintenance request not found." });
  } else {
    res.status(409).json({ error: "Completed maintenance requests cannot be changed." });
  }
}

// Edit
router.put("/:id", requireRole("warden", "administrator"), async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid maintenance ID." });
  }

  const fields = readFields(req.body || {});

  if (fields.error) return res.status(400).json({ error: fields.error });

  const assignee = await resolveAssignee(req.body || {});
  if (assignee.error) return res.status(400).json({ error: assignee.error });

  const { maintenanceType, description, status, expected } = fields.value;
  const staff = assignee.name || fields.value.staff;

  try {
    const result = await pool.query(
      `UPDATE public.maintenance_requests
       SET maintenance_type = $1,
           description = $2,
           assigned_staff = $3,
           assigned_user_id = $7,
           status = $4,
           expected_completion_date = $5::date,
           completed_date = CASE WHEN $4 = 'Completed' THEN CURRENT_DATE ELSE NULL END
       WHERE maintenance_id = $6
         AND status <> 'Completed'
         AND ($5::date IS NULL OR $5::date >= reported_date)
       RETURNING ${COLUMNS}`,
      [maintenanceType, description, staff, status, expected, id, assignee.id]
    );

    if (result.rows.length === 0) {
      // Could be: missing, locked, or the date check failed.
      const existing = await pool.query(
        "SELECT status FROM public.maintenance_requests WHERE maintenance_id = $1",
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Maintenance request not found." });
      }

      if (existing.rows[0].status === "Completed") {
        return res.status(409).json({ error: "Completed maintenance requests cannot be changed." });
      }

      return res.status(400).json({ error: "Expected completion cannot be before the reported date." });
    }

    if (assignee.id) await notifyUsers([assignee.id], { title: "Maintenance job assigned", message: `${maintenanceType}: ${description.slice(0, 100)}`, type: "maintenance", page: "maintenance", related_id: id });
    await audit(req, "update_maintenance", "maintenance", id, { status });

    res.json({
      message: "Maintenance request updated successfully.",
      maintenance: result.rows[0]
    });
  } catch (error) {
    console.error("Error updating maintenance:", error);
    res.status(500).json({ error: "Could not update the maintenance request." });
  }
});

// Mark as completed
router.patch("/:id/complete", requireRole("warden", "administrator", "maintenance"), async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid maintenance ID." });
  }

  try {
    if (req.user.role === "maintenance") {
      const own = await pool.query("SELECT assigned_user_id, assigned_staff FROM public.maintenance_requests WHERE maintenance_id = $1", [id]);
      if (own.rows.length && Number(own.rows[0].assigned_user_id) !== req.user.id && String(own.rows[0].assigned_staff || "").toLowerCase() !== req.user.name.toLowerCase()) {
        return res.status(403).json({ error: "This job is not assigned to you." });
      }
    }

    const result = await pool.query(
      `UPDATE public.maintenance_requests
       SET status = 'Completed', completed_date = CURRENT_DATE
       WHERE maintenance_id = $1 AND status <> 'Completed'
       RETURNING ${COLUMNS}`,
      [id]
    );

    if (result.rows.length === 0) {
      return notFoundOrLocked(id, res);
    }

    const done = result.rows[0];
    await notifyRoles(["warden", "administrator"], { title: "Maintenance completed", message: `${done.maintenance_type} in room ${roomId(done.room_block, done.room_floor, done.room_number)} was completed by ${req.user.name}.`, type: "maintenance", page: "maintenance", related_id: id });
    await audit(req, "complete_maintenance", "maintenance", id);

    res.json({
      message: "Maintenance marked as completed.",
      maintenance: result.rows[0]
    });
  } catch (error) {
    console.error("Error completing maintenance:", error);
    res.status(500).json({ error: "Could not complete the maintenance request." });
  }
});

module.exports = router;
