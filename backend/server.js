const express = require("express");
const path = require("path");
const crypto = require("crypto");
const config = require("./lib/config");
const logger = require("./lib/logger");
const metrics = require("./lib/metrics");
const { HttpError, apiNotFound, errorHandler } = require("./lib/http");
const { authenticate } = require("./lib/auth");

const FRONTEND_DIR = path.join(__dirname, "../frontend");

async function createApp({ startup = true } = {}) {
  if (startup) {
    await require("./lib/migrate").migrate();
    await require("./lib/seed").seed();
  }

  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);

  /* ---------- security headers, request ids, logging, metrics ---------- */
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    });
    req.id = req.headers["x-request-id"] || crypto.randomUUID();
    res.set("X-Request-Id", req.id);
    next();
  });
  app.use(metrics.middleware);
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (req.path === "/metrics" || req.path === "/api/health") return;
      logger.info("request", {
        id: req.id, method: req.method, path: req.originalUrl.split("?")[0], status: res.statusCode,
        ms: Date.now() - start, user: req.user ? req.user.id : undefined, trace: req.headers.traceparent
      });
    });
    next();
  });

  /* ---------- photo upload / signed download (own body limits) ---------- */
  const files = require("./routes/files");
  app.use("/api/files", files.uploadRouter, files.downloadRouter);

  app.use(express.json({ limit: "1mb" }));

  /* ---------- front end and monitoring ---------- */
  app.use(express.static(FRONTEND_DIR, { index: false, maxAge: config.isProduction ? "1h" : 0 }));
  app.get("/", (req, res) => res.sendFile(path.join(FRONTEND_DIR, "index.html")));

  app.get("/metrics", async (req, res) => {
    if (config.metricsToken && req.headers.authorization !== `Bearer ${config.metricsToken}`) return res.status(401).send("Unauthorized\n");
    res.set("Content-Type", "text/plain; version=0.0.4").send(await metrics.render());
  });

  /* ---------- public API ---------- */
  app.use("/api/health", require("./routes/health"));
  app.use("/api/auth", require("./routes/auth").publicRouter);

  /* ---------- everything below needs a signed-in user ---------- */
  app.use("/api", authenticate);
  app.use("/api", (req, res, next) => {
    // someone with a temporary password may only change it
    if (req.user.mustChangePassword && !req.originalUrl.startsWith("/api/auth/")) {
      return next(new HttpError(403, "Please change your temporary password first.", { mustChangePassword: true }));
    }
    next();
  });

  app.use("/api/auth", require("./routes/auth").privateRouter);
  app.use("/api/meta", require("./routes/meta"));
  app.use("/api/profile", require("./routes/profile"));
  app.use("/api/dashboard", require("./routes/dashboard"));
  app.use("/api/notifications", require("./routes/notifications"));
  app.use("/api/search", require("./routes/search"));

  app.use("/api/users", require("./routes/users"));
  app.use("/api/hostels", require("./routes/hostels"));
  app.use("/api/rooms", require("./routes/rooms"));
  app.use("/api/students", require("./routes/students"));
  app.use("/api/items", require("./routes/items"));
  app.use("/api/inspections", require("./routes/inspections"));
  app.use("/api/damages", require("./routes/damages"));
  app.use("/api/fines", require("./routes/fines"));
  app.use("/api/repairs", require("./routes/repairs"));
  app.use("/api/maintenance", require("./routes/maintenance"));
  app.use("/api/applications", require("./routes/applications"));

  const fees = require("./routes/fees");
  app.use("/api/fees", fees.feesRouter);
  app.use("/api/payments", fees.paymentsRouter);
  app.use("/api/deposits", fees.depositsRouter);

  app.use("/api/reports", require("./routes/reports"));
  app.use("/api/audit", require("./routes/audit"));
  app.use("/api/system", require("./routes/system"));
  app.use("/api/m", require("./routes/modules"));

  app.use("/api", apiNotFound);
  app.use(errorHandler);

  return app;
}

async function start() {
  if (config.isProduction && (config.jwtSecretIsGenerated || config.jwtSecretIsWeak)) {
    throw new Error("Set JWT_SECRET in backend/.env to a random string of at least 32 characters before running in production.");
  }

  const app = await createApp();

  if (config.jwtSecretIsGenerated) {
    logger.warn("JWT_SECRET is not set: everyone will be signed out whenever the server restarts. Add JWT_SECRET to backend/.env.");
  } else if (config.jwtSecretIsWeak) {
    logger.warn("JWT_SECRET is shorter than 32 characters. Use a longer random secret (see backend/.env.example).");
  }

  const server = app.listen(config.port, () => {
    logger.info(`Hostel Management System running at http://localhost:${config.port}`);
  });

  require("./lib/scheduler").startScheduler();

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    require("./lib/scheduler").stopScheduler();
    server.close(async () => {
      try { await require("./db").end(); } catch { /* already closed */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

if (require.main === module) {
  start().catch((error) => {
    logger.error("Could not start the server", { message: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { createApp, start };
