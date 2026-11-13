const express = require("express");
const pool = require("../db");
const { roomId, today } = require("../lib/validate");
const { cents, depositSummary } = require("../lib/billing");

const router = express.Router();

const num = async (sql, params = []) => Number((await pool.query(sql, params)).rows[0].n || 0);
const flt = async (sql, params = []) => cents((await pool.query(sql, params)).rows[0].n || 0);

/* Campus-wide numbers for administrators, wardens and management */
async function overview() {
  const t = today();

  const rooms = (await pool.query(
    `SELECT CAST(COUNT(*) AS INTEGER) AS total,
            CAST(COALESCE(SUM(capacity), 0) AS INTEGER) AS beds, CAST(COALESCE(SUM(occupied), 0) AS INTEGER) AS used
     FROM rooms`)).rows[0];

  const mostDamaged = (await pool.query(
    `SELECT item_name, CAST(COUNT(*) AS INTEGER) AS total FROM damage_reports
     WHERE damage_status IS NULL OR damage_status <> 'Rejected'
     GROUP BY item_name ORDER BY total DESC, item_name LIMIT 5`)).rows;

  return {
    rooms: {
      total: Number(rooms.total),
      used: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM rooms WHERE occupied > 0"),
      available: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM rooms WHERE under_maintenance = FALSE AND occupied < capacity"),
      full: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM rooms WHERE occupied >= capacity"),
      under_maintenance: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM rooms WHERE under_maintenance = TRUE"),
      beds: Number(rooms.beds),
      beds_used: Number(rooms.used)
    },
    students: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM students WHERE student_status IS NULL OR student_status = 'Active'"),
    items: {
      total: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM properties WHERE status IN ('In use', 'Under repair')"),
      damaged: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM properties WHERE item_condition <> 'Good' AND status IN ('In use', 'Under repair')")
    },
    repairs: {
      open: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM repair_requests WHERE repair_status <> 'Completed'"),
      finished: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM repair_requests WHERE repair_status = 'Completed'"),
      urgent: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM repair_requests WHERE repair_status <> 'Completed' AND priority = 'Urgent'")
    },
    damage: {
      awaiting_review: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM damage_reports WHERE damage_status IS NULL OR damage_status IN ('Reported', 'Under Investigation')"),
      total_cost: await flt(`SELECT CAST(COALESCE(SUM(CASE WHEN replacement_cost > 0 THEN replacement_cost ELSE repair_cost END), 0) AS FLOAT) AS n
                             FROM damage_reports WHERE damage_status = 'Confirmed'`),
      most_damaged: mostDamaged.map((m) => ({ item: m.item_name, total: Number(m.total) }))
    },
    fines: {
      unpaid_count: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM fines WHERE status IN ('Approved', 'Disputed', 'Under Review')"),
      unpaid_amount: await flt("SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS n FROM fines WHERE status IN ('Approved', 'Disputed', 'Under Review')"),
      paid_count: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM fines WHERE status = 'Paid'"),
      paid_amount: await flt("SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS n FROM fines WHERE status = 'Paid'"),
      appeals_open: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM fine_appeals WHERE status = 'Open'"),
      overdue: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM fines WHERE status = 'Approved' AND to_char(due_date, 'YYYY-MM-DD') < $1", [t])
    },
    fees: {
      invoiced: await flt("SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS n FROM fees WHERE status <> 'Cancelled'"),
      received: await flt("SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS n FROM payments WHERE kind = 'Payment' AND fee_id IS NOT NULL"),
      unpaid_count: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM fees WHERE status IN ('Unpaid', 'Partially paid')"),
      overdue: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM fees WHERE status IN ('Unpaid', 'Partially paid') AND to_char(due_date, 'YYYY-MM-DD') < $1", [t])
    },
    waiting: {
      applications: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM room_applications WHERE status = 'Pending'"),
      waitlisted: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM room_applications WHERE status = 'Waitlisted'"),
      visitors: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM visitors WHERE status = 'Pending'"),
      leaves: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM leave_requests WHERE status = 'Pending'"),
      transfers: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM room_transfers WHERE status = 'Pending'"),
      complaints: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM complaints WHERE status IN ('Open', 'In review')"),
      incidents: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM incidents WHERE status <> 'Resolved'"),
      checkins_unconfirmed: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM inspections WHERE confirmation_status = 'Pending'")
    }
  };
}

