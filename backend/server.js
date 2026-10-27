const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, "../frontend");

// ---------- Middleware ----------
app.use(express.json());
app.use(express.static(FRONTEND_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// ---------- API routes ----------
app.use("/api/health", require("./routes/health"));
app.use("/api/rooms", require("./routes/rooms"));
app.use("/api/students", require("./routes/students"));
app.use("/api/inspections", require("./routes/inspections"));
app.use("/api/damages", require("./routes/damages"));
app.use("/api/repairs", require("./routes/repairs"));

// Unknown API routes (keep AFTER all API routes)
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

// ---------- Start ----------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Hostel Management System running at http://localhost:${PORT}`);
  });
}

module.exports = app;
