const express = require("express");
const pool = require("../db");
const { bad, notFound, forbidden, conflict } = require("../lib/http");
const { text, oneOf, money, date, int, today, businessNumber, clean } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { notifyStudent } = require("../lib/notify");
const { cents, createFee, depositSummary } = require("../lib/billing");
const { documentPdf } = require("../lib/pdf");
const F = require("../lib/fines");

const feesRouter = express.Router();
const paymentsRouter = express.Router();
const depositsRouter = express.Router();

const FEE_TYPES = ["Hostel fee", "Security deposit", "Other"];
const METHODS = ["Cash", "Bank transfer", "Card", "Online", "Deposit deduction"];
const VIEW = ["administrator", "management", "student"];

const money2 = (n) => `RM ${Number(n || 0).toFixed(2)}`;
const sendPdf = (res, name, buffer) => {
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Content-Length": buffer.length });
  res.send(buffer);
};

/* ============================ FEES ============================ */

const FEE_SELECT = `
  SELECT f.fee_id, f.invoice_number, f.student_number, f.fee_type, f.description, f.amount,
         to_char(f.due_date, 'YYYY-MM-DD') AS due_date, f.status, f.created_at, s.full_name AS student_name,
         (SELECT CAST(COALESCE(SUM(p.amount), 0) AS FLOAT) FROM payments p WHERE p.fee_id = f.fee_id AND p.kind = 'Payment') AS paid
  FROM fees f LEFT JOIN students s ON s.student_number = f.student_number`;

function presentFee(row) {
  const amount = cents(row.amount);
  const paid = cents(row.paid);
  const open = !["Paid", "Cancelled"].includes(row.status);
  return { ...row, amount, paid, balance: row.status === "Cancelled" ? 0 : cents(amount - paid), overdue: open && row.due_date < today() };
}

async function loadFee(id) {
  const r = await pool.query(`${FEE_SELECT} WHERE f.fee_id = $1`, [id]);
  if (!r.rows.length) throw notFound("Fee not found.");
  return presentFee(r.rows[0]);
}

feesRouter.get("/", requireRole(...VIEW), async (req, res) => {
  const params = [];
  const where = [];

  if (req.user.role === "student") { params.push(req.user.studentNumber || ""); where.push(`f.student_number = $${params.length}`); }
  else if (req.query.student_number) { params.push(clean(req.query.student_number)); where.push(`f.student_number = $${params.length}`); }
  if (req.query.status) { params.push(clean(req.query.status)); where.push(`f.status = $${params.length}`); }
  if (req.query.type) { params.push(clean(req.query.type)); where.push(`f.fee_type = $${params.length}`); }

  const result = await pool.query(`${FEE_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY f.fee_id DESC LIMIT 1000`, params);
  res.json(result.rows.map(presentFee));
});

/* POST /api/fees — issue a fee to one student, a hostel block or every resident */
feesRouter.post("/", requireRole("administrator"), async (req, res) => {
  const b = req.body || {};
  const feeType = oneOf(b.fee_type, FEE_TYPES, "Fee type");
  const amount = money(b.amount, "Amount", { allowZero: false });
  const due = date(b.due_date, "Due date", { required: true });
  const description = text(b.description, "Description", { max: 200 });
  const scope = oneOf(b.scope || "student", ["student", "block", "all"], "Who to charge");

  let students;
  if (scope === "student") {
    const s = await pool.query("SELECT student_number FROM students WHERE student_number = $1", [clean(b.student_number)]);
    if (!s.rows.length) throw bad("Student not found.");
    students = s.rows;
  } else if (scope === "block") {
    students = (await pool.query("SELECT student_number FROM students WHERE room_block = $1 AND (student_status IS NULL OR student_status = 'Active')", [clean(b.block)])).rows;
  } else {
    students = (await pool.query("SELECT student_number FROM students WHERE student_status IS NULL OR student_status = 'Active'")).rows;
  }
  if (!students.length) throw bad("There are no students to charge.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const s of students) {
      await createFee(client, { student_number: s.student_number, fee_type: feeType, description, amount, due_date: due, created_by: req.user.id });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const s of students) {
    await notifyStudent(s.student_number, { title: "New invoice", message: `${feeType}: ${money2(amount)} due on ${due}.`, type: "fee", page: "fees" });
  }
  await audit(req, "create_fee", "fee", feeType, { scope, count: students.length, amount });

  res.status(201).json({ message: `${students.length} invoice${students.length === 1 ? "" : "s"} issued.`, count: students.length });
});

feesRouter.post("/:id/cancel", requireRole("administrator"), async (req, res) => {
  const fee = await loadFee(int(req.params.id, "Fee"));
  if (fee.paid > 0) throw conflict("This fee already has payments and cannot be cancelled.");
  if (fee.status === "Cancelled") throw conflict("This fee is already cancelled.");

  await pool.query("UPDATE fees SET status = 'Cancelled' WHERE fee_id = $1", [fee.fee_id]);
  await audit(req, "cancel_fee", "fee", fee.invoice_number);
  res.json({ message: "Fee cancelled." });
});

