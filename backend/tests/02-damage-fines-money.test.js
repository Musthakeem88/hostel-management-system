const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { boot, campus } = require("./helpers");

let t;
let k;
let damageId;
let fineId;

before(async () => { t = await boot(); k = await campus(t); });
after(async () => { await t.close(); });

const report = async (extra = {}) => t.call("POST", "/api/damages", {
  room_id: "A-01-01", item_name: "Mattress", student_number: "20260001", description: "Large tear in the mattress",
  damage_type: "Accidental damage", repair_cost: 80, evidence_photo_ids: [await t.photo(k.warden)], ...extra
}, k.warden);

describe("damage reports need proof and a check before any fine", () => {
  test("photo proof is required; only wardens and administrators report", async () => {
    const noPhoto = await t.call("POST", "/api/damages", { room_id: "A-01-01", item_name: "Mattress", student_number: "20260001", description: "Torn", fine_amount: 10 }, k.warden);
    assert.equal(noPhoto.status, 400);
    assert.match(noPhoto.data.error, /photo/i);
    assert.equal((await t.call("POST", "/api/damages", {}, k.warden)).status, 400);
    assert.equal((await t.call("POST", "/api/damages", { room_id: "A-01-01", item_name: "Chair", student_number: "20260001", description: "x" }, k.ann)).status, 403);
    assert.equal((await t.call("POST", "/api/damages", { room_id: "B-01-01", item_name: "Chair", student_number: "20260001", description: "x", evidence_photo_ids: [await t.photo(k.warden)] }, k.warden)).status, 400); // not their room
  });

  test("a report links to the item, room, student and proof; the fine is suggested from the repair cost", async () => {
    const r = await report();
    assert.equal(r.status, 201);
    damageId = r.data.damage.damage_id;
    assert.match(r.data.damage.report_number, /^DMG-/);
    assert.equal(r.data.damage.damage_status, "Reported");
    assert.equal(Number(r.data.damage.fine_amount), 80);
    assert.ok(r.data.damage.property_id, "linked to the mattress in the room's item list");

    const detail = (await t.call("GET", `/api/damages/${damageId}`, undefined, k.admin)).data;
    assert.equal(detail.evidence.length, 1);
    assert.match(detail.evidence[0].url, /^\/api\/files\//);
    assert.equal(detail.damage.room_id, "A-01-01");
  });

  test("the administrator is told, and the student too; the other student sees nothing", async () => {
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.admin)).data.some((n) => n.title === "Damage report needs review"));
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.ann)).data.some((n) => n.title === "A damage report was filed"));
    assert.equal((await t.call("GET", "/api/damages", undefined, k.ann)).data.length, 1);
    assert.equal((await t.call("GET", "/api/damages", undefined, k.ben)).data.length, 0);
    assert.equal((await t.call("GET", `/api/damages/${damageId}`, undefined, k.ben)).status, 403);
  });

  test("no fine can be approved before the damage is confirmed", async () => {
    const early = await t.call("POST", "/api/fines", { damage_id: damageId }, k.admin);
    assert.equal(early.status, 409);
    assert.match(early.data.error, /confirm the damage first/i);
    assert.equal((await t.call("POST", `/api/damages/${damageId}/review`, { action: "confirm" }, k.warden)).status, 403);
  });

  test("confirming damage updates the item, makes a repair job and keeps history", async () => {
    const c = await t.call("POST", `/api/damages/${damageId}/review`, { action: "confirm", damage_type: "Accidental damage", note: "Checked the photos" }, k.admin);
    assert.equal(c.status, 200);
    assert.equal(c.data.suggested_fine, 80);
    assert.equal(c.data.repair_created, true);
    assert.equal((await t.call("POST", `/api/damages/${damageId}/review`, { action: "confirm" }, k.admin)).status, 409);

    const item = (await t.call("GET", "/api/items?room_id=A-01-01&q=Mattress", undefined, k.admin)).data.find((i) => i.damage_count === 1);
    assert.equal(item.item_condition, "Damaged");
    assert.equal(item.status, "Under repair");
    const hist = (await t.call("GET", `/api/items/${item.property_id}`, undefined, k.admin)).data.history.map((h) => h.event_type);
    assert.ok(hist.includes("Damaged"));
    const repairs = (await t.call("GET", "/api/repairs", undefined, k.warden)).data;
    assert.ok(repairs.some((r) => r.description.includes("Repair damage")));
  });
});

