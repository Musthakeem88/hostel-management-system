/* Check-in versus check-out comparison. */
const pool = require("../db");
const { parseJson } = require("./validate");
const { refsFromJson } = require("./photos");

const RANK = { Good: 0, Damaged: 1, Broken: 2 };
const rank = (condition) => (RANK[condition] === undefined ? 0 : RANK[condition]);

// Items of one inspection in a single shape (works for old inspections stored as JSON too)
async function inspectionItems(inspection) {
  const rows = (await pool.query(
    "SELECT * FROM inspection_items WHERE inspection_id = $1 ORDER BY ii_id", [inspection.inspection_id])).rows;

  if (rows.length) {
    return rows.map((r) => ({
      property_id: r.property_id, item: r.item_name, item_code: r.item_code,
      condition: r.item_condition, note: r.note || "", photos: refsFromJson(r.photo_ids)
    }));
  }

  return parseJson(inspection.inspection_items, []).map((i) => ({
    property_id: null, item: i.item, item_code: null, condition: i.condition, note: i.note || "", photos: []
  }));
}

function result(before, after) {
  if (!before) return "Not recorded at check-in";
  if (rank(after.condition) > rank(before.condition)) return "New damage";
  if (rank(after.condition) < rank(before.condition)) return "Improved";
  if ((after.note || "") !== (before.note || "") && after.condition !== "Good") return "No change";
  return "No change";
}

// The check-in the check-out should be compared with: latest earlier check-in of that student in that room
async function baselineFor(checkout) {
  const r = await pool.query(
    `SELECT * FROM inspections
     WHERE inspection_type = 'Check-in' AND student_number = $1
       AND room_block = $2 AND room_floor = $3 AND room_number = $4
       AND inspection_id < $5
     ORDER BY inspection_id DESC LIMIT 1`,
    [checkout.student_number, checkout.room_block, checkout.room_floor, checkout.room_number, checkout.inspection_id]
  );
  return r.rows[0] || null;
}

async function compare(checkout) {
  const baseline = await baselineFor(checkout);
  const after = await inspectionItems(checkout);
  const before = baseline ? await inspectionItems(baseline) : [];

  const findBefore = (item) =>
    before.find((b) => item.property_id && b.property_id && Number(b.property_id) === Number(item.property_id)) ||
    before.find((b) => String(b.item).toLowerCase() === String(item.item).toLowerCase());

  const rows = after.map((a) => {
    const b = findBefore(a);
    return {
      item: a.item,
      item_code: a.item_code || (b && b.item_code) || null,
      property_id: a.property_id || (b && b.property_id) || null,
      checkin_condition: b ? b.condition : null,
      checkin_note: b ? b.note : "",
      checkin_photos: b ? b.photos : [],
      checkout_condition: a.condition,
      checkout_note: a.note,
      checkout_photos: a.photos,
      result: result(b, a)
    };
  });

  return {
    baseline_id: baseline ? baseline.inspection_id : null,
    baseline_confirmed: baseline ? baseline.confirmation_status === "Confirmed" : false,
    rows,
    new_damage: rows.filter((r) => r.result === "New damage").length
  };
}

module.exports = { compare, inspectionItems, rank };
