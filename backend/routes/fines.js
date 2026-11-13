const express = require("express");
const pool = require("../db");
const { bad, notFound, forbidden, conflict } = require("../lib/http");
const { text, oneOf, money, date, roomId, today, int } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { notifyRoles, notifyStudent } = require("../lib/notify");
const { fileUrl } = require("../lib/storage");
const { cents } = require("../lib/billing");
const F = require("../lib/fines");

const router = express.Router();
const VIEW = ["warden", "administrator", "management", "student"];

const SELECT = `
  SELECT f.fine_id, f.fine_number, f.damage_id, f.student_number, f.item_name, f.reason, f.amount, f.status,
         to_char(f.due_date, 'YYYY-MM-DD') AS due_date, f.approved_by_name, f.approved_at, f.approval_note,
         f.paid_at, f.waived_reason,
         d.report_number, d.room_block, d.room_floor, d.room_number, d.damage_type, d.description AS damage_description,
         (SELECT CAST(COALESCE(SUM(p.amount), 0) AS FLOAT) FROM payments p WHERE p.fine_id = f.fine_id AND p.kind = 'Payment') AS paid,
         (SELECT COUNT(*) FROM fine_appeals a WHERE a.fine_id = f.fine_id AND a.status = 'Open') AS open_appeals
  FROM fines f JOIN damage_reports d ON d.damage_id = f.damage_id`;

function present(row) {
  const amount = cents(row.amount);
  const paid = cents(row.paid);
  return {
    ...row,
    amount,
    paid,
    balance: row.status === "Paid" ? 0 : cents(amount - paid),
    open_appeals: Number(row.open_appeals),
    room_id: roomId(row.room_block, row.room_floor, row.room_number),
    overdue: row.status === "Approved" && row.due_date < today()
  };
}

async function load(id) {
  const r = await pool.query(`${SELECT} WHERE f.fine_id = $1`, [id]);
  if (!r.rows.length) throw notFound("Fine not found.");
  return present(r.rows[0]);
}

function mustSee(req, fine) {
  if (req.user.role === "student" && fine.student_number !== req.user.studentNumber) throw forbidden();
}

/* GET /api/fines */
router.get("/", requireRole(...VIEW), async (req, res) => {
  const isStudent = req.user.role === "student";
  const result = await pool.query(
    `${SELECT} ${isStudent ? "WHERE f.student_number = $1" : ""} ORDER BY f.fine_id DESC LIMIT 500`,
    isStudent ? [req.user.studentNumber || ""] : []
  );
  res.json(result.rows.map(present));
});

/* GET /api/fines/:id */
router.get("/:id", requireRole(...VIEW), async (req, res) => {
  const fine = await load(int(req.params.id, "Fine"));
  mustSee(req, fine);

  const evidence = await pool.query("SELECT file_id, caption FROM damage_evidence WHERE damage_id = $1 ORDER BY evidence_id", [fine.damage_id]);
  const appeals = await pool.query("SELECT * FROM fine_appeals WHERE fine_id = $1 ORDER BY appeal_id DESC", [fine.fine_id]);
  const payments = await pool.query(
    "SELECT payment_id, receipt_number, amount, method, kind, paid_at FROM payments WHERE fine_id = $1 ORDER BY payment_id", [fine.fine_id]);

  res.json({
    fine,
    evidence: evidence.rows.map((e) => ({ id: e.file_id, url: fileUrl(e.file_id), caption: e.caption })),
    appeals: appeals.rows,
    payments: payments.rows
  });
});

