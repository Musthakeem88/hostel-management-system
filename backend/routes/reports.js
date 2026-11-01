const express = require("express");
const pool = require("../db");
const { bad, notFound, forbidden } = require("../lib/http");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { fileUrl } = require("../lib/storage");
const { REPORTS, runReport, cleanFilters, toPdf, toXlsx } = require("../lib/reports");

const router = express.Router();
const ALLOWED = ["warden", "administrator", "management"];

/* GET /api/reports — the list of reports this person may open */
router.get("/", requireRole(...ALLOWED), (req, res) => {
  res.json(Object.entries(REPORTS)
    .filter(([, r]) => r.roles.includes(req.user.role))
    .map(([key, r]) => ({ key, title: r.title, description: r.description, filters: r.filters })));
});

/* GET /api/reports/archive — monthly reports made automatically */
router.get("/archive", requireRole("administrator", "management"), async (req, res) => {
  const r = await pool.query("SELECT report_id, report_key, period, file_id, created_at FROM report_archive ORDER BY period DESC, report_id DESC LIMIT 60");
  res.json(r.rows.map((x) => ({ ...x, url: fileUrl(x.file_id) })));
});

/* GET /api/reports/:key?format=json|pdf|xlsx&block=&from=&to=&month= */
router.get("/:key", requireRole(...ALLOWED), async (req, res) => {
  const def = REPORTS[req.params.key];
  if (!def) throw notFound("Unknown report.");
  if (!def.roles.includes(req.user.role)) throw forbidden();

  const format = String(req.query.format || "json");
  if (!["json", "pdf", "xlsx"].includes(format)) throw bad("Format must be json, pdf or xlsx.");

  const report = await runReport(req.params.key, cleanFilters(req.query));

  if (format === "json") return res.json(report);

  await audit(req, "export_report", "report", req.params.key, { format });
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    const buffer = toPdf(report);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${req.params.key}-${stamp}.pdf"`, "Content-Length": buffer.length });
    return res.send(buffer);
  }

  const buffer = toXlsx(report);
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${req.params.key}-${stamp}.xlsx"`,
    "Content-Length": buffer.length
  });
  res.send(buffer);
});

module.exports = router;
