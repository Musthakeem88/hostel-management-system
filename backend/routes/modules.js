/* Generic routes for the modules defined in lib/modules.js
     GET  /api/m/:key              list
     POST /api/m/:key              create
     PUT  /api/m/:key/:id          edit (only where the module allows it)
     POST /api/m/:key/:id/:action  approve / reject / return ...                          */
const express = require("express");
const pool = require("../db");
const { modules } = require("../lib/modules");
const { bad, notFound, forbidden, conflict, HttpError } = require("../lib/http");
const { clean, isDate, today, parseRoomId, roomId } = require("../lib/validate");
const { audit } = require("../lib/audit");
const { notifyStudent } = require("../lib/notify");

const router = express.Router();

function getSpec(key) {
  const spec = modules[key];
  if (!spec) throw notFound("Unknown module.");
  return spec;
}

function selectList(spec) {
  const names = new Set([spec.pk]);
  spec.columns.filter((c) => c.type !== "computed").forEach((c) => names.add(c.name));
  (spec.selectExtra || []).forEach((n) => names.add(n));
  const dateColumns = new Set(spec.columns.filter((c) => c.type === "date").map((c) => c.name));

  return Array.from(names).map((n) => (dateColumns.has(n) ? `to_char(${n}, 'YYYY-MM-DD') AS ${n}` : n)).join(", ");
}

const present = (spec, row) => (spec.present ? spec.present(row) : row);

/* ---------- reading and checking the form ---------- */

async function checkRoom(db, value, label) {
  const room = parseRoomId(typeof value === "object" && value ? value.room_id : value);
  if (!room) throw bad(`Select a valid ${label.toLowerCase()}.`);
  const r = await db.query("SELECT 1 FROM rooms WHERE block = $1 AND floor = $2 AND room_number = $3", [room.block, room.floor, room.number]);
  if (!r.rows.length) throw bad("That room does not exist.");
  return room;
}

async function readField(db, f, raw, user, values) {
  const label = f.label;
  const value = typeof raw === "string" ? raw.trim() : raw;
  const empty = value === undefined || value === null || value === "";

  if (f.type === "student") {
    if (user.role === "student") {
      if (!user.studentNumber) throw bad("Your account is not linked to a student number.");
      const mine = await db.query("SELECT 1 FROM students WHERE student_number = $1 AND (student_status IS NULL OR student_status = 'Active')", [user.studentNumber]);
      if (!mine.rows.length) throw bad("You need an allocated room before you can use this.");
      values[f.name] = user.studentNumber;
      return;
    }
    if (empty) { if (f.required) throw bad(`${label} is required.`); values[f.name] = null; return; }
    const s = await db.query("SELECT 1 FROM students WHERE student_number = $1", [clean(value)]);
    if (!s.rows.length) throw bad(`Student ${clean(value)} was not found.`);
    values[f.name] = clean(value);
    return;
  }

  if (f.type === "room") {
    const prefix = f.prefix || "room_";
    if (empty) {
      if (f.required) throw bad(`${label} is required.`);
      values[`${prefix}block`] = null; values[`${prefix}floor`] = null; values[`${prefix}number`] = null;
      return;
    }
    const room = await checkRoom(db, value, label);
    values[`${prefix}block`] = room.block; values[`${prefix}floor`] = room.floor; values[`${prefix}number`] = room.number;
    return;
  }

  if (empty) {
    if (f.default === "today") { values[f.name] = today(); return; }
    if (f.default !== undefined && f.type === "select") { values[f.name] = f.default; return; }
    if (f.required) throw bad(`${label} is required.`);
    values[f.name] = null;
    return;
  }

  switch (f.type) {
    case "select":
      if (!f.options.includes(String(value))) throw bad(`${label} must be one of: ${f.options.join(", ")}.`);
      values[f.name] = String(value);
      break;
    case "date":
      if (!isDate(String(value))) throw bad(`${label} is not a valid date.`);
      values[f.name] = String(value);
      break;
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw bad(`${label} must be a valid number.`);
      values[f.name] = n;
      break;
    }
    case "block": {
      const b = await db.query("SELECT 1 FROM hostels WHERE block = $1", [clean(value)]);
      if (!b.rows.length) throw bad("That hostel does not exist.");
      values[f.name] = clean(value);
      break;
    }
    default: { // text, textarea
      const text = clean(value);
      if (f.max && text.length > f.max) throw bad(`${label} is too long (max ${f.max} characters).`);
      if (f.pattern && !new RegExp(f.pattern).test(text)) throw bad(`${label} is not in the right format.`);
      values[f.name] = text;
    }
  }
}

async function readValues(db, fields, body, user) {
  const values = {};
  for (const f of fields) await readField(db, f, body[f.name], user, values);
  return values;
}

/* ---------- list ---------- */

router.get("/:key", async (req, res) => {
  const spec = getSpec(req.params.key);
  if (!spec.listRoles.includes(req.user.role)) throw forbidden();

  const params = [];
  const where = [];

  if (spec.scope) {
    const s = spec.scope(req.user);
    if (s.sql) { where.push(s.sql); params.push(...s.params); }
  }
  if (spec.ownerField && req.user.role === "student") {
    params.push(req.user.studentNumber || "");
    where.push(`${spec.ownerField} = $${params.length}`);
  }
  if (req.query.status && spec.statusField) {
    params.push(clean(req.query.status));
    where.push(`${spec.statusField} = $${params.length}`);
  }

  const result = await pool.query(
    `SELECT ${selectList(spec)} FROM ${spec.table} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${spec.order} LIMIT 500`,
    params
  );

  res.json(result.rows.map((r) => present(spec, r)));
});