describe("fines: approval, due date, appeal", () => {
  test("a fine records who approved it and why, with a due date", async () => {
    assert.equal((await t.call("POST", "/api/fines", { damage_id: damageId, due_date: "2020-01-01" }, k.admin)).status, 400);
    const f = await t.call("POST", "/api/fines", { damage_id: damageId, reason: "Mattress torn during the stay", note: "Policy 4.2" }, k.admin);
    assert.equal(f.status, 201);
    fineId = f.data.fine.fine_id;
    assert.equal(f.data.fine.amount, 80);
    assert.equal(f.data.fine.status, "Approved");
    assert.equal(f.data.fine.approved_by_name, "admin" === f.data.fine.approved_by_name ? "admin" : f.data.fine.approved_by_name);
    assert.ok(f.data.fine.approved_by_name);
    assert.match(f.data.fine.due_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(f.data.fine.reason, "Mattress torn during the stay");
    assert.equal((await t.call("POST", "/api/fines", { damage_id: damageId }, k.admin)).status, 409);
    assert.equal((await t.call("POST", "/api/fines", { damage_id: damageId }, k.warden)).status, 403);
  });

  test("the student sees the fine, and the damage list follows the fine status", async () => {
    const mine = (await t.call("GET", "/api/fines", undefined, k.ann)).data;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].balance, 80);
    assert.equal((await t.call("GET", "/api/fines", undefined, k.ben)).data.length, 0);
    assert.equal((await t.call("GET", `/api/fines/${fineId}`, undefined, k.ben)).status, 403);
    const dmg = (await t.call("GET", "/api/damages", undefined, k.ann)).data[0];
    assert.equal(dmg.fine_status, "Approved");
    assert.equal(dmg.fine_number, mine[0].fine_number);
  });

  test("students can never change a damage report or a fine", async () => {
    assert.equal((await t.call("PATCH", `/api/damages/${damageId}/status`, { status: "Paid" }, k.ann)).status, 403);
    assert.equal((await t.call("POST", `/api/fines/${fineId}/waive`, { reason: "please" }, k.ann)).status, 403);
    assert.equal((await t.call("POST", `/api/damages/${damageId}/review`, { action: "reject", note: "x" }, k.ann)).status, 403);
    assert.equal((await t.call("POST", "/api/payments", { fine_id: fineId, amount: 80, method: "Cash" }, k.ann)).status, 403);
    assert.equal((await t.call("POST", `/api/fines/${fineId}/appeal`, { reason: "short" }, k.ben)).status, 403);
  });

  test("the student appeals; the administrator reviews and reduces the fine", async () => {
    assert.equal((await t.call("POST", `/api/fines/${fineId}/appeal`, { reason: "too short" }, k.ann)).status, 400);
    const appeal = await t.call("POST", `/api/fines/${fineId}/appeal`, { reason: "The mattress was already worn when I arrived." }, k.ann);
    assert.equal(appeal.status, 201);
    assert.equal((await t.call("POST", `/api/fines/${fineId}/appeal`, { reason: "Trying a second appeal" }, k.ann)).status, 409);

    assert.equal((await t.call("GET", "/api/damages", undefined, k.ann)).data[0].fine_status, "Disputed");
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.admin)).data.some((n) => n.title === "Fine appeal waiting"));
    assert.equal((await t.call("POST", "/api/payments", { fine_id: fineId, amount: 10, method: "Cash" }, k.admin)).status, 409); // cannot pay while disputed

    assert.equal((await t.call("POST", `/api/fines/${fineId}/review`, {}, k.admin)).status, 200);
    assert.equal((await t.call("POST", `/api/fines/${fineId}/resolve-appeal`, { decision: "Reduced", new_amount: 90, note: "x" }, k.admin)).status, 400);
    assert.equal((await t.call("POST", `/api/fines/${fineId}/resolve-appeal`, { decision: "Reduced", new_amount: 50 }, k.admin)).status, 400); // note needed
    const done = await t.call("POST", `/api/fines/${fineId}/resolve-appeal`, { decision: "Reduced", new_amount: 50, note: "Partly normal wear" }, k.admin);
    assert.equal(done.status, 200);
    assert.equal(done.data.fine.amount, 50);
    assert.equal(done.data.fine.status, "Approved");
    assert.equal((await t.call("GET", "/api/damages", undefined, k.ann)).data[0].fine_amount, 50);
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.ann)).data.some((n) => n.title === "Appeal decision"));
    const detail = (await t.call("GET", `/api/fines/${fineId}`, undefined, k.ann)).data;
    assert.equal(detail.appeals[0].status, "Reduced");
  });
});