/* POST /api/fines — administrator approves a fine for confirmed damage */
router.post("/", requireRole("administrator"), async (req, res) => {
  const b = req.body || {};
  const damageId = int(b.damage_id, "Damage report");
  const damage = (await pool.query("SELECT * FROM damage_reports WHERE damage_id = $1", [damageId])).rows[0];
  if (!damage) throw notFound("Damage report not found.");

  const amount = money(b.amount ?? damage.fine_amount, "Fine amount");
  const reason = text(b.reason || damage.description, "Reason", { required: true, max: 500 });
  const dueDate = date(b.due_date, "Due date");
  if (dueDate && dueDate < today()) throw bad("The due date cannot be in the past.");

  const client = await pool.connect();
  let fine;
  try {
    await client.query("BEGIN");
    fine = await F.createFine(client, damage, { amount, reason, dueDate, note: text(b.note, "Note", { max: 300 }), user: req.user });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await notifyStudent(damage.student_number, {
    title: "A fine was issued",
    message: `A fine of RM ${Number(fine.amount).toFixed(2)} was approved for the ${damage.item_name}. It is due on ${String(fine.due_date).slice(0, 10)}. You can appeal on the Fines page.`,
    type: "fine", page: "fines", related_id: fine.fine_id
  });
  await audit(req, "approve_fine", "fine", fine.fine_id, { amount: fine.amount, student: damage.student_number, reason });

  res.status(201).json({ message: "Fine approved and sent to the student.", fine: await load(fine.fine_id) });
});

/* POST /api/fines/:id/appeal — the student disputes the fine */
router.post("/:id/appeal", requireRole("student"), async (req, res) => {
  const fine = await load(int(req.params.id, "Fine"));
  mustSee(req, fine);

  if (fine.status !== "Approved") throw conflict(fine.status === "Disputed" ? "You have already appealed this fine." : `A ${fine.status.toLowerCase()} fine cannot be appealed.`);

  const reason = text(req.body && req.body.reason, "Reason", { required: true, max: 1000 });
  if (reason.length < 10) throw bad("Please explain your appeal in a little more detail (at least 10 characters).");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO fine_appeals (fine_id, student_number, reason, status, created_at) VALUES ($1, $2, $3, 'Open', CURRENT_TIMESTAMP)", [fine.fine_id, fine.student_number, reason]);
    await client.query("UPDATE fines SET status = 'Disputed' WHERE fine_id = $1", [fine.fine_id]);
    await F.setDamageFineStatus(client, fine.damage_id, "Disputed", { disputeReason: reason });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await notifyRoles(["administrator"], { title: "Fine appeal waiting", message: `${req.user.name} appealed fine ${fine.fine_number}: ${reason.slice(0, 120)}`, type: "fine", page: "fines", related_id: fine.fine_id });
  await audit(req, "appeal_fine", "fine", fine.fine_id, { reason });

  res.status(201).json({ message: "Your appeal was sent. The administrator will review it." });
});

/* POST /api/fines/:id/review — start reviewing an appeal */
router.post("/:id/review", requireRole("administrator"), async (req, res) => {
  const fine = await load(int(req.params.id, "Fine"));
  if (fine.status !== "Disputed") throw conflict("Only a disputed fine can be put under review.");

  await pool.query("UPDATE fines SET status = 'Under Review' WHERE fine_id = $1", [fine.fine_id]);
  await F.setDamageFineStatus(pool, fine.damage_id, "Under Review");
  await notifyStudent(fine.student_number, { title: "Your appeal is under review", message: `Fine ${fine.fine_number} is being reviewed.`, type: "fine", page: "fines", related_id: fine.fine_id });
  await audit(req, "review_fine", "fine", fine.fine_id);

  res.json({ message: "The fine is now under review." });
});

/* POST /api/fines/:id/resolve-appeal — Upheld / Reduced / Waived */
router.post("/:id/resolve-appeal", requireRole("administrator"), async (req, res) => {
  const fine = await load(int(req.params.id, "Fine"));
  const b = req.body || {};
  const decision = oneOf(b.decision, ["Upheld", "Reduced", "Waived"], "Decision");
  const note = text(b.note, "Decision note", { required: true, max: 500 });

  if (!["Disputed", "Under Review"].includes(fine.status)) throw conflict("This fine has no appeal waiting for a decision.");

  const appeal = (await pool.query("SELECT appeal_id FROM fine_appeals WHERE fine_id = $1 AND status = 'Open' ORDER BY appeal_id DESC LIMIT 1", [fine.fine_id])).rows[0];
  if (!appeal) throw conflict("There is no open appeal for this fine.");

  let newAmount = fine.amount;
  if (decision === "Reduced") {
    newAmount = money(b.new_amount, "New amount", { allowZero: false });
    if (newAmount >= fine.amount) throw bad("The reduced amount must be lower than the current fine.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE fine_appeals SET status = $1, decision_note = $2, decided_by = $3, decided_by_name = $4, decided_at = CURRENT_TIMESTAMP
       WHERE appeal_id = $5`, [decision, note, req.user.id, req.user.name, appeal.appeal_id]);

    if (decision === "Waived") {
      await client.query("UPDATE fines SET status = 'Waived', waived_reason = $1 WHERE fine_id = $2", [note, fine.fine_id]);
      await F.setDamageFineStatus(client, fine.damage_id, "Waived");
    } else {
      await client.query("UPDATE fines SET status = 'Approved', amount = $1 WHERE fine_id = $2", [newAmount, fine.fine_id]);
      await F.setDamageFineStatus(client, fine.damage_id, "Approved", { amount: newAmount });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const outcome = decision === "Waived" ? "The fine was waived." : decision === "Reduced" ? `The fine was reduced to RM ${Number(newAmount).toFixed(2)}.` : "The fine was upheld.";
  await notifyStudent(fine.student_number, { title: "Appeal decision", message: `${outcome} ${note}`, type: "fine", page: "fines", related_id: fine.fine_id });
  await audit(req, "resolve_appeal", "fine", fine.fine_id, { decision, note });

  res.json({ message: `Appeal decided: ${decision}.`, fine: await load(fine.fine_id) });
});

/* POST /api/fines/:id/waive — administrator waives the fine */
router.post("/:id/waive", requireRole("administrator"), async (req, res) => {
  const fine = await load(int(req.params.id, "Fine"));
  const reason = text(req.body && req.body.reason, "Reason", { required: true, max: 500 });

  if (["Paid", "Waived"].includes(fine.status)) throw conflict(`This fine is already ${fine.status.toLowerCase()}.`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE fines SET status = 'Waived', waived_reason = $1 WHERE fine_id = $2", [reason, fine.fine_id]);
    await client.query("UPDATE fine_appeals SET status = 'Waived', decision_note = $1, decided_by = $2, decided_by_name = $3, decided_at = CURRENT_TIMESTAMP WHERE fine_id = $4 AND status = 'Open'",
      [reason, req.user.id, req.user.name, fine.fine_id]);
    await F.setDamageFineStatus(client, fine.damage_id, "Waived");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await notifyStudent(fine.student_number, { title: "Fine waived", message: `Fine ${fine.fine_number} was waived. ${reason}`, type: "fine", page: "fines", related_id: fine.fine_id });
  await audit(req, "waive_fine", "fine", fine.fine_id, { reason });

  res.json({ message: "The fine was waived." });
});

module.exports = router;
