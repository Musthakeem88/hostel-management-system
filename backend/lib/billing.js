/* Fees, fines, payments and the security deposit. Amounts are rounded to cents everywhere.
   `db` is the pool, or a transaction client when called inside a transaction. */
const { businessNumber, today, addDays } = require("./validate");
const { getNumberSetting } = require("./settings");

const cents = (n) => Math.round(Number(n || 0) * 100) / 100;

async function sumPayments(db, where, params) {
  const r = await db.query(
    `SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS total FROM payments WHERE kind = 'Payment' AND ${where}`,
    params
  );
  return cents(r.rows[0].total);
}

async function createFee(db, { student_number, fee_type, description, amount, due_date, created_by }) {
  const r = await db.query(
    `INSERT INTO fees (invoice_number, student_number, fee_type, description, amount, due_date, status, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'Unpaid', $7, CURRENT_TIMESTAMP)
     RETURNING *`,
    [businessNumber("INV"), student_number, fee_type, description || null, cents(amount), due_date, created_by ?? null]
  );
  return r.rows[0];
}

// A new resident gets a deposit invoice and a hostel fee invoice (once each)
async function createAllocationFees(db, studentNumber, userId) {
  const created = [];
  const deposit = await getNumberSetting("deposit_amount", 300, db);
  const hostelFee = await getNumberSetting("hostel_fee_amount", 1200, db);
  const due = addDays(today(), 14);

  const has = async (type) => (await db.query(
    "SELECT 1 FROM fees WHERE student_number = $1 AND fee_type = $2 AND status <> 'Cancelled'", [studentNumber, type])).rows.length > 0;

  if (deposit > 0 && !(await has("Security deposit"))) {
    created.push(await createFee(db, { student_number: studentNumber, fee_type: "Security deposit", description: "Refundable security deposit", amount: deposit, due_date: due, created_by: userId }));
  }
  if (hostelFee > 0 && !(await has("Hostel fee"))) {
    created.push(await createFee(db, { student_number: studentNumber, fee_type: "Hostel fee", description: "Hostel accommodation fee", amount: hostelFee, due_date: due, created_by: userId }));
  }
  return created;
}

async function refreshFeeStatus(db, feeId) {
  const fee = (await db.query("SELECT amount, status FROM fees WHERE fee_id = $1", [feeId])).rows[0];
  if (!fee || fee.status === "Cancelled") return fee ? fee.status : null;

  const paid = await sumPayments(db, "fee_id = $1", [feeId]);
  const status = paid >= cents(fee.amount) ? "Paid" : paid > 0 ? "Partially paid" : "Unpaid";
  await db.query("UPDATE fees SET status = $1 WHERE fee_id = $2", [status, feeId]);
  return status;
}

async function depositSummary(db, studentNumber) {
  const paid = await db.query(
    `SELECT CAST(COALESCE(SUM(p.amount), 0) AS FLOAT) AS total
     FROM payments p JOIN fees f ON f.fee_id = p.fee_id
     WHERE p.kind = 'Payment' AND f.fee_type = 'Security deposit' AND p.student_number = $1`, [studentNumber]);
  const deductions = await db.query(
    `SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS total FROM payments
     WHERE kind = 'Payment' AND method = 'Deposit deduction' AND student_number = $1`, [studentNumber]);
  const refunds = await db.query(
    `SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS total FROM payments WHERE kind = 'Refund' AND student_number = $1`, [studentNumber]);
  const unpaid = await db.query(
    `SELECT CAST(COALESCE(SUM(amount), 0) AS FLOAT) AS total FROM fines
     WHERE student_number = $1 AND status IN ('Approved', 'Disputed', 'Under Review')`, [studentNumber]);

  const deposit_paid = cents(paid.rows[0].total);
  const deducted = cents(deductions.rows[0].total);
  const refunded = cents(refunds.rows[0].total);

  return {
    deposit_paid,
    deducted,
    refunded,
    balance: cents(deposit_paid - deducted - refunded),
    unpaid_fines: cents(unpaid.rows[0].total)
  };
}

module.exports = { cents, sumPayments, createFee, createAllocationFees, refreshFeeStatus, depositSummary };
