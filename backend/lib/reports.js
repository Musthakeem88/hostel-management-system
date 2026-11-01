/* The nine reports of the proposal + the monthly summary.
   runReport(key, filters) -> { title, columns, rows, summary }   (also rendered to PDF / Excel)   */
const pool = require("../db");
const { roomId, today, isDate } = require("./validate");
const { cents } = require("./billing");
const { tablePdf } = require("./pdf");
const { workbookBuffer } = require("./xlsx");

const money = (n) => cents(n).toFixed(2);

function filterClause(filters, { block, dateCol, extra }) {
  const params = [];
  const where = [];
  if (filters.block && block) { params.push(filters.block); where.push(`${block} = $${params.length}`); }
  if (filters.from && dateCol) { params.push(filters.from); where.push(`to_char(${dateCol}, 'YYYY-MM-DD') >= $${params.length}`); }
  if (filters.to && dateCol) { params.push(filters.to); where.push(`to_char(${dateCol}, 'YYYY-MM-DD') <= $${params.length}`); }
  if (extra) extra(where, params);
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", params };
}

const roomStatus = (r) => r.under_maintenance ? "Under maintenance" : Number(r.occupied) >= Number(r.capacity) ? "Full" : Number(r.occupied) > 0 ? "Partially occupied" : "Available";