feesRouter.get("/:id/invoice", requireRole(...VIEW), async (req, res) => {
  const fee = await loadFee(int(req.params.id, "Fee"));
  if (req.user.role === "student" && fee.student_number !== req.user.studentNumber) throw forbidden();

  const payments = (await pool.query("SELECT receipt_number, amount, method, paid_at FROM payments WHERE fee_id = $1 AND kind = 'Payment' ORDER BY payment_id", [fee.fee_id])).rows;

  sendPdf(res, `${fee.invoice_number}.pdf`, documentPdf({
    title: "Invoice",
    subtitle: `Invoice ${fee.invoice_number}`,
    lines: [
      { label: "Student", value: `${fee.student_number}${fee.student_name ? " - " + fee.student_name : ""}` },
      { label: "Fee type", value: fee.fee_type },
      { label: "Description", value: fee.description || "-" },
      { label: "Due date", value: fee.due_date },
      { label: "Status", value: fee.status },
      { label: "Amount", value: money2(fee.amount), bold: true },
      { label: "Paid", value: money2(fee.paid) },
      { label: "Balance", value: money2(fee.balance), bold: true }
    ],
    table: payments.length ? {
      columns: [{ key: "receipt", label: "Receipt", width: 2 }, { key: "method", label: "Method", width: 2 }, { key: "date", label: "Date", width: 2 }, { key: "amount", label: "Amount (RM)", width: 1.5, align: "right" }],
      rows: payments.map((p) => ({ receipt: p.receipt_number, method: p.method, date: String(p.paid_at).slice(0, 10), amount: Number(p.amount).toFixed(2) }))
    } : null,
    notes: ["Refundable deposits are returned after check-out, less any approved fines."]
  }));
});

/* ============================ PAYMENTS ============================ */

const PAY_SELECT = `
  SELECT p.payment_id, p.receipt_number, p.student_number, p.fee_id, p.fine_id, p.kind, p.amount, p.method, p.reference,
         p.note, p.recorded_by_name, p.paid_at, f.invoice_number, fn.fine_number, f.fee_type, s.full_name AS student_name
  FROM payments p
  LEFT JOIN fees f ON f.fee_id = p.fee_id
  LEFT JOIN fines fn ON fn.fine_id = p.fine_id
  LEFT JOIN students s ON s.student_number = p.student_number`;

paymentsRouter.get("/", requireRole(...VIEW), async (req, res) => {
  const params = [];
  const where = [];
  if (req.user.role === "student") { params.push(req.user.studentNumber || ""); where.push(`p.student_number = $${params.length}`); }
  else if (req.query.student_number) { params.push(clean(req.query.student_number)); where.push(`p.student_number = $${params.length}`); }

  const result = await pool.query(`${PAY_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.payment_id DESC LIMIT 1000`, params);
  res.json(result.rows.map((p) => ({ ...p, amount: cents(p.amount) })));
});

