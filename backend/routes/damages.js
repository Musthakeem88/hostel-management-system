const express = require("express");
const pool = require("../db");
const { bad, notFound, forbidden, conflict } = require("../lib/http");
const { text, oneOf, money, roomFromBody, roomId, businessNumber, clean } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { notifyRoles, notifyStudent } = require("../lib/notify");
const { checkPhotoIds } = require("../lib/photos");
const { fileUrl } = require("../lib/storage");
const { addHistory } = require("../lib/rooms");
const F = require("../lib/fines");

const router = express.Router();

const STAFF_VIEW = ["warden", "administrator", "management"];
const LEGACY_STATUSES = ["Pending", "Under Review", "Approved", "Paid", "Waived", "Disputed"];

const present = (row) => ({ ...row, room_id: roomId(row.room_block, row.room_floor, row.room_number) });

async function loadDamage(id) {
  const r = await pool.query("SELECT * FROM damage_reports WHERE damage_id = $1", [id]);
  if (!r.rows.length) throw notFound("Damage report not found.");
  return r.rows[0];
}

/* GET /api/damages */
router.get("/", requireRole(...STAFF_VIEW, "student"), async (req, res) => {
  const isStudent = req.user.role === "student";

  const result = await pool.query(
    `SELECT d.*, f.fine_id, f.fine_number, f.status AS fine_record_status,
            to_char(f.due_date, 'YYYY-MM-DD') AS fine_due_date,
            (SELECT COUNT(*) FROM damage_evidence e WHERE e.damage_id = d.damage_id) AS evidence_count
     FROM public.damage_reports d
     LEFT JOIN fines f ON f.damage_id = d.damage_id
     ${isStudent ? "WHERE d.student_number = $1" : ""}
     ORDER BY d.created_at DESC, d.damage_id DESC
     LIMIT 500`,
    isStudent ? [req.user.studentNumber || ""] : []
  );

  res.json(result.rows.map((r) => present({ ...r, evidence_count: Number(r.evidence_count) })));
});

