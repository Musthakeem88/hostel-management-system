/* =========================================================
   SQLite stand-in for PostgreSQL — for automated tests and quick demos only.
   Enabled with  DB_DRIVER=sqlite  (optionally SQLITE_FILE=demo.sqlite).
   It translates the small PostgreSQL dialect used by this project into SQLite.
   Production always uses real PostgreSQL (see ../db.js).
========================================================= */
const { DatabaseSync } = require("node:sqlite");

const BOOLEAN_COLUMNS = new Set(["under_maintenance"]);

function translate(sql) {
  let s = String(sql);

  // schema prefix, row locks, casts, ILIKE, NOW()
  s = s.replace(/\bpublic\./g, "");
  s = s.replace(/\s+FOR\s+UPDATE\b/gi, "");
  s = s.replace(/::\s*(text|date|integer|int|numeric|float|timestamptz|timestamp|varchar|boolean|jsonb)(\(\s*\d+\s*(,\s*\d+\s*)?\))?/gi, "");
  s = s.replace(/\bILIKE\b/gi, "LIKE");
  s = s.replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP");

  // to_char(x, 'YYYY-MM-DD')  ->  substr(CAST(x AS TEXT), 1, 10)
  s = s.replace(/to_char\(\s*([^,()]+?)\s*,\s*'([^']+)'\s*\)/gi, (m, expr, fmt) => {
    const length = { "YYYY-MM-DD": 10, "YYYY-MM": 7, "YYYY-MM-DD HH24:MI": 16 }[fmt] || 10;
    return `substr(CAST(${expr} AS TEXT), 1, ${length})`;
  });

  // DDL type names
  s = s.replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, "INTEGER PRIMARY KEY AUTOINCREMENT");
  s = s.replace(/\bTIMESTAMPTZ\b/gi, "TEXT");
  s = s.replace(/\bJSONB\b/gi, "TEXT");

  // numbered parameters  $1 -> ?1
  s = s.replace(/\$(\d+)/g, "?$1");

  return s;
}

function errorCode(error) {
  const m = String(error.message || "");
  if (/UNIQUE constraint failed|PRIMARY KEY/i.test(m)) return "23505";
  if (/NOT NULL constraint failed/i.test(m)) return "23502";
  if (/CHECK constraint failed/i.test(m)) return "23514";
  return undefined;
}

function convertParams(params) {
  return (params || []).map((p) => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (p !== null && typeof p === "object") return JSON.stringify(p);
    return p;
  });
}

function convertRows(rows) {
  return rows.map((row) => {
    const out = { ...row };
    for (const key of Object.keys(out)) {
      if (BOOLEAN_COLUMNS.has(key) && out[key] !== null) out[key] = Boolean(out[key]);
    }
    return out;
  });
}

class SqlitePool {
  constructor(file) {
    this.db = new DatabaseSync(file || ":memory:");
    this.db.exec("PRAGMA foreign_keys = OFF");
    this.queue = Promise.resolve();
  }

  // Run one statement synchronously (SQLite is synchronous)
  exec(sql, params) {
    const text = String(sql).trim();

    // PostgreSQL-only statements that have no SQLite meaning
    if (/^DO\s+\$\$/i.test(text) || /^--optional\s*\n?\s*DO\s/i.test(text)) return { rows: [], rowCount: 0 };
    if (/ALTER\s+TABLE\s+\S+\s+DROP\s+CONSTRAINT/i.test(text)) return { rows: [], rowCount: 0 };

    // ALTER TABLE x ADD COLUMN IF NOT EXISTS col type ...
    const add = /^ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+([\s\S]+)$/i.exec(text);
    if (add) {
      const [, table, column, definition] = add;
      const exists = this.db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
      if (exists) return { rows: [], rowCount: 0 };
      const def = definition.replace(/DEFAULT\s+CURRENT_TIMESTAMP/gi, "").replace(/\bTIMESTAMPTZ\b/gi, "TEXT");
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
      return { rows: [], rowCount: 0 };
    }

    const translated = translate(text.replace(/^--optional\s*/i, ""));
    const bound = convertParams(params);

    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(translated) || /\bRETURNING\b/i.test(translated)) {
      const rows = convertRows(this.db.prepare(translated).all(...bound));
      return { rows, rowCount: rows.length };
    }

    if (bound.length === 0 && /;\s*\S/.test(translated)) {
      this.db.exec(translated);
      return { rows: [], rowCount: 0 };
    }

    const info = this.db.prepare(translated).run(...bound);
    return { rows: [], rowCount: Number(info.changes) };
  }

  // Serialise everything so a transaction held by one request never mixes with another
  _enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  query(sql, params) {
    return this._enqueue(() => {
      try {
        return this.exec(sql, params);
      } catch (error) {
        error.code = errorCode(error) || error.code;
        throw error;
      }
    });
  }

  async connect() {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let acquired;
    const ready = new Promise((resolve) => { acquired = resolve; });

    // Hold the queue until release() so BEGIN ... COMMIT stays together
    this._enqueue(() => { acquired(); return held; });
    await ready;

    const pool = this;
    let released = false;

    return {
      async query(sql, params) {
        try {
          return pool.exec(sql, params);
        } catch (error) {
          error.code = errorCode(error) || error.code;
          throw error;
        }
      },
      release() {
        if (!released) { released = true; release(); }
      }
    };
  }

  async end() { this.db.close(); }
  on() { return this; }
}

let shared = null;

function getPool() {
  if (!shared) shared = new SqlitePool(process.env.SQLITE_FILE || ":memory:");
  return shared;
}

module.exports = { getPool, SqlitePool, translate };
