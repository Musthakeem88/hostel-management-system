const express = require("express");
const pool = require("../db");
const config = require("../lib/config");
const { bad } = require("../lib/http");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { runDailyChecks, runMonthlyReport, setSetting } = require("../lib/scheduler");
const { getSetting } = require("../lib/settings");

const router = express.Router();

const SETTINGS = {
  deposit_amount: { label: "Security deposit (RM)", type: "money" },
  hostel_fee_amount: { label: "Hostel fee per student (RM)", type: "money" },
  fine_due_days: { label: "Days to pay a fine", type: "days", max: 90 },
  reminder_days_before_due: { label: "Remind this many days before a due date", type: "days", max: 30 },
  late_return_time: { label: "Curfew / latest return time (HH:MM)", type: "time" }
};

router.get("/settings", requireRole("administrator"), async (req, res) => {
  const out = [];
  for (const [key, def] of Object.entries(SETTINGS)) out.push({ key, ...def, value: await getSetting(key, "") });
  res.json(out);
});

router.put("/settings", requireRole("administrator"), async (req, res) => {
  const body = req.body || {};
  const changed = [];

  for (const [key, def] of Object.entries(SETTINGS)) {
    if (body[key] === undefined) continue;
    const value = String(body[key]).trim();

    if (def.type === "money" && !(Number.isFinite(Number(value)) && Number(value) >= 0)) throw bad(`${def.label} must be a valid amount.`);
    if (def.type === "days" && !(Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= def.max)) throw bad(`${def.label} must be a whole number from 0 to ${def.max}.`);
    if (def.type === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw bad(`${def.label} must look like 22:00.`);

    await setSetting(key, value);
    changed.push(key);
  }

  await audit(req, "update_settings", "settings", changed.join(","), body);
  res.json({ message: "Settings saved.", changed });
});

router.get("/status", requireRole("administrator"), async (req, res) => {
  let database = "ok";
  try { await pool.query("SELECT 1"); } catch { database = "unreachable"; }

  res.json({
    database,
    uptime_seconds: Math.round(process.uptime()),
    node: process.version,
    storage: config.storageDriver,
    scheduler: config.schedulerEnabled ? "on" : "off",
    last_daily_run: await getSetting("last_daily_run", "never"),
    last_monthly_run: await getSetting("last_monthly_run", "never"),
    student_signup: config.allowStudentSignup
  });
});

router.post("/run-daily", requireRole("administrator"), async (req, res) => {
  const result = await runDailyChecks();
  await audit(req, "run_daily_checks", "system", null, result);
  res.json({ message: `Daily checks finished — ${result.reminders} reminder(s) sent.`, ...result });
});

router.post("/run-monthly", requireRole("administrator"), async (req, res) => {
  const month = req.body && req.body.month;
  if (month && !/^\d{4}-\d{2}$/.test(String(month))) throw bad("Month must look like 2026-09.");
  const result = await runMonthlyReport(month, { force: true });
  await audit(req, "run_monthly_report", "system", null, result);
  res.json({ message: `Monthly report for ${result.period} created.`, ...result });
});

module.exports = router;