/* POST /api/payments — record money received for a fee or a fine */
paymentsRouter.post("/", requireRole("administrator"), async (req, res) => {
  const b = req.body || {};
  const method = oneOf(b.method, METHODS, "Payment method");
  const feeId = b.fee_id ? int(b.fee_id, "Fee") : null;
  const fineId = b.fine_id ? int(b.fine_id, "Fine") : null;

  if ((feeId && fineId) || (!feeId && !fineId)) throw bad("Choose either a fee or a fine to pay.");

  const options = { amount: money(b.amount, "Amount", { allowZero: false }), method, reference: text(b.reference, "Reference", { max: 80 }), note: text(b.note, "Note", { max: 200 }), user: req.user };
  const client = await pool.connect();
  let payment;
  let studentNumber;
  let paidInFull = false;

  try {
    await client.query("BEGIN");

    if (fineId) {
      const fine = (await client.query("SELECT * FROM fines WHERE fine_id = $1 FOR UPDATE", [fineId])).rows[0];
      if (!fine) throw notFound("Fine not found.");
      studentNumber = fine.student_number;
      payment = await F.payFine(client, fine, options);
      paidInFull = (await client.query("SELECT status FROM fines WHERE fine_id = $1", [fineId])).rows[0].status === "Paid";
    } else {
      const fee = (await client.query("SELECT * FROM fees WHERE fee_id = $1 FOR UPDATE", [feeId])).rows[0];
      if (!fee) throw notFound("Fee not found.");
      studentNumber = fee.student_number;
      payment = await F.payFee(client, fee, options);
      paidInFull = (await client.query("SELECT status FROM fees WHERE fee_id = $1", [feeId])).rows[0].status === "Paid";
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await notifyStudent(studentNumber, { title: "Payment received", message: `${money2(payment.amount)} received (${payment.method}). Receipt ${payment.receipt_number}.`, type: "payment", page: "fees", related_id: payment.payment_id });
  await audit(req, "payment", "payment", payment.receipt_number, { amount: payment.amount, method, fee_id: feeId, fine_id: fineId });

  res.status(201).json({
    message: paidInFull ? "Payment recorded — fully paid. Receipt created." : "Payment recorded. Receipt created.",
    payment: { ...payment, amount: cents(payment.amount) },
    fully_paid: paidInFull
  });
});

paymentsRouter.get("/:id/receipt", requireRole(...VIEW), async (req, res) => {
  const r = await pool.query(`${PAY_SELECT} WHERE p.payment_id = $1`, [int(req.params.id, "Payment")]);
  if (!r.rows.length) throw notFound("Payment not found.");

  const p = r.rows[0];
  if (req.user.role === "student" && p.student_number !== req.user.studentNumber) throw forbidden();

  sendPdf(res, `${p.receipt_number}.pdf`, documentPdf({
    title: p.kind === "Refund" ? "Refund receipt" : "Payment receipt",
    subtitle: `Receipt ${p.receipt_number}`,
    lines: [
      { label: "Student", value: `${p.student_number}${p.student_name ? " - " + p.student_name : ""}` },
      { label: "For", value: p.fine_number ? `Fine ${p.fine_number}` : p.invoice_number ? `${p.fee_type} (invoice ${p.invoice_number})` : "Deposit refund" },
      { label: "Method", value: p.method },
      { label: "Reference", value: p.reference || "-" },
      { label: "Date", value: String(p.paid_at).slice(0, 16).replace("T", " ") },
      { label: "Recorded by", value: p.recorded_by_name || "-" },
      { label: p.kind === "Refund" ? "Amount refunded" : "Amount received", value: money2(p.amount), bold: true }
    ],
    notes: ["This receipt was generated by the Hostel Management System."]
  }));
});

/* ============================ DEPOSITS ============================ */

depositsRouter.get("/", requireRole("administrator", "management"), async (req, res) => {
  const students = (await pool.query(
    `SELECT DISTINCT s.student_number, s.full_name, s.student_status FROM students s
     JOIN fees f ON f.student_number = s.student_number AND f.fee_type = 'Security deposit' AND f.status <> 'Cancelled'
     ORDER BY s.full_name LIMIT 500`)).rows;

  const rows = [];
  for (const s of students) rows.push({ ...s, ...(await depositSummary(pool, s.student_number)) });
  res.json(rows);
});

depositsRouter.get("/:studentNumber", requireRole("administrator", "management", "student"), async (req, res) => {
  if (req.user.role === "student" && req.params.studentNumber !== req.user.studentNumber) throw forbidden();
  const summary = await depositSummary(pool, req.params.studentNumber);
  res.json({ ...summary, refundable: Math.max(0, cents(summary.balance - summary.unpaid_fines)) });
});

/* POST /api/deposits/:studentNumber/settle — take approved fines from the deposit, refund the rest */
depositsRouter.post("/:studentNumber/settle", requireRole("administrator"), async (req, res) => {
  const number = req.params.studentNumber;
  const student = (await pool.query("SELECT student_status, full_name FROM students WHERE student_number = $1", [number])).rows[0];
  if (!student) throw notFound("Student not found.");
  if (!student.student_status || student.student_status === "Active") throw conflict("The student must check out before the deposit can be settled.");

  const method = oneOf((req.body && req.body.refund_method) || "Bank transfer", ["Cash", "Bank transfer", "Online"], "Refund method");
  const client = await pool.connect();
  let deducted = 0;
  let refunded = 0;
  let outstanding = 0;
  let refund = null;

  try {
    await client.query("BEGIN");

    const fines = (await client.query("SELECT * FROM fines WHERE student_number = $1 AND status = 'Approved' ORDER BY due_date, fine_id", [number])).rows;
    for (const fine of fines) {
      const summary = await depositSummary(client, number);
      const remaining = cents(Number(fine.amount) - await F.paidSoFar(client, fine.fine_id));
      const take = Math.min(summary.balance, remaining);
      if (take > 0) {
        await F.payFine(client, fine, { amount: take, method: "Deposit deduction", note: "Deducted from the security deposit at check-out", user: req.user });
        deducted = cents(deducted + take);
      }
    }

    const after = await depositSummary(client, number);
    outstanding = after.unpaid_fines;
    refunded = Math.max(0, after.balance);

    if (refunded > 0) {
      refund = (await client.query(
        `INSERT INTO payments (receipt_number, student_number, kind, amount, method, note, recorded_by, recorded_by_name, paid_at, created_at)
         VALUES ($1, $2, 'Refund', $3, $4, 'Security deposit refund after check-out', $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`, [businessNumber("RFD"), number, refunded, method, req.user.id, req.user.name])).rows[0];
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await notifyStudent(number, { title: "Deposit settled", message: `Deducted ${money2(deducted)} for fines. Refund: ${money2(refunded)}.`, type: "payment", page: "fees" });
  await audit(req, "settle_deposit", "student", number, { deducted, refunded, outstanding });

  res.json({
    message: refunded > 0 ? `Deposit settled: ${money2(deducted)} deducted, ${money2(refunded)} refunded.` : `Deposit settled: ${money2(deducted)} deducted, nothing left to refund.`,
    deducted, refunded, outstanding_fines: outstanding, refund_payment_id: refund ? refund.payment_id : null
  });
});

module.exports = { feesRouter, paymentsRouter, depositsRouter };
