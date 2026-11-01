/* Scheduled work: daily due-date reminders and the monthly report. Runs inside the server
   (no extra service needed). Admins can also run them by hand from Settings. */
const pool = require("../db");
const config = require("./config");
const logger = require("./logger");
const { today, addDays } = require("./validate");
const { getSetting, getNumberSetting } = require("./settings");
const { notifyStudent, notifyRoles, notifyUsers } = require("./notify");
const { runReport, toPdf } = require("./reports");
const { storeBuffer } = require("./filestore");

const weekKey = (iso) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / (7 * 864e5));
const roomText = (b, f, n) => `${b}-${String(f).padStart(2, "0")}-${String(n).padStart(2, "0")}`;

async function setSetting(key, value) {
  await pool.query("INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [key, value]);
}

/* Reminders for money that is due soon or late, late maintenance and students who have not returned */
async function runDailyChecks() {
  const t = today();
  const ahead = await getNumberSetting("reminder_days_before_due", 3);
  const soon = addDays(t, ahead);
  let sent = 0;

  const fees = (await pool.query(
    `SELECT fee_id, student_number, fee_type, to_char(due_date, 'YYYY-MM-DD') AS due, invoice_number FROM fees
     WHERE status IN ('Unpaid', 'Partially paid') AND to_char(due_date, 'YYYY-MM-DD') <= $1`, [soon])).rows;
  for (const f of fees) {
    const late = f.due < t;
    await notifyStudent(f.student_number, {
      title: late ? "Payment overdue" : "Payment due soon", type: "fee", page: "fees", related_id: f.fee_id,
      message: `${f.fee_type} (${f.invoice_number}) ${late ? "was due on" : "is due on"} ${f.due}.`,
      dedupe_key: late ? `fee-late-${f.fee_id}-${weekKey(t)}` : `fee-soon-${f.fee_id}`
    });
    sent += 1;
  }

  const fines = (await pool.query(
    `SELECT fine_id, student_number, fine_number, to_char(due_date, 'YYYY-MM-DD') AS due FROM fines
     WHERE status = 'Approved' AND to_char(due_date, 'YYYY-MM-DD') <= $1`, [soon])).rows;
  for (const f of fines) {
    const late = f.due < t;
    await notifyStudent(f.student_number, {
      title: late ? "Fine overdue" : "Fine due soon", type: "fine", page: "fines", related_id: f.fine_id,
      message: `Fine ${f.fine_number} ${late ? "was due on" : "is due on"} ${f.due}.`,
      dedupe_key: late ? `fine-late-${f.fine_id}-${weekKey(t)}` : `fine-soon-${f.fine_id}`
    });
    sent += 1;
  }

  const jobs = (await pool.query(
    `SELECT maintenance_id, maintenance_type, room_block, room_floor, room_number, assigned_user_id FROM maintenance_requests
     WHERE status <> 'Completed' AND expected_completion_date IS NOT NULL AND to_char(expected_completion_date, 'YYYY-MM-DD') < $1`, [t])).rows;
  for (const j of jobs) {
    const users = (await pool.query("SELECT user_id FROM users WHERE status = 'Active' AND role = 'warden'")).rows.map((u) => u.user_id);
    if (j.assigned_user_id) users.push(j.assigned_user_id);
    await notifyUsers(users, { title: "Maintenance overdue", message: `${j.maintenance_type} in room ${roomText(j.room_block, j.room_floor, j.room_number)} is past its expected date.`, type: "maintenance", page: "maintenance", related_id: j.maintenance_id, dedupe_key: `maint-late-${j.maintenance_id}-${t}` });
    sent += 1;
  }

  const away = (await pool.query(
    `SELECT leave_id, student_number FROM leave_requests WHERE status IN ('Approved', 'Departed') AND to_char(leave_to, 'YYYY-MM-DD') < $1`, [t])).rows;
  for (const l of away) {
    const people = (await pool.query("SELECT user_id FROM users WHERE status = 'Active' AND role IN ('warden', 'security')")).rows.map((u) => u.user_id);
    await notifyUsers(people, { title: "Student has not returned", message: `${l.student_number} is past the approved return date.`, type: "leave", page: "leaves", related_id: l.leave_id, dedupe_key: `leave-late-${l.leave_id}-${t}` });
    sent += 1;
  }

  await setSetting("last_daily_run", t);
  logger.info("Daily checks finished", { reminders: sent });
  return { reminders: sent, date: t };
}

function previousMonth(iso) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* The monthly management report (PDF), saved and announced */
async function runMonthlyReport(period, { force = false } = {}) {
  const month = period || previousMonth(today());
  const exists = await pool.query("SELECT file_id FROM report_archive WHERE report_key = 'monthly' AND period = $1", [month]);

  if (exists.rows.length && !force) return { period: month, created: false, file_id: exists.rows[0].file_id };

  const report = await runReport("monthly", { month });
  const fileId = await storeBuffer(toPdf(report), { mime: "application/pdf", name: `monthly-summary-${month}.pdf`, purpose: "report" });
  await pool.query("INSERT INTO report_archive (report_key, period, file_id, created_at) VALUES ('monthly', $1, $2, CURRENT_TIMESTAMP)", [month, fileId]);
  await notifyRoles(["management", "administrator"], { title: `Monthly report ${month} is ready`, message: "Open Reports to download the monthly summary (PDF).", type: "report", page: "reports", dedupe_key: `monthly-${month}` });

  await setSetting("last_monthly_run", month);
  logger.info("Monthly report created", { period: month });
  return { period: month, created: true, file_id: fileId };
}

/* Called once an hour: run each job at most once per day / month, after 06:00 */
async function tick(now = new Date()) {
  if (now.getHours() < 6) return;
  const t = today();

  if ((await getSetting("last_daily_run", "")) !== t) await runDailyChecks();

  const wanted = previousMonth(t);
  if ((await getSetting("last_monthly_run", "")) !== wanted) await runMonthlyReport(wanted);
}

let timer = null;

function startScheduler() {
  if (!config.schedulerEnabled || timer) return;
  const safe = () => tick().catch((error) => logger.error("Scheduled job failed", { message: error.message }));
  setTimeout(safe, 15 * 1000).unref();
  timer = setInterval(safe, 60 * 60 * 1000);
  timer.unref();
  logger.info("Scheduler started");
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runDailyChecks, runMonthlyReport, tick, startScheduler, stopScheduler, setSetting, previousMonth };