/* POST /api/damages — report damage with photo proof */
router.post("/", requireRole("warden", "administrator"), async (req, res) => {
  const b = req.body || {};
  const hasRoom = b.room_id || b.room_block;
  const amountGiven = b.fine_amount != null && b.fine_amount !== "";
  const amount = Number(b.fine_amount);

  if (
    !hasRoom ||
    typeof b.item_name !== "string" || !b.item_name.trim() ||
    typeof b.student_number !== "string" || !b.student_number.trim() ||
    typeof b.description !== "string" || !b.description.trim() ||
    (amountGiven && (!Number.isFinite(amount) || amount < 0))
  ) {
    return res.status(400).json({ error: "Please provide valid damage report details and fine amount." });
  }

  const room = roomFromBody(b);
  const studentNumber = b.student_number.trim();
  const itemName = b.item_name.trim();
  const damageType = oneOf(b.damage_type || "Accidental damage", F.DAMAGE_TYPES, "Damage type");
  const repairCost = money(b.repair_cost ?? 0, "Repair cost");
  const replacementCost = money(b.replacement_cost ?? 0, "Replacement cost");
  const evidence = await checkPhotoIds(b.evidence_photo_ids, { max: 10, label: "proof photos" });

  if (!evidence.length) throw bad("Add at least one photo as proof of the damage.");

  const student = await pool.query(
    `SELECT student_id FROM public.students WHERE student_number = $1 AND room_block = $2 AND room_floor = $3 AND room_number = $4`,
    [studentNumber, room.block, room.floor, room.number]);
  if (!student.rows.length) return res.status(400).json({ error: "The student is not assigned to the selected room." });

  // link to the item in the room's item list
  let propertyId = null;
  if (b.property_id) {
    const p = await pool.query("SELECT property_id FROM properties WHERE property_id = $1 AND room_block = $2 AND room_floor = $3 AND room_number = $4",
      [Number(b.property_id), room.block, room.floor, room.number]);
    if (!p.rows.length) throw bad("That item does not belong to this room.");
    propertyId = p.rows[0].property_id;
  } else {
    const p = await pool.query(
      `SELECT property_id FROM properties WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND LOWER(item_name) = LOWER($4)
       ORDER BY property_id LIMIT 1`, [room.block, room.floor, room.number, itemName]);
    propertyId = p.rows.length ? p.rows[0].property_id : null;
  }

  const fine = damageType === "Normal wear" ? 0 : (amountGiven ? amount : F.suggestedFine(damageType, repairCost, replacementCost));
  const reportNumber = businessNumber("DMG").slice(0, 20);

  const client = await pool.connect();
  let damage;
  try {
    await client.query("BEGIN");
    damage = (await client.query(
      `INSERT INTO public.damage_reports
         (report_number, room_block, room_floor, room_number, item_name, student_number, description, fine_amount,
          damage_type, repair_cost, replacement_cost, damage_status, property_id, inspection_id, reported_by, reported_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Reported', $12, $13, $14, $15)
       RETURNING *`,
      [reportNumber, room.block, room.floor, room.number, itemName, studentNumber, b.description.trim(), fine,
       damageType, repairCost, replacementCost, propertyId, b.inspection_id ? Number(b.inspection_id) : null, req.user.id, req.user.name]
    )).rows[0];

    for (const fileId of evidence) {
      await client.query(
        "INSERT INTO damage_evidence (damage_id, file_id, caption, uploaded_by, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)",
        [damage.damage_id, fileId, text(b.evidence_caption, "Caption", { max: 200 }), req.user.id]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Duplicate report number. Please try again." });
    throw error;
  } finally {
    client.release();
  }

  const where = roomId(room.block, room.floor, room.number);
  await notifyRoles(["administrator"], { title: "Damage report needs review", message: `${itemName} in room ${where} (student ${studentNumber}).`, type: "damage", page: "damage", related_id: damage.damage_id });
  await notifyStudent(studentNumber, { title: "A damage report was filed", message: `A damage report (${reportNumber}) was filed for the ${itemName} in room ${where}. It will be reviewed before any fine.`, type: "damage", page: "fines", related_id: damage.damage_id });
  await audit(req, "create_damage", "damage", damage.damage_id, { report: reportNumber, room: where, student: studentNumber });

  res.status(201).json({ message: "Damage report created successfully.", damage: present(damage) });
});

/* GET /api/damages/:id — details with proof photos, fine and appeals */
router.get("/:id", requireRole(...STAFF_VIEW, "student"), async (req, res) => {
  const damage = await loadDamage(Number(req.params.id));
  if (req.user.role === "student" && damage.student_number !== req.user.studentNumber) throw forbidden();

  const evidence = await pool.query("SELECT file_id, caption, created_at FROM damage_evidence WHERE damage_id = $1 ORDER BY evidence_id", [damage.damage_id]);
  const fine = await F.fineByDamage(pool, damage.damage_id);
  const appeals = fine ? (await pool.query("SELECT * FROM fine_appeals WHERE fine_id = $1 ORDER BY appeal_id DESC", [fine.fine_id])).rows : [];

  res.json({
    damage: present(damage),
    evidence: evidence.rows.map((e) => ({ id: e.file_id, url: fileUrl(e.file_id), caption: e.caption, created_at: e.created_at })),
    fine,
    appeals
  });
});

/* POST /api/damages/:id/evidence — add more proof photos */
router.post("/:id/evidence", requireRole("warden", "administrator"), async (req, res) => {
  const damage = await loadDamage(Number(req.params.id));
  const ids = await checkPhotoIds(req.body && req.body.photo_ids, { max: 10 });
  if (!ids.length) throw bad("Choose at least one photo.");

  for (const fileId of ids) {
    await pool.query("INSERT INTO damage_evidence (damage_id, file_id, caption, uploaded_by, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)",
      [damage.damage_id, fileId, text(req.body.caption, "Caption", { max: 200 }), req.user.id]);
  }
  await audit(req, "add_evidence", "damage", damage.damage_id, { photos: ids.length });
  res.status(201).json({ message: "Photos added." });
});

/* POST /api/damages/:id/review — administrator checks the damage: investigate / confirm / reject */
router.post("/:id/review", requireRole("administrator"), async (req, res) => {
  const damage = await loadDamage(Number(req.params.id));
  const b = req.body || {};
  const action = oneOf(b.action, ["investigate", "confirm", "reject"], "Action");
  const note = text(b.note, "Note", { max: 500 });

  if (["Confirmed", "Rejected"].includes(damage.damage_status)) throw conflict(`This damage report is already ${damage.damage_status.toLowerCase()}.`);

  const where = roomId(damage.room_block, damage.room_floor, damage.room_number);

  if (action === "investigate") {
    await pool.query("UPDATE damage_reports SET damage_status = 'Under Investigation', review_note = $1 WHERE damage_id = $2", [note, damage.damage_id]);
    await notifyStudent(damage.student_number, { title: "Damage report under investigation", message: `The report for the ${damage.item_name} in room ${where} is being investigated.${note ? " " + note : ""}`, type: "damage", page: "fines", related_id: damage.damage_id });
    await audit(req, "investigate_damage", "damage", damage.damage_id);
    return res.json({ message: "Marked as under investigation." });
  }

  if (action === "reject") {
    if (!note) throw bad("Give the reason for rejecting this report.");
    await pool.query(
      "UPDATE damage_reports SET damage_status = 'Rejected', fine_status = 'Waived', review_note = $1, confirmed_by = $2, confirmed_at = CURRENT_TIMESTAMP WHERE damage_id = $3",
      [note, req.user.id, damage.damage_id]);
    await notifyStudent(damage.student_number, { title: "Damage report rejected", message: `The report for the ${damage.item_name} in room ${where} was rejected. No fine will be issued. ${note}`, type: "damage", page: "fines", related_id: damage.damage_id });
    await audit(req, "reject_damage", "damage", damage.damage_id, { reason: note });
    return res.json({ message: "Damage report rejected. No fine will be issued." });
  }

  // confirm
  const count = await pool.query("SELECT COUNT(*) AS total FROM damage_evidence WHERE damage_id = $1", [damage.damage_id]);
  if (Number(count.rows[0].total) < 1) throw bad("This report has no photo proof. Add proof before confirming.");

  const type = oneOf(b.damage_type || damage.damage_type || "Accidental damage", F.DAMAGE_TYPES, "Damage type");
  const repairCost = b.repair_cost == null ? Number(damage.repair_cost || 0) : money(b.repair_cost, "Repair cost");
  const replacementCost = b.replacement_cost == null ? Number(damage.replacement_cost || 0) : money(b.replacement_cost, "Replacement cost");
  const suggestion = b.fine_amount == null || b.fine_amount === "" ? F.suggestedFine(type, repairCost, replacementCost) : money(b.fine_amount, "Fine amount");
  const fineAmount = type === "Normal wear" ? 0 : suggestion;

  const client = await pool.connect();
  let repairNumber = null;
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE damage_reports SET damage_status = 'Confirmed', damage_type = $1, repair_cost = $2, replacement_cost = $3,
              fine_amount = $4, fine_status = $5, review_note = $6, confirmed_by = $7, confirmed_at = CURRENT_TIMESTAMP
       WHERE damage_id = $8`,
      [type, repairCost, replacementCost, fineAmount, type === "Normal wear" ? "Waived" : "Pending", note, req.user.id, damage.damage_id]);

    if (damage.property_id) {
      await client.query("UPDATE properties SET item_condition = 'Damaged', status = 'Under repair' WHERE property_id = $1", [damage.property_id]);
      await addHistory(client, damage.property_id, {
        event_type: "Damaged", item_condition: "Damaged", note: `${type}: ${damage.description}`,
        student_number: damage.student_number, ref_type: "damage", ref_id: damage.damage_id, actor: req.user.name
      });
    }

    if (b.create_repair !== false) {
      repairNumber = businessNumber("REP");
      await client.query(
        `INSERT INTO repair_requests (request_number, room_block, room_floor, room_number, item_name, description, priority,
                repair_status, reported_by, property_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'Normal', 'Reported', $7, $8, CURRENT_TIMESTAMP)`,
        [repairNumber, damage.room_block, damage.room_floor, damage.room_number, damage.item_name,
         `Repair damage (${damage.report_number}): ${damage.description}`.slice(0, 500), req.user.id, damage.property_id]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await notifyStudent(damage.student_number, {
    title: "Damage report confirmed",
    message: type === "Normal wear"
      ? `The ${damage.item_name} in room ${where} was judged normal wear. No fine will be issued.`
      : `The damage to the ${damage.item_name} in room ${where} was confirmed (${type.toLowerCase()}). A fine may be issued.`,
    type: "damage", page: "fines", related_id: damage.damage_id
  });
  if (repairNumber) await notifyRoles(["warden"], { title: "New repair created from a damage report", message: `${damage.item_name} in room ${where}: assign a repair job.`, type: "repair", page: "repairs" });
  await audit(req, "confirm_damage", "damage", damage.damage_id, { type, fineAmount });

  res.json({
    message: type === "Normal wear" ? "Confirmed as normal wear — no fine." : "Damage confirmed. You can now approve the fine.",
    suggested_fine: fineAmount,
    repair_created: Boolean(repairNumber)
  });
});

/* PATCH /api/damages/:id/status — the original fine-status endpoint (administrators only) */
router.patch("/:id/status", requireRole("administrator"), async (req, res) => {
  const status = String(req.body?.status ?? "").trim();
  const disputeReason = req.body?.dispute_reason;
  const damageId = Number(req.params.id);

  if (!Number.isInteger(damageId) || damageId <= 0) return res.status(400).json({ error: "Invalid damage report ID." });

  if (!LEGACY_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid fine status: "${status}".`, received: req.body?.status ?? null, allowedStatuses: LEGACY_STATUSES });
  }

  const damage = await pool.query("SELECT * FROM public.damage_reports WHERE damage_id = $1", [damageId]);
  if (!damage.rows.length) return res.status(404).json({ error: "Damage report not found." });

  const d = damage.rows[0];
  if (d.fine_status === "Paid") throw conflict("This fine is already Paid and cannot be changed.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fine = await F.fineByDamage(client, damageId);

    if (status === "Approved") {
      if (fine) {
        await client.query("UPDATE fines SET status = 'Approved' WHERE fine_id = $1", [fine.fine_id]);
        await F.setDamageFineStatus(client, damageId, "Approved");
      } else {
        await F.createFine(client, d, { amount: d.fine_amount, reason: d.description, note: "Approved from the damage list", user: req.user });
      }
    } else if (status === "Paid") {
      if (!fine) throw conflict("Approve the fine before marking it paid.");
      await F.payFine(client, fine, { amount: Number(fine.amount) - await F.paidSoFar(client, fine.fine_id), method: "Cash", note: "Marked as paid from the damage list", user: req.user });
    } else if (status === "Waived") {
      if (fine) await client.query("UPDATE fines SET status = 'Waived', waived_reason = $1 WHERE fine_id = $2", [disputeReason ? String(disputeReason) : "Waived by administrator", fine.fine_id]);
      await F.setDamageFineStatus(client, damageId, "Waived", { disputeReason: disputeReason == null ? null : String(disputeReason) });
    } else if (status === "Pending") {
      if (fine) throw conflict("A fine has already been approved for this report.");
      await F.setDamageFineStatus(client, damageId, "Pending");
    } else { // Under Review, Disputed
      if (fine) await client.query("UPDATE fines SET status = $1 WHERE fine_id = $2", [status, fine.fine_id]);
      await F.setDamageFineStatus(client, damageId, status, { disputeReason: disputeReason == null ? null : String(disputeReason) });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updated = await pool.query("SELECT * FROM public.damage_reports WHERE damage_id = $1", [damageId]);
  await audit(req, "damage_fine_status", "damage", damageId, { status });
  await notifyStudent(d.student_number, { title: "Fine status updated", message: `Fine for ${d.item_name} is now: ${status}.`, type: "fine", page: "fines", related_id: damageId });

  res.json({ message: "Fine status updated successfully.", damage: present(updated.rows[0]) });
});

module.exports = router;