const REPORTS = {
  occupancy: {
    title: "Occupancy report", roles: ["warden", "administrator", "management"], filters: ["block"],
    description: "Every room with beds, residents and status.",
    columns: [{ key: "room", label: "Room", width: 1.2 }, { key: "type", label: "Type", width: 1 }, { key: "capacity", label: "Beds", width: 0.7, align: "right" }, { key: "occupied", label: "Used", width: 0.7, align: "right" }, { key: "free", label: "Free", width: 0.7, align: "right" }, { key: "status", label: "Status", width: 1.6 }],
    async run(f) {
      const c = filterClause(f, { block: "block" });
      const rooms = (await pool.query(`SELECT block, floor, room_number, room_type, capacity, occupied, under_maintenance FROM rooms ${c.sql} ORDER BY block, floor, room_number`, c.params)).rows;
      const rows = rooms.map((r) => ({ room: roomId(r.block, r.floor, r.room_number), type: r.room_type || "Standard", capacity: Number(r.capacity), occupied: Number(r.occupied), free: r.under_maintenance ? 0 : Math.max(0, Number(r.capacity) - Number(r.occupied)), status: roomStatus(r) }));
      const beds = rows.reduce((s, r) => s + r.capacity, 0);
      const used = rows.reduce((s, r) => s + r.occupied, 0);
      return { rows, summary: [{ label: "Rooms", value: rows.length }, { label: "Beds", value: beds }, { label: "Occupied beds", value: used }, { label: "Occupancy rate", value: beds ? `${Math.round((used / beds) * 100)}%` : "0%" }] };
    }
  },

  allocation: {
    title: "Room allocation report", roles: ["warden", "administrator", "management"], filters: ["block"],
    description: "Which student lives in which room and bed.",
    columns: [{ key: "student", label: "Student", width: 1.2 }, { key: "name", label: "Name", width: 2 }, { key: "faculty", label: "Faculty", width: 1.6 }, { key: "room", label: "Room", width: 1 }, { key: "bed", label: "Bed", width: 0.6, align: "right" }, { key: "checkin", label: "Check-in", width: 1.1 }, { key: "checkout", label: "Check-out", width: 1.1 }, { key: "status", label: "Status", width: 1 }],
    async run(f) {
      const c = filterClause(f, { block: "s.room_block" });
      const r = (await pool.query(
        `SELECT s.student_number, s.full_name, s.faculty, s.room_block, s.room_floor, s.room_number, s.student_status,
                to_char(s.check_in_date, 'YYYY-MM-DD') AS check_in, to_char(s.check_out_date, 'YYYY-MM-DD') AS check_out,
                (SELECT MIN(b.bed_number) FROM beds b WHERE b.student_number = s.student_number) AS bed
         FROM students s ${c.sql} ORDER BY s.room_block, s.room_floor, s.room_number, s.full_name`, c.params)).rows;
      const rows = r.map((s) => ({ student: s.student_number, name: s.full_name, faculty: s.faculty || "", room: roomId(s.room_block, s.room_floor, s.room_number), bed: s.bed || "", checkin: s.check_in || "", checkout: s.check_out || "", status: s.student_status || "Active" }));
      return { rows, summary: [{ label: "Students", value: rows.length }, { label: "Living in hostel", value: rows.filter((x) => x.status === "Active").length }] };
    }
  },

  items: {
    title: "Item list report", roles: ["warden", "administrator", "management"], filters: ["block", "condition"],
    description: "All university items with condition, repair cost and damage count.",
    columns: [{ key: "code", label: "Item code", width: 1.4 }, { key: "name", label: "Item", width: 1.4 }, { key: "room", label: "Room", width: 1 }, { key: "condition", label: "Condition", width: 1 }, { key: "status", label: "Status", width: 1 }, { key: "damages", label: "Damages", width: 0.8, align: "right" }, { key: "repairs", label: "Repair cost (RM)", width: 1.2, align: "right" }],
    async run(f) {
      const c = filterClause(f, { block: "p.room_block", extra: (w, p) => { if (f.condition) { p.push(f.condition); w.push(`p.item_condition = $${p.length}`); } } });
      const r = (await pool.query(
        `SELECT p.item_code, p.item_name, p.room_block, p.room_floor, p.room_number, p.item_condition, p.status, p.repair_cost_total,
                (SELECT COUNT(*) FROM damage_reports d WHERE d.property_id = p.property_id) AS damages
         FROM properties p ${c.sql} ORDER BY p.room_block, p.room_floor, p.room_number, p.item_name`, c.params)).rows;
      const rows = r.map((i) => ({ code: i.item_code, name: i.item_name, room: roomId(i.room_block, i.room_floor, i.room_number), condition: i.item_condition, status: i.status, damages: Number(i.damages), repairs: money(i.repair_cost_total) }));
      return { rows, summary: [{ label: "Items", value: rows.length }, { label: "Not in good condition", value: rows.filter((x) => x.condition !== "Good").length }] };
    }
  },

  damage: {
    title: "Damage report", roles: ["warden", "administrator", "management"], filters: ["block", "from", "to"],
    description: "Damage reports with type, cost and fine status.",
    columns: [{ key: "no", label: "Report", width: 1.3 }, { key: "date", label: "Date", width: 1 }, { key: "room", label: "Room", width: 1 }, { key: "item", label: "Item", width: 1.2 }, { key: "student", label: "Student", width: 1.1 }, { key: "type", label: "Type", width: 1.4 }, { key: "status", label: "Status", width: 1.1 }, { key: "cost", label: "Cost (RM)", width: 1, align: "right" }, { key: "fine", label: "Fine (RM)", width: 1, align: "right" }, { key: "fstatus", label: "Fine status", width: 1 }],
    async run(f) {
      const c = filterClause(f, { block: "d.room_block", dateCol: "d.created_at" });
      const r = (await pool.query(
        `SELECT d.report_number, to_char(d.created_at, 'YYYY-MM-DD') AS reported_on, d.room_block, d.room_floor, d.room_number, d.item_name,
                d.student_number, d.damage_type, d.damage_status, d.repair_cost, d.replacement_cost, d.fine_amount, d.fine_status
         FROM damage_reports d ${c.sql} ORDER BY d.damage_id DESC`, c.params)).rows;
      const rows = r.map((d) => ({ no: d.report_number, date: d.reported_on, room: roomId(d.room_block, d.room_floor, d.room_number), item: d.item_name, student: d.student_number, type: d.damage_type || "-", status: d.damage_status || "Reported", cost: money(Number(d.replacement_cost) > 0 ? d.replacement_cost : d.repair_cost), fine: money(d.fine_amount), fstatus: d.fine_status }));
      const confirmed = r.filter((d) => d.damage_status === "Confirmed");
      const total = confirmed.reduce((s, d) => s + Number(Number(d.replacement_cost) > 0 ? d.replacement_cost : d.repair_cost || 0), 0);
      return { rows, summary: [{ label: "Reports", value: rows.length }, { label: "Confirmed", value: confirmed.length }, { label: "Total damage cost (confirmed)", value: `RM ${money(total)}` }] };
    }
  },

  repairs: {
    title: "Repair report", roles: ["warden", "administrator", "management"], filters: ["block", "from", "to"],
    description: "Repair requests, who did them, how long they took and what they cost.",
    columns: [{ key: "no", label: "Request", width: 1.3 }, { key: "date", label: "Reported", width: 1 }, { key: "room", label: "Room", width: 1 }, { key: "item", label: "Item", width: 1.2 }, { key: "priority", label: "Priority", width: 0.9 }, { key: "status", label: "Status", width: 1 }, { key: "who", label: "Assigned to", width: 1.4 }, { key: "hours", label: "Hours", width: 0.7, align: "right" }, { key: "cost", label: "Cost (RM)", width: 1, align: "right" }],
    async run(f) {
      const c = filterClause(f, { block: "r.room_block", dateCol: "r.created_at" });
      const r = (await pool.query(
        `SELECT r.request_number, to_char(r.created_at, 'YYYY-MM-DD') AS reported_on, r.room_block, r.room_floor, r.room_number, r.item_name,
                r.priority, r.repair_status, r.assigned_name, r.repair_cost, r.created_at, r.completed_at
         FROM repair_requests r ${c.sql} ORDER BY r.repair_id DESC`, c.params)).rows;
      const hours = (row) => {
        if (row.repair_status !== "Completed" || !row.completed_at) return null;
        const toDate = (v) => (v instanceof Date ? v : new Date(/[zZ]|[+-]\d\d(:?\d\d)?$/.test(String(v)) ? String(v).replace(" ", "T") : String(v).replace(" ", "T") + "Z"));
        const h = (toDate(row.completed_at) - toDate(row.created_at)) / 36e5;
        return Number.isFinite(h) ? Math.round(h * 10) / 10 : null;
      };
      const rows = r.map((x) => ({ no: x.request_number, date: x.reported_on, room: roomId(x.room_block, x.room_floor, x.room_number), item: x.item_name, priority: x.priority, status: x.repair_status, who: x.assigned_name || "", hours: hours(x) ?? "", cost: money(x.repair_cost) }));
      const done = rows.filter((x) => x.status === "Completed");
      const timed = done.filter((x) => x.hours !== "");
      return { rows, summary: [{ label: "Requests", value: rows.length }, { label: "Open", value: rows.length - done.length }, { label: "Finished", value: done.length }, { label: "Average time to finish", value: timed.length ? `${(timed.reduce((s, x) => s + Number(x.hours), 0) / timed.length).toFixed(1)} hours` : "-" }, { label: "Total repair cost", value: `RM ${money(rows.reduce((s, x) => s + Number(x.cost), 0))}` }] };
    }
  },

  fines_fees: {
    title: "Fines and fees report", roles: ["administrator", "management"], filters: ["block", "from", "to"],
    description: "Every fine and fee with what was paid and what is still owed.",
    columns: [{ key: "type", label: "Type", width: 1.2 }, { key: "no", label: "Number", width: 1.4 }, { key: "student", label: "Student", width: 1.2 }, { key: "desc", label: "Description", width: 2 }, { key: "due", label: "Due", width: 1 }, { key: "amount", label: "Amount (RM)", width: 1.1, align: "right" }, { key: "paid", label: "Paid (RM)", width: 1.1, align: "right" }, { key: "balance", label: "Balance (RM)", width: 1.1, align: "right" }, { key: "status", label: "Status", width: 1 }],
    async run(f) {
      const fineWhere = filterClause(f, { dateCol: "fi.created_at", extra: (w, p) => { if (f.block) { p.push(f.block); w.push(`d.room_block = $${p.length}`); } } });
      const fines = (await pool.query(
        `SELECT fi.fine_number, fi.student_number, fi.item_name, fi.amount, fi.status, to_char(fi.due_date, 'YYYY-MM-DD') AS due,
                (SELECT CAST(COALESCE(SUM(p.amount), 0) AS FLOAT) FROM payments p WHERE p.fine_id = fi.fine_id AND p.kind = 'Payment') AS paid
         FROM fines fi JOIN damage_reports d ON d.damage_id = fi.damage_id ${fineWhere.sql} ORDER BY fi.fine_id DESC`, fineWhere.params)).rows;

      const feeParams = [];
      const feeWhere = [];
      if (f.from) { feeParams.push(f.from); feeWhere.push(`to_char(fe.created_at, 'YYYY-MM-DD') >= $${feeParams.length}`); }
      if (f.to) { feeParams.push(f.to); feeWhere.push(`to_char(fe.created_at, 'YYYY-MM-DD') <= $${feeParams.length}`); }
      if (f.block) { feeParams.push(f.block); feeWhere.push(`s.room_block = $${feeParams.length}`); }
      const fees = (await pool.query(
        `SELECT fe.invoice_number, fe.student_number, fe.fee_type, fe.description, fe.amount, fe.status, to_char(fe.due_date, 'YYYY-MM-DD') AS due,
                (SELECT CAST(COALESCE(SUM(p.amount), 0) AS FLOAT) FROM payments p WHERE p.fee_id = fe.fee_id AND p.kind = 'Payment') AS paid
         FROM fees fe LEFT JOIN students s ON s.student_number = fe.student_number
         ${feeWhere.length ? "WHERE " + feeWhere.join(" AND ") : ""} ORDER BY fe.fee_id DESC`, feeParams)).rows;

      const rows = [
        ...fines.map((x) => ({ type: "Fine", no: x.fine_number, student: x.student_number, desc: x.item_name || "", due: x.due, amount: money(x.amount), paid: money(x.paid), balance: ["Paid", "Waived"].includes(x.status) ? "0.00" : money(Number(x.amount) - Number(x.paid)), status: x.status })),
        ...fees.map((x) => ({ type: x.fee_type, no: x.invoice_number, student: x.student_number, desc: x.description || "", due: x.due, amount: money(x.amount), paid: money(x.paid), balance: x.status === "Cancelled" ? "0.00" : money(Number(x.amount) - Number(x.paid)), status: x.status }))
      ];
      const sum = (key, kind) => rows.filter((x) => kind(x)).reduce((s, x) => s + Number(x[key]), 0);
      return { rows, summary: [
        { label: "Fines issued", value: `RM ${money(sum("amount", (x) => x.type === "Fine" && x.status !== "Waived"))}` },
        { label: "Fines paid", value: `RM ${money(sum("paid", (x) => x.type === "Fine"))}` },
        { label: "Fees invoiced", value: `RM ${money(sum("amount", (x) => x.type !== "Fine" && x.status !== "Cancelled"))}` },
        { label: "Fees paid", value: `RM ${money(sum("paid", (x) => x.type !== "Fine"))}` }
      ] };
    }
  },

  unpaid: {
    title: "Unpaid payments report", roles: ["administrator", "management"], filters: [],
    description: "Everything that is still owed, with overdue items first.",
    columns: [{ key: "type", label: "Type", width: 1.2 }, { key: "no", label: "Number", width: 1.4 }, { key: "student", label: "Student", width: 1.2 }, { key: "name", label: "Name", width: 2 }, { key: "due", label: "Due", width: 1 }, { key: "days", label: "Days late", width: 0.8, align: "right" }, { key: "balance", label: "Balance (RM)", width: 1.2, align: "right" }],
    async run() {
      const fees = (await pool.query(
        `SELECT fe.invoice_number AS no, fe.student_number, fe.fee_type AS type, to_char(fe.due_date, 'YYYY-MM-DD') AS due, fe.amount, s.full_name,
                (SELECT CAST(COALESCE(SUM(p.amount), 0) AS FLOAT) FROM payments p WHERE p.fee_id = fe.fee_id AND p.kind = 'Payment') AS paid
         FROM fees fe LEFT JOIN students s ON s.student_number = fe.student_number WHERE fe.status IN ('Unpaid', 'Partially paid')`)).rows;
      const fines = (await pool.query(
        `SELECT fi.fine_number AS no, fi.student_number, 'Fine' AS type, to_char(fi.due_date, 'YYYY-MM-DD') AS due, fi.amount, s.full_name,
                (SELECT CAST(COALESCE(SUM(p.amount), 0) AS FLOAT) FROM payments p WHERE p.fine_id = fi.fine_id AND p.kind = 'Payment') AS paid
         FROM fines fi LEFT JOIN students s ON s.student_number = fi.student_number WHERE fi.status = 'Approved'`)).rows;

      const t = today();
      const daysLate = (due) => Math.max(0, Math.round((new Date(`${t}T00:00:00Z`) - new Date(`${due}T00:00:00Z`)) / 864e5));
      const rows = [...fees, ...fines]
        .map((x) => ({ type: x.type, no: x.no, student: x.student_number, name: x.full_name || "", due: x.due, days: daysLate(x.due), balance: money(Number(x.amount) - Number(x.paid)) }))
        .filter((x) => Number(x.balance) > 0)
        .sort((a, b) => b.days - a.days);
      const total = rows.reduce((s, x) => s + Number(x.balance), 0);
      return { rows, summary: [{ label: "Unpaid items", value: rows.length }, { label: "Overdue items", value: rows.filter((x) => x.days > 0).length }, { label: "Total owed", value: `RM ${money(total)}` }] };
    }
  },

  replacement: {
    title: "Item replacement report", roles: ["administrator", "management"], filters: ["block"],
    description: "Broken, replaced and retired items and what replacing them costs.",
    columns: [{ key: "code", label: "Item code", width: 1.4 }, { key: "name", label: "Item", width: 1.4 }, { key: "room", label: "Room", width: 1 }, { key: "condition", label: "Condition", width: 1 }, { key: "status", label: "Status", width: 1 }, { key: "repairs", label: "Repairs so far (RM)", width: 1.3, align: "right" }, { key: "cost", label: "Replacement (RM)", width: 1.3, align: "right" }],
    async run(f) {
      const c = filterClause(f, { block: "p.room_block", extra: (w) => w.push("(p.item_condition = 'Broken' OR p.status IN ('Replaced', 'Retired'))") });
      const r = (await pool.query(
        `SELECT p.item_code, p.item_name, p.room_block, p.room_floor, p.room_number, p.item_condition, p.status, p.repair_cost_total, p.replacement_cost
         FROM properties p ${c.sql} ORDER BY p.status, p.room_block, p.room_floor, p.room_number`, c.params)).rows;
      const rows = r.map((i) => ({ code: i.item_code, name: i.item_name, room: roomId(i.room_block, i.room_floor, i.room_number), condition: i.item_condition, status: i.status, repairs: money(i.repair_cost_total), cost: money(i.replacement_cost) }));
      const needing = r.filter((i) => i.item_condition === "Broken" && !["Replaced", "Retired"].includes(i.status));
      return { rows, summary: [{ label: "Items listed", value: rows.length }, { label: "Broken, waiting for replacement", value: needing.length }, { label: "Cost to replace those", value: `RM ${money(needing.reduce((s, i) => s + Number(i.replacement_cost), 0))}` }] };
    }
  },

  monthly: {
    title: "Monthly summary", roles: ["administrator", "management"], filters: ["month"],
    description: "Key numbers for one month (for management).",
    columns: [{ key: "metric", label: "Measure", width: 3 }, { key: "value", label: "Value", width: 1.5, align: "right" }],
    async run(f) {
      const period = /^\d{4}-\d{2}$/.test(String(f.month || "")) ? f.month : today().slice(0, 7);
      const one = async (sql) => Number((await pool.query(sql, [period])).rows[0].n || 0);
      const val = async (sql) => cents((await pool.query(sql, [period])).rows[0].n || 0);

      const completed = (await pool.query("SELECT created_at, completed_at FROM repair_requests WHERE repair_status = 'Completed' AND to_char(completed_at, 'YYYY-MM') = $1", [period])).rows;
      const toDate = (v) => (v instanceof Date ? v : new Date(/[zZ]|[+-]\d\d(:?\d\d)?$/.test(String(v)) ? String(v).replace(" ", "T") : String(v).replace(" ", "T") + "Z"));
      const hours = completed.map((r) => (toDate(r.completed_at) - toDate(r.created_at)) / 36e5).filter(Number.isFinite);

      const rooms = (await pool.query("SELECT CAST(COALESCE(SUM(capacity), 0) AS INTEGER) AS beds, CAST(COALESCE(SUM(occupied), 0) AS INTEGER) AS used FROM rooms")).rows[0];

      const rows = [
        { metric: "New residents (check-in)", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM students WHERE to_char(check_in_date, 'YYYY-MM') = $1") },
        { metric: "Residents who checked out", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM students WHERE to_char(check_out_date, 'YYYY-MM') = $1") },
        { metric: "Check-in inspections", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM inspections WHERE inspection_type = 'Check-in' AND to_char(inspection_date, 'YYYY-MM') = $1") },
        { metric: "Check-out inspections", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM inspections WHERE inspection_type = 'Check-out' AND to_char(inspection_date, 'YYYY-MM') = $1") },
        { metric: "Damage reports filed", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM damage_reports WHERE to_char(created_at, 'YYYY-MM') = $1") },
        { metric: "Damage reports confirmed", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM damage_reports WHERE to_char(confirmed_at, 'YYYY-MM') = $1 AND damage_status = 'Confirmed'") },
        { metric: "Fines approved (RM)", value: money(await val("SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS n FROM fines WHERE to_char(approved_at, 'YYYY-MM') = $1")) },
        { metric: "Money received (RM)", value: money(await val("SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS n FROM payments WHERE kind = 'Payment' AND method <> 'Deposit deduction' AND to_char(paid_at, 'YYYY-MM') = $1")) },
        { metric: "Deposits refunded (RM)", value: money(await val("SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS n FROM payments WHERE kind = 'Refund' AND to_char(paid_at, 'YYYY-MM') = $1")) },
        { metric: "Repair requests reported", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM repair_requests WHERE to_char(created_at, 'YYYY-MM') = $1") },
        { metric: "Repair requests finished", value: completed.length },
        { metric: "Average repair time (hours)", value: hours.length ? (hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(1) : "-" },
        { metric: "Repair cost (RM)", value: money(await val("SELECT CAST(COALESCE(SUM(repair_cost), 0) AS FLOAT) AS n FROM repair_requests WHERE to_char(completed_at, 'YYYY-MM') = $1")) },
        { metric: "Maintenance jobs completed", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM maintenance_requests WHERE to_char(completed_date, 'YYYY-MM') = $1") },
        { metric: "Incidents reported", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM incidents WHERE to_char(reported_at, 'YYYY-MM') = $1") },
        { metric: "Visitors", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM visitors WHERE to_char(visit_date, 'YYYY-MM') = $1") },
        { metric: "Complaints and feedback", value: await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM complaints WHERE to_char(created_at, 'YYYY-MM') = $1") },
        { metric: "Occupancy now", value: rooms.beds ? `${rooms.used} / ${rooms.beds} beds (${Math.round((rooms.used / rooms.beds) * 100)}%)` : "-" }
      ];
      return { rows, summary: [{ label: "Month", value: period }], period };
    }
  }
};

function cleanFilters(query) {
  const f = {};
  if (query.block) f.block = String(query.block).trim();
  if (query.condition) f.condition = String(query.condition).trim();
  if (query.from && isDate(String(query.from))) f.from = String(query.from);
  if (query.to && isDate(String(query.to))) f.to = String(query.to);
  if (query.month && /^\d{4}-\d{2}$/.test(String(query.month))) f.month = String(query.month);
  return f;
}

function describeFilters(f) {
  const parts = [];
  if (f.month) parts.push(`Month: ${f.month}`);
  if (f.block) parts.push(`Hostel: ${f.block}`);
  if (f.condition) parts.push(`Condition: ${f.condition}`);
  if (f.from) parts.push(`From: ${f.from}`);
  if (f.to) parts.push(`To: ${f.to}`);
  return parts.length ? parts.join("   |   ") : "All records";
}

async function runReport(key, filters = {}) {
  const def = REPORTS[key];
  if (!def) return null;
  const out = await def.run(filters);
  return { key, title: def.title, columns: def.columns, filters, subtitle: describeFilters(filters), ...out };
}

function toPdf(report) {
  const columns = report.columns.map((c) => ({ ...c }));
  return tablePdf({ title: report.title, subtitle: report.subtitle, columns, rows: report.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]))), summary: report.summary });
}

function toXlsx(report) {
  const columns = report.columns.map((c) => ({ key: c.key, label: c.label }));
  const rows = report.rows.map((r) => {
    const out = {};
    for (const c of columns) {
      const v = r[c.key];
      out[c.key] = typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && /\(RM\)|Hours|Beds|Used|Free|Damages|Days/.test(report.columns.find((x) => x.key === c.key).label) ? Number(v) : v;
    }
    return out;
  });
  const summary = (report.summary || []).map((s) => `${s.label}: ${s.value}`).join("   |   ");
  return workbookBuffer([{ name: report.title, title: `${report.title}${summary ? "   -   " + summary : ""}`, columns, rows }]);
}

module.exports = { REPORTS, runReport, cleanFilters, toPdf, toXlsx };
