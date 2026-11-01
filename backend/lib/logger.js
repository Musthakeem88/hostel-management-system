/* Structured JSON logging (one JSON object per line) — easy to ship to Loki / CloudWatch. */
const config = require("./config");

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function write(level, message, fields) {
  if ((LEVELS[level] || 20) < (LEVELS[config.logLevel] || 20)) return;

  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...fields
  });

  (level === "error" ? process.stderr : process.stdout).write(line + "\n");
}

module.exports = {
  debug: (m, f) => write("debug", m, f),
  info: (m, f) => write("info", m, f),
  warn: (m, f) => write("warn", m, f),
  error: (m, f) => write("error", m, f)
};