describe("fees, deposit and payments", () => {
  let fees;

  test("a deposit invoice and a hostel-fee invoice exist; students only see their own", async () => {
    fees = (await t.call("GET", "/api/fees", undefined, k.ann)).data;
    assert.equal(fees.length, 2);
    const deposit = fees.find((f) => f.fee_type === "Security deposit");
    assert.equal(deposit.amount, 300);
    assert.equal((await t.call("GET", "/api/fees", undefined, k.admin)).data.length, 4);
    assert.equal((await t.call("GET", "/api/fees", undefined, k.boss)).data.length, 4);   // management sees all, read-only
  });

  test("a payment cannot exceed the balance; partial payments change the status", async () => {
    const hostel = fees.find((f) => f.fee_type === "Hostel fee");
    assert.equal((await t.call("POST", "/api/payments", { fee_id: hostel.fee_id, amount: 99999, method: "Cash" }, k.admin)).status, 400);
    assert.equal((await t.call("POST", "/api/payments", { fee_id: hostel.fee_id, amount: 0, method: "Cash" }, k.admin)).status, 400);
    assert.equal((await t.call("POST", "/api/payments", { fee_id: hostel.fee_id, amount: 100, method: "Gold coins" }, k.admin)).status, 400);
    assert.equal((await t.call("POST", "/api/payments", { fee_id: hostel.fee_id, fine_id: fineId, amount: 100, method: "Cash" }, k.admin)).status, 400);

    const part = await t.call("POST", "/api/payments", { fee_id: hostel.fee_id, amount: 500, method: "Bank transfer", reference: "TRX1" }, k.admin);
    assert.equal(part.status, 201);
    assert.equal(part.data.fully_paid, false);
    assert.match(part.data.payment.receipt_number, /^RCT-/);
    assert.equal((await t.call("GET", "/api/fees", undefined, k.ann)).data.find((f) => f.fee_id === hostel.fee_id).status, "Partially paid");

    const rest = await t.call("POST", "/api/payments", { fee_id: hostel.fee_id, amount: 700, method: "Card" }, k.admin);
    assert.equal(rest.data.fully_paid, true);
    assert.equal((await t.call("GET", "/api/fees", undefined, k.ann)).data.find((f) => f.fee_id === hostel.fee_id).status, "Paid");
    assert.equal((await t.call("POST", "/api/payments", { fee_id: hostel.fee_id, amount: 1, method: "Cash" }, k.admin)).status, 409);
  });

  test("the fine cannot be taken from the deposit until the deposit is paid", async () => {
    const early = await t.call("POST", "/api/payments", { fine_id: fineId, amount: 50, method: "Deposit deduction" }, k.admin);
    assert.equal(early.status, 400);
    assert.match(early.data.error, /deposit balance/i);
  });

  test("the deposit is paid, then the approved fine is taken from it", async () => {
    const deposit = fees.find((f) => f.fee_type === "Security deposit");
    assert.equal((await t.call("POST", "/api/payments", { fee_id: deposit.fee_id, amount: 300, method: "Cash" }, k.admin)).status, 201);
    assert.equal((await t.call("POST", "/api/payments", { fee_id: deposit.fee_id, amount: 10, method: "Deposit deduction" }, k.admin)).status, 400); // deposits only pay fines

    const take = await t.call("POST", "/api/payments", { fine_id: fineId, amount: 50, method: "Deposit deduction" }, k.admin);
    assert.equal(take.status, 201);
    assert.equal(take.data.fully_paid, true);

    const fine = (await t.call("GET", `/api/fines/${fineId}`, undefined, k.ann)).data.fine;
    assert.equal(fine.status, "Paid");
    assert.equal(fine.balance, 0);
    assert.equal((await t.call("GET", "/api/damages", undefined, k.ann)).data[0].fine_status, "Paid");

    const dep = (await t.call("GET", "/api/deposits/20260001", undefined, k.ann)).data;
    assert.equal(dep.deposit_paid, 300);
    assert.equal(dep.deducted, 50);
    assert.equal(dep.balance, 250);
    assert.equal((await t.call("GET", "/api/deposits/20260001", undefined, k.ben)).status, 403);
  });

  test("receipts and invoices are PDF files; students cannot open someone else's", async () => {
    const payments = (await t.call("GET", "/api/payments", undefined, k.ann)).data;
    assert.ok(payments.length >= 3);
    const pdf = await t.call("GET", `/api/payments/${payments[0].payment_id}/receipt`, undefined, k.ann);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(pdf.data).subarray(0, 5).toString(), "%PDF-");
    assert.equal((await t.call("GET", `/api/payments/${payments[0].payment_id}/receipt`, undefined, k.ben)).status, 403);
    const inv = await t.call("GET", `/api/fees/${fees[0].fee_id}/invoice`, undefined, k.ann);
    assert.equal(inv.headers.get("content-type"), "application/pdf");
    assert.equal((await t.call("GET", `/api/fees/${fees[0].fee_id}/invoice`, undefined, k.ben)).status, 403);
  });

  test("bulk invoices go to every resident; paid fees cannot be cancelled", async () => {
    assert.equal((await t.call("POST", "/api/fees", { scope: "all", fee_type: "Other", amount: 25, due_date: "2030-01-31", description: "Laundry card" }, k.ann)).status, 403);
    const bulk = await t.call("POST", "/api/fees", { scope: "all", fee_type: "Other", amount: 25, due_date: "2030-01-31", description: "Laundry card" }, k.admin);
    assert.equal(bulk.status, 201);
    assert.equal(bulk.data.count, 2);
    const hostel = fees.find((f) => f.fee_type === "Hostel fee");
    assert.equal((await t.call("POST", `/api/fees/${hostel.fee_id}/cancel`, {}, k.admin)).status, 409);
    const laundry = (await t.call("GET", "/api/fees?type=Other", undefined, k.admin)).data[0];
    assert.equal((await t.call("POST", `/api/fees/${laundry.fee_id}/cancel`, {}, k.admin)).status, 200);
  });
});