/* ---------- create ---------- */

function insertSql(table, values) {
  const names = Object.keys(values);
  const params = [];
  const marks = names.map((n) => {
    const v = values[n];
    if (v && typeof v === "object" && v.sql) return v.sql; // fixed SQL from the module definition, e.g. CURRENT_TIMESTAMP
    params.push(v);
    return `$${params.length}`;
  });
  return { sql: `INSERT INTO ${table} (${names.join(", ")}) VALUES (${marks.join(", ")})`, params };
}

router.post("/:key", async (req, res) => {
  const spec = getSpec(req.params.key);
  if (!(spec.createRoles || []).includes(req.user.role)) throw forbidden();

  const client = await pool.connect();
  let row;
  let values;

  try {
    await client.query("BEGIN");

    values = await readValues(client, spec.fields, req.body || {}, req.user);
    if (spec.beforeCreate) await spec.beforeCreate({ client, user: req.user, values });

    const { sql, params } = insertSql(spec.table, values);
    const created = await client.query(`${sql} RETURNING ${spec.pk}`, params);
    const id = created.rows[0][spec.pk];

    row = present(spec, (await client.query(`SELECT ${selectList(spec)} FROM ${spec.table} WHERE ${spec.pk} = $1`, [id])).rows[0]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (spec.afterCreate) await spec.afterCreate({ values, row, user: req.user, pool });
  await audit(req, `create_${req.params.key}`, req.params.key, row[spec.pk]);

  res.status(201).json({ message: "Saved successfully.", row });
});

/* ---------- edit ---------- */

router.put("/:key/:id", async (req, res) => {
  const spec = getSpec(req.params.key);
  if (!(spec.editRoles || []).includes(req.user.role)) throw forbidden();

  const id = Number(req.params.id);
  const existing = await pool.query(`SELECT ${spec.pk} FROM ${spec.table} WHERE ${spec.pk} = $1`, [id]);
  if (!existing.rows.length) throw notFound("Record not found.");

  const editable = spec.fields.filter((f) => f.editable && req.body && req.body[f.name] !== undefined);
  if (!editable.length) throw bad("Nothing to change.");

  const values = await readValues(pool, editable, req.body, req.user);
  const names = Object.keys(values);
  await pool.query(
    `UPDATE ${spec.table} SET ${names.map((n, i) => `${n} = $${i + 1}`).join(", ")} WHERE ${spec.pk} = $${names.length + 1}`,
    [...names.map((n) => values[n]), id]
  );

  await audit(req, `update_${req.params.key}`, req.params.key, id);
  res.json({ message: "Updated successfully." });
});

/* ---------- actions (approve, reject, return...) ---------- */

router.post("/:key/:id/:action", async (req, res) => {
  const spec = getSpec(req.params.key);
  const action = (spec.actions || []).find((a) => a.key === req.params.action);
  if (!action) throw notFound("Unknown action.");
  if (!action.roles.includes(req.user.role)) throw forbidden();

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw bad("Invalid record.");

  const client = await pool.connect();
  let row;
  let input = {};
  let result;

  try {
    await client.query("BEGIN");

    const found = await client.query(`SELECT * FROM ${spec.table} WHERE ${spec.pk} = $1 FOR UPDATE`, [id]);
    if (!found.rows.length) throw notFound("Record not found.");
    row = found.rows[0];

    const current = row[spec.statusField];
    if (!action.from.includes(current)) throw conflict(`This record is ${String(current).toLowerCase()}, so "${action.label}" is not possible.`);

    // inputs the person typed for this action
    for (const f of action.inputs || []) {
      const raw = (req.body || {})[f.name];
      if (f.type === "room") {
        const empty = raw === undefined || raw === null || raw === "";
        if (empty) { if (f.required) throw bad(`${f.label} is required.`); continue; }
        input[f.name] = await checkRoom(client, raw, f.label);
      } else {
        const tmp = {};
        await readField(client, f, raw, req.user, tmp);
        input[f.name] = tmp[f.name];
      }
    }

    if (action.handler) result = await action.handler({ client, row, input, user: req.user });

    // generic column updates
    const sets = [];
    const params = [];
    const add = (name, value) => { params.push(value); sets.push(`${name} = $${params.length}`); };

    Object.entries(action.set || {}).forEach(([name, value]) => add(name, value));
    Object.entries(action.setUser || {}).forEach(([name, key]) => add(name, req.user[key]));
    (action.stamps || []).forEach((name) => sets.push(`${name} = CURRENT_TIMESTAMP`));
    (action.inputs || []).filter((f) => f.type !== "room" && input[f.name] !== undefined && input[f.name] !== null).forEach((f) => add(f.name, input[f.name]));

    if (sets.length) {
      params.push(id);
      await client.query(`UPDATE ${spec.table} SET ${sets.join(", ")} WHERE ${spec.pk} = $${params.length}`, params);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (action.notify) {
    const n = action.notify(row, input);
    await notifyStudent(n.student, { title: n.title, message: n.message, type: req.params.key, page: req.params.key, related_id: id });
  }
  if (action.after) await action.after({ row, input, result, user: req.user });
  await audit(req, `${req.params.key}_${action.key}`, req.params.key, id);

  const updated = await pool.query(`SELECT ${selectList(spec)} FROM ${spec.table} WHERE ${spec.pk} = $1`, [id]);
  res.json({ message: `${action.label}: done.`, row: present(spec, updated.rows[0]), result: result || null });
});

module.exports = router;