async function studentView(req) {
  const number = req.user.studentNumber;
  if (!number) return { linked: false };

  const student = (await pool.query(
    "SELECT room_block, room_floor, room_number, student_status, faculty FROM students WHERE student_number = $1", [number])).rows[0];
  const t = today();
  const pending = (await pool.query(
    "SELECT inspection_id FROM inspections WHERE student_number = $1 AND inspection_type = 'Check-in' AND confirmation_status = 'Pending' ORDER BY inspection_id DESC LIMIT 1", [number])).rows[0];
  const application = (await pool.query(
    "SELECT application_number, status, waitlist_position FROM room_applications WHERE student_number = $1 ORDER BY application_id DESC LIMIT 1", [number])).rows[0];

  return {
    linked: true,
    resident: Boolean(student && (!student.student_status || student.student_status === "Active")),
    room_id: student ? roomId(student.room_block, student.room_floor, student.room_number) : null,
    status: student ? student.student_status || "Active" : null,
    pending_confirmation: pending ? pending.inspection_id : null,
    application: application || null,
    repairs_open: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM repair_requests WHERE student_number = $1 AND repair_status <> 'Completed'", [number]),
    fines_due: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM fines WHERE student_number = $1 AND status IN ('Approved', 'Disputed', 'Under Review')", [number]),
    fines_amount: await flt("SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS n FROM fines WHERE student_number = $1 AND status IN ('Approved', 'Disputed', 'Under Review')", [number]),
    fines_overdue: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM fines WHERE student_number = $1 AND status = 'Approved' AND to_char(due_date, 'YYYY-MM-DD') < $2", [number, t]),
    fees_owed: await flt(
      `SELECT CAST(COALESCE(SUM(f.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.fee_id = f.fee_id AND p.kind = 'Payment'), 0)), 0) AS FLOAT) AS n
       FROM fees f WHERE f.student_number = $1 AND f.status IN ('Unpaid', 'Partially paid')`, [number]),
    deposit: await depositSummary(pool, number)
  };
}

async function maintenanceView(req) {
  const jobs = (await pool.query(
    `SELECT repair_id, request_number, item_name, room_block, room_floor, room_number, priority, repair_status
     FROM repair_requests WHERE assigned_user_id = $1 AND repair_status <> 'Completed'
     ORDER BY CASE priority WHEN 'Urgent' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END, repair_id DESC LIMIT 10`, [req.user.id])).rows;

  return {
    repairs_open: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM repair_requests WHERE assigned_user_id = $1 AND repair_status <> 'Completed'", [req.user.id]),
    repairs_urgent: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM repair_requests WHERE assigned_user_id = $1 AND repair_status <> 'Completed' AND priority = 'Urgent'", [req.user.id]),
    repairs_done: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM repair_requests WHERE assigned_user_id = $1 AND repair_status = 'Completed'", [req.user.id]),
    maintenance_open: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM maintenance_requests WHERE (assigned_user_id = $1 OR LOWER(assigned_staff) = LOWER($2)) AND status <> 'Completed'", [req.user.id, req.user.name]),
    jobs: jobs.map((j) => ({ ...j, room_id: roomId(j.room_block, j.room_floor, j.room_number) }))
  };
}

async function securityView() {
  const t = today();
  return {
    visitors_today: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM visitors WHERE to_char(visit_date, 'YYYY-MM-DD') = $1", [t]),
    visitors_approved: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM visitors WHERE to_char(visit_date, 'YYYY-MM-DD') = $1 AND status = 'Approved'", [t]),
    visitors_inside: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM visitors WHERE status = 'Checked in'"),
    returns_expected: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM leave_requests WHERE status IN ('Approved', 'Departed') AND to_char(leave_to, 'YYYY-MM-DD') <= $1", [t]),
    late_today: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM leave_requests WHERE status = 'Returned late' AND to_char(returned_at, 'YYYY-MM-DD') = $1", [t]),
    incidents_open: await num("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM incidents WHERE status <> 'Resolved'")
  };
}

router.get("/", async (req, res) => {
  const role = req.user.role;
  let data;

  if (role === "student") data = await studentView(req);
  else if (role === "maintenance") data = await maintenanceView(req);
  else if (role === "security") data = await securityView();
  else data = await overview();

  res.json({ role, ...data });
});

module.exports = router;