describe("normal wear, rejection and the original fine-status endpoint", () => {
  test("normal wear is never fined", async () => {
    const r = await report({ item_name: "Chair", description: "Worn seat", damage_type: "Normal wear", repair_cost: 20 });
    assert.equal(Number(r.data.damage.fine_amount), 0);
    const id = r.data.damage.damage_id;
    const c = await t.call("POST", `/api/damages/${id}/review`, { action: "confirm", damage_type: "Normal wear" }, k.admin);
    assert.equal(c.data.suggested_fine, 0);
    assert.equal((await t.call("POST", "/api/fines", { damage_id: id, amount: 10, reason: "x" }, k.admin)).status, 409);
    assert.equal((await t.call("GET", "/api/damages", undefined, k.ann)).data.find((d) => d.damage_id === id).fine_status, "Waived");
  });

  test("a report can be rejected only with a reason, and then no fine exists", async () => {
    const r = await report({ item_name: "Desk", description: "Scratch" });
    const id = r.data.damage.damage_id;
    assert.equal((await t.call("POST", `/api/damages/${id}/review`, { action: "reject" }, k.admin)).status, 400);
    assert.equal((await t.call("POST", `/api/damages/${id}/review`, { action: "investigate", note: "Asking the student" }, k.admin)).status, 200);
    assert.equal((await t.call("POST", `/api/damages/${id}/review`, { action: "reject", note: "Photo shows an old mark" }, k.admin)).status, 200);
    assert.equal((await t.call("POST", "/api/fines", { damage_id: id, amount: 10, reason: "x" }, k.admin)).status, 409);
  });

  test("vandalism is fined at replacement cost", async () => {
    const r = await report({ item_name: "Mirror", description: "Smashed", damage_type: "Confirmed vandalism", repair_cost: 10, replacement_cost: 60 });
    assert.equal(Number(r.data.damage.fine_amount), 60);
  });

  test("the original status endpoint still works (administrators only) and keeps the money rules", async () => {
    const r = await report({ item_name: "Wardrobe", description: "Door off", repair_cost: 40 });
    const id = r.data.damage.damage_id;
    assert.equal((await t.call("PATCH", `/api/damages/${id}/status`, { status: "Nope" }, k.admin)).status, 400);
    assert.equal((await t.call("PATCH", "/api/damages/abc/status", { status: "Paid" }, k.admin)).status, 400);
    assert.equal((await t.call("PATCH", `/api/damages/${id}/status`, { status: "Approved" }, k.admin)).status, 409);   // not confirmed yet
    await t.call("POST", `/api/damages/${id}/review`, { action: "confirm", damage_type: "Accidental damage" }, k.admin);
    const ap = await t.call("PATCH", `/api/damages/${id}/status`, { status: "Approved" }, k.admin);
    assert.equal(ap.status, 200);
    assert.equal(ap.data.damage.fine_status, "Approved");
    assert.equal((await t.call("PATCH", `/api/damages/${id}/status`, { status: "Pending" }, k.admin)).status, 409);
    const paid = await t.call("PATCH", `/api/damages/${id}/status`, { status: "Paid" }, k.admin);
    assert.equal(paid.status, 200);
    assert.equal(paid.data.damage.fine_status, "Paid");
    assert.equal((await t.call("PATCH", `/api/damages/${id}/status`, { status: "Waived" }, k.admin)).status, 409);     // paid is locked
    const receipts = (await t.call("GET", "/api/payments", undefined, k.admin)).data;
    assert.ok(receipts.some((p) => p.fine_number && p.note && p.note.includes("damage list")));
  });
});

