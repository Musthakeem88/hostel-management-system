/* Fine and payment rules shared by the damage, fine and payment routes.
   `db` is a transaction client. */
const { bad, conflict } = require("./http");
const { businessNumber, today, addDays } = require("./validate");
const { cents, sumPayments, depositSummary, refreshFeeStatus } = require("./billing");
const { getNumberSetting } = require("./settings");

const DAMAGE_TYPES = ["Normal wear", "Accidental damage", "Confirmed vandalism"];

// University rule of thumb: normal wear is never fined, accidents pay the repair, vandalism pays the replacement
function suggestedFine(type, repairCost, replacementCost) {
  if (type === "Normal wear") return 0;
  if (type === "Confirmed vandalism") return cents(replacementCost || repairCost);
  return cents(repairCost || 0);
}

async function setDamageFineStatus(db, damageId, status, extra = {}) {
  await db.query(
    `UPDATE damage_reports SET fine_status = $1, fine_amount = COALESCE($2, fine_amount),
            dispute_reason = COALESCE($3, dispute_reason) WHERE damage_id = $4`,
    [status, extra.amount ?? null, extra.disputeReason ?? null, damageId]
  );
}

async function fineByDamage(db, damageId) {
  return (await db.query("SELECT * FROM fines WHERE damage_id = $1", [damageId])).rows[0] || null;
}

/* Administrator approves a fine for confirmed damage */
async function createFine(db, damage, { amount, reason, dueDate, note, user }) {
  if (damage.damage_status !== "Confirmed") throw conflict("Confirm the damage first — a fine can only be approved for confirmed damage.");
  if (damage.damage_type === "Normal wear") throw conflict("Normal wear cannot be fined.");
  if (await fineByDamage(db, damage.damage_id)) throw conflict("A fine already exists for this damage report.");

  const value = cents(amount);
  if (!(value > 0)) throw bad("The fine amount must be more than zero.");
  if (!String(reason || "").trim()) throw bad("Give the reason for the fine.");

  const days = await getNumberSetting("fine_due_days", 14, db);
  const due = dueDate || addDays(today(), days);

  const fine = (await db.query(
    `INSERT INTO fines (fine_number, damage_id, student_number, item_name, reason, amount, due_date, status,
                        approved_by, approved_by_name, approved_at, approval_note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Approved', $8, $9, CURRENT_TIMESTAMP, $10, CURRENT_TIMESTAMP)
     RETURNING *`,
    [businessNumber("FIN"), damage.damage_id, damage.student_number, damage.item_name, String(reason).trim(), value, due,
     user.id, user.name, note || null]
  )).rows[0];

  await setDamageFineStatus(db, damage.damage_id, "Approved", { amount: value });
  return fine;
}

async function paidSoFar(db, fineId) {
  return sumPayments(db, "fine_id = $1", [fineId]);
}

/* Records a payment against a fine; marks it Paid when fully covered */
async function payFine(db, fine, { amount, method, reference, note, user }) {
  if (fine.status !== "Approved") {
    throw conflict(fine.status === "Paid" ? "This fine is already paid." : `A ${String(fine.status).toLowerCase()} fine cannot be paid yet.`);
  }

  const paid = await paidSoFar(db, fine.fine_id);
  const remaining = cents(Number(fine.amount) - paid);
  const value = cents(amount);

  if (!(value > 0)) throw bad("Enter the amount received.");
  if (value > remaining) throw bad(`The amount is more than the balance of RM ${remaining.toFixed(2)}.`);

  if (method === "Deposit deduction") {
    const deposit = await depositSummary(db, fine.student_number);
    if (value > deposit.balance) throw bad(`The student's deposit balance is only RM ${deposit.balance.toFixed(2)}.`);
  }

  const payment = (await db.query(
    `INSERT INTO payments (receipt_number, student_number, fine_id, kind, amount, method, reference, note,
                           recorded_by, recorded_by_name, paid_at, created_at)
     VALUES ($1, $2, $3, 'Payment', $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [businessNumber("RCT"), fine.student_number, fine.fine_id, value, method, reference || null, note || null, user.id, user.name]
  )).rows[0];

  if (value >= remaining) {
    await db.query("UPDATE fines SET status = 'Paid', paid_at = CURRENT_TIMESTAMP WHERE fine_id = $1", [fine.fine_id]);
    await setDamageFineStatus(db, fine.damage_id, "Paid");
  }

  return payment;
}

/* Records a payment against a fee (hostel fee, deposit...) and refreshes the fee status */
async function payFee(db, fee, { amount, method, reference, note, user }) {
  if (method === "Deposit deduction") throw bad("A deposit can only be used to pay fines.");
  if (fee.status === "Cancelled") throw conflict("This fee was cancelled.");
  if (fee.status === "Paid") throw conflict("This fee is already paid.");

  const paid = await sumPayments(db, "fee_id = $1", [fee.fee_id]);
  const remaining = cents(Number(fee.amount) - paid);
  const value = cents(amount);

  if (!(value > 0)) throw bad("Enter the amount received.");
  if (value > remaining) throw bad(`The amount is more than the balance of RM ${remaining.toFixed(2)}.`);

  const payment = (await db.query(
    `INSERT INTO payments (receipt_number, student_number, fee_id, kind, amount, method, reference, note,
                           recorded_by, recorded_by_name, paid_at, created_at)
     VALUES ($1, $2, $3, 'Payment', $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [businessNumber("RCT"), fee.student_number, fee.fee_id, value, method, reference || null, note || null, user.id, user.name]
  )).rows[0];

  await refreshFeeStatus(db, fee.fee_id);
  return payment;
}

module.exports = { DAMAGE_TYPES, suggestedFine, setDamageFineStatus, fineByDamage, createFine, payFine, payFee, paidSoFar };
