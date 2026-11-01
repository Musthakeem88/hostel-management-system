/* Prometheus metrics in the standard text format (scrape GET /metrics). No packages. */
const pool = require("../db");

const BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const counts = new Map();   // "method|route|status" -> n
const hist = new Map();     // "method|route" -> { buckets:[], sum, count }

function routeLabel(req) {
  if (req.route && req.route.path !== undefined) return `${req.baseUrl || ""}${req.route.path === "/" ? "" : req.route.path}` || "/";
  if (req.path && !req.path.startsWith("/api")) return "static";
  return "unmatched";
}

function middleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = routeLabel(req);
    const key = `${req.method}|${route}|${res.statusCode}`;
    counts.set(key, (counts.get(key) || 0) + 1);

    const hkey = `${req.method}|${route}`;
    const h = hist.get(hkey) || { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((b, i) => { if (seconds <= b) h.buckets[i] += 1; });
    h.sum += seconds;
    h.count += 1;
    hist.set(hkey, h);
  });

  next();
}

let cache = { at: 0, text: "" };

async function businessGauges() {
  if (Date.now() - cache.at < 15000) return cache.text;

  const one = async (sql) => { try { return Number((await pool.query(sql)).rows[0].n || 0); } catch { return -1; } };
  const lines = [];
  const gauge = (name, help, value) => lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`);

  let up = 1;
  try { await pool.query("SELECT 1"); } catch { up = 0; }

  gauge("hostel_db_up", "1 when the database answers", up);
  if (up) {
    gauge("hostel_beds_occupied", "Occupied beds", await one("SELECT CAST(COALESCE(SUM(occupied), 0) AS INTEGER) AS n FROM rooms"));
    gauge("hostel_beds_total", "Total beds", await one("SELECT CAST(COALESCE(SUM(capacity), 0) AS INTEGER) AS n FROM rooms"));
    gauge("hostel_repairs_open", "Open repair requests", await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM repair_requests WHERE repair_status <> 'Completed'"));
    gauge("hostel_damage_awaiting_review", "Damage reports waiting for review", await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM damage_reports WHERE damage_status IS NULL OR damage_status IN ('Reported', 'Under Investigation')"));
    gauge("hostel_fines_unpaid", "Unpaid fines", await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM fines WHERE status IN ('Approved', 'Disputed', 'Under Review')"));
    gauge("hostel_applications_pending", "Room applications waiting", await one("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM room_applications WHERE status IN ('Pending', 'Waitlisted')"));
  }

  cache = { at: Date.now(), text: lines.join("\n") + "\n" };
  return cache.text;
}

async function render() {
  const out = [];

  out.push("# HELP hostel_http_requests_total HTTP requests", "# TYPE hostel_http_requests_total counter");
  for (const [key, n] of counts) {
    const [method, route, status] = key.split("|");
    out.push(`hostel_http_requests_total{method="${method}",route="${route}",status="${status}"} ${n}`);
  }

  out.push("# HELP hostel_http_request_duration_seconds HTTP request duration", "# TYPE hostel_http_request_duration_seconds histogram");
  for (const [key, h] of hist) {
    const [method, route] = key.split("|");
    BUCKETS.forEach((b, i) => out.push(`hostel_http_request_duration_seconds_bucket{method="${method}",route="${route}",le="${b}"} ${h.buckets[i]}`));
    out.push(`hostel_http_request_duration_seconds_bucket{method="${method}",route="${route}",le="+Inf"} ${h.count}`);
    out.push(`hostel_http_request_duration_seconds_sum{method="${method}",route="${route}"} ${h.sum.toFixed(6)}`);
    out.push(`hostel_http_request_duration_seconds_count{method="${method}",route="${route}"} ${h.count}`);
  }

  const mem = process.memoryUsage();
  out.push(
    "# HELP hostel_process_uptime_seconds Process uptime", "# TYPE hostel_process_uptime_seconds gauge", `hostel_process_uptime_seconds ${Math.round(process.uptime())}`,
    "# HELP hostel_process_resident_memory_bytes Resident memory", "# TYPE hostel_process_resident_memory_bytes gauge", `hostel_process_resident_memory_bytes ${mem.rss}`,
    "# HELP hostel_process_heap_used_bytes Heap used", "# TYPE hostel_process_heap_used_bytes gauge", `hostel_process_heap_used_bytes ${mem.heapUsed}`
  );

  out.push(await businessGauges());
  return out.join("\n") + "\n";
}

module.exports = { middleware, render };