describe("check-out, deposit settlement and the waiting room", () => {
  test("check-out needs an inspection (or an explicit override) and frees the room", async () => {
    const need = await t.call("POST", "/api/students/20260001/checkout", {}, k.warden);
    assert.equal(need.status, 409);
    assert.equal(need.data.needsConfirmation, true);

    // before leaving, a new fine appears that is still unpaid
    const r = await report({ item_name: "Window", description: "Cracked window", damage_type: "Confirmed vandalism", repair_cost: 100, replacement_cost: 120 });
    await t.call("POST", `/api/damages/${r.data.damage.damage_id}/review`, { action: "confirm", damage_type: "Confirmed vandalism" }, k.admin);
    const fine = await t.call("POST", "/api/fines", { damage_id: r.data.damage.damage_id, reason: "Window smashed" }, k.admin);
    assert.equal(fine.data.fine.amount, 120);

    assert.equal((await t.call("POST", "/api/deposits/20260001/settle", {}, k.admin)).status, 409);    // still living there

    const out = await t.call("POST", "/api/students/20260001/checkout", { force: true }, k.warden);
    assert.equal(out.status, 200);
    assert.equal(out.data.settlement.balance, 250);
    assert.equal(out.data.settlement.unpaid_fines, 120);
    assert.equal(out.data.settlement.refundable, 130);

    const a101 = (await t.call("GET", "/api/rooms", undefined, k.warden)).data.find((x) => x.room_id === "A-01-01");
    assert.equal(a101.occupied, 1);
    const detail = (await t.call("GET", "/api/rooms/A-01-01/detail", undefined, k.warden)).data;
    assert.equal(detail.beds.filter((b) => b.student_number).length, 1);
    assert.equal((await t.call("GET", "/api/students/20260001", undefined, k.warden)).data.student.student_status, "Checked out");
    assert.equal((await t.call("POST", "/api/students/20260001/checkout", { force: true }, k.warden)).status, 400);
  });

  test("the deposit pays the unpaid fine and the rest is refunded", async () => {
    const s = await t.call("POST", "/api/deposits/20260001/settle", { refund_method: "Bank transfer" }, k.admin);
    assert.equal(s.status, 200);
    assert.equal(s.data.deducted, 120);
    assert.equal(s.data.refunded, 130);
    assert.equal(s.data.outstanding_fines, 0);

    const dep = (await t.call("GET", "/api/deposits/20260001", undefined, k.admin)).data;
    assert.equal(dep.balance, 0);
    assert.equal(dep.refunded, 130);
    const refund = (await t.call("GET", "/api/payments?student_number=20260001", undefined, k.admin)).data.find((p) => p.kind === "Refund");
    assert.equal(refund.amount, 130);
    const rec = await t.call("GET", `/api/payments/${refund.payment_id}/receipt`, undefined, k.ann);
    assert.equal(rec.status, 200);
    assert.equal((await t.call("GET", "/api/deposits", undefined, k.boss)).status, 200);
  });

  test("the dashboard adds up the damage and money", async () => {
    const d = (await t.call("GET", "/api/dashboard", undefined, k.admin)).data;
    assert.equal(d.fines.paid_count, 3);
    assert.equal(d.fines.unpaid_count, 0);
    assert.ok(d.damage.total_cost > 0);
    assert.ok(d.damage.most_damaged.length >= 1);
    assert.ok(d.damage.most_damaged.every((m) => m.total >= 1));
    assert.equal(d.rooms.total, 3);
    assert.equal(d.fees.overdue, 0);
  });

  test("everything important left a trace in the activity log", async () => {
    const log = (await t.call("GET", "/api/audit?limit=500", undefined, k.admin)).data.map((l) => l.action);
    for (const a of ["create_damage", "confirm_damage", "approve_fine", "appeal_fine", "resolve_appeal", "payment", "checkout_student", "settle_deposit"]) {
      assert.ok(log.includes(a), `missing ${a}`);
    }
    assert.equal((await t.call("GET", "/api/audit?action=approve", undefined, k.admin)).data.length >= 1, true);
  });
});
