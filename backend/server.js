
const express = require("express");
const path = require("path");
require("dotenv").config();

const pool = require("./db");
const app = express();

const PORT = process.env.PORT || 3000;

// ==========================================
// 1. MIDDLEWARE
// ==========================================

app.use(express.json());
app.use(express.static(path.join(__dirname, "../Main")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../Main/index.html"));
});

// ==========================================
// 2. HEALTH CHECK
// ==========================================

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      message: "Server and database connected!"
    });
  } catch (error) {
    console.error("Database health check error:", error);

    res.status(500).json({
      success: false,
      error: "Database connection failed."
    });
  }
});

// ==========================================
// 3. GET ROOMS
// ==========================================

app.get("/api/rooms", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        block,
        floor,
        room_number,
        capacity,
        occupied,
        under_maintenance
      FROM public.rooms
      ORDER BY block, floor, room_number
    `);

    const rooms = result.rows.map((room) => ({
      ...room,
      room_id:
        `${String(room.block).trim()}-` +
        `${String(room.floor).padStart(2, "0")}-` +
        `${String(room.room_number).padStart(2, "0")}`
    }));

    res.json(rooms);
  } catch (error) {
    console.error("Load rooms error:", error);

    res.status(500).json({
      error: "Could not retrieve rooms."
    });
  }
});

// ==========================================
// 4. GET STUDENTS
// ==========================================

app.get("/api/students", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        student_id,
        student_number,
        full_name,
        email,
        phone,
        room_block,
        room_floor,
        room_number,
        created_at
      FROM public.students
      ORDER BY student_id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Load students error:", error);

    res.status(500).json({
      error: "Could not load students."
    });
  }
});

// ==========================================
// 5. REGISTER STUDENT
// ==========================================

app.post("/api/students", async (req, res) => {
  const {
    student_number,
    full_name,
    email,
    phone,
    room_block,
    room_floor,
    room_number
  } = req.body;

  if (
    typeof student_number !== "string" ||
    !student_number.trim() ||
    typeof full_name !== "string" ||
    !full_name.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    !room_block ||
    room_floor == null ||
    room_number == null
  ) {
    return res.status(400).json({
      error: "Complete all required fields and select a room."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const roomResult = await client.query(
      `SELECT capacity, occupied, under_maintenance
       FROM public.rooms
       WHERE block = $1
         AND floor = $2
         AND room_number = $3
       FOR UPDATE`,
      [room_block, Number(room_floor), Number(room_number)]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Room not found."
      });
    }

    const room = roomResult.rows[0];

    if (room.under_maintenance) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "This room is under maintenance."
      });
    }

    if (Number(room.occupied) >= Number(room.capacity)) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "This room is full."
      });
    }

    const result = await client.query(
      `INSERT INTO public.students
       (
         student_number,
         full_name,
         email,
         phone,
         room_block,
         room_floor,
         room_number
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        student_number.trim(),
        full_name.trim(),
        email.trim(),
        phone?.trim() || null,
        room_block,
        Number(room_floor),
        Number(room_number)
      ]
    );

    await client.query(
      `UPDATE public.rooms
       SET occupied = occupied + 1
       WHERE block = $1
         AND floor = $2
         AND room_number = $3`,
      [room_block, Number(room_floor), Number(room_number)]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Student registered successfully.",
      student: result.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Register student error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Student number or email is already registered."
      });
    }

    res.status(500).json({
      error: "Could not register student."
    });
  } finally {
    client.release();
  }
});

// ==========================================
// 6. GET INSPECTIONS
// ==========================================

app.get("/api/inspections", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM public.inspections
      ORDER BY inspection_date DESC, inspection_id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Load inspections error:", error);

    res.status(500).json({
      error: "Could not load inspections."
    });
  }
});

// ==========================================
// 7. CREATE INSPECTION
// ==========================================

app.post("/api/inspections", async (req, res) => {
  const {
    room_block,
    room_floor,
    room_number,
    student_number,
    inspection_type,
    inspection_items
  } = req.body;

  if (
    !room_block ||
    room_floor == null ||
    room_number == null ||
    typeof student_number !== "string" ||
    !student_number.trim() ||
    !["Check-in", "Check-out"].includes(inspection_type) ||
    !Array.isArray(inspection_items)
  ) {
    return res.status(400).json({
      error: "Please provide all required inspection details."
    });
  }

  try {
    const studentResult = await pool.query(
      `SELECT student_id
       FROM public.students
       WHERE student_number = $1
         AND room_block = $2
         AND room_floor = $3
         AND room_number = $4`,
      [
        student_number.trim(),
        room_block,
        Number(room_floor),
        Number(room_number)
      ]
    );

    if (studentResult.rows.length === 0) {
      return res.status(400).json({
        error: "The student is not assigned to the selected room."
      });
    }

    const result = await pool.query(
      `INSERT INTO public.inspections
       (
         room_block,
         room_floor,
         room_number,
         student_number,
         inspection_type,
         inspection_items
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        room_block,
        Number(room_floor),
        Number(room_number),
        student_number.trim(),
        inspection_type,
        JSON.stringify(inspection_items)
      ]
    );

    res.status(201).json({
      message: "Inspection saved successfully.",
      inspection: result.rows[0]
    });
  } catch (error) {
    console.error("Save inspection error:", error);

    res.status(500).json({
      error: "Could not save inspection."
    });
  }
});

// ==========================================
// 8. GET DAMAGE REPORTS
// ==========================================

app.get("/api/damages", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM public.damage_reports
      ORDER BY created_at DESC, damage_id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Load damage reports error:", error);

    res.status(500).json({
      error: "Could not load damage reports."
    });
  }
});

// ==========================================
// 9. CREATE DAMAGE REPORT
// ==========================================

app.post("/api/damages", async (req, res) => {
  const {
    room_block,
    room_floor,
    room_number,
    item_name,
    student_number,
    description,
    fine_amount
  } = req.body;

  const amount = Number(fine_amount);

  console.log("Received damage report:", req.body);

  if (
    !room_block ||
    room_floor == null ||
    room_number == null ||
    typeof item_name !== "string" ||
    !item_name.trim() ||
    typeof student_number !== "string" ||
    !student_number.trim() ||
    typeof description !== "string" ||
    !description.trim() ||
    fine_amount == null ||
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return res.status(400).json({
      error: "Please provide valid damage report details and fine amount."
    });
  }

  try {
    const studentResult = await pool.query(
      `SELECT student_id
       FROM public.students
       WHERE student_number = $1
         AND room_block = $2
         AND room_floor = $3
         AND room_number = $4`,
      [
        student_number.trim(),
        room_block,
        Number(room_floor),
        Number(room_number)
      ]
    );

    if (studentResult.rows.length === 0) {
      return res.status(400).json({
        error: "The student is not assigned to the selected room."
      });
    }

    // Keep the generated ID below the VARCHAR(20) limit.
    const reportNumber =
      "DMG-" +
      Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 10).toString();

    const result = await pool.query(
      `INSERT INTO public.damage_reports
       (
         report_number,
         room_block,
         room_floor,
         room_number,
         item_name,
         student_number,
         description,
         fine_amount
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        reportNumber,
        room_block,
        Number(room_floor),
        Number(room_number),
        item_name.trim(),
        student_number.trim(),
        description.trim(),
        amount
      ]
    );

    res.status(201).json({
      message: "Damage report created successfully.",
      damage: result.rows[0]
    });
  } catch (error) {
    console.error("Create damage report error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Duplicate report number. Please try again."
      });
    }

    res.status(500).json({
      error: "Could not create damage report."
    });
  }
});

// ==========================================
// 10. UPDATE FINE STATUS
// ==========================================


app.patch("/api/damages/:id/status", async (req, res) => {
  const status = String(req.body?.status ?? "").trim();
  const disputeReason = req.body?.dispute_reason;
  const damageId = Number(req.params.id);

  const allowedStatuses = [
    "Pending",
    "Under Review",
    "Approved",
    "Paid"
  ];

  console.log("Fine status update received:", {
    id: damageId,
    body: req.body,
    status: status
  });

  if (!Number.isInteger(damageId) || damageId <= 0) {
    return res.status(400).json({
      error: "Invalid damage report ID."
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: `Invalid fine status: "${status}".`,
      received: req.body?.status ?? null,
      allowedStatuses
    });
  }

  try {
    const result = await pool.query(
      `UPDATE public.damage_reports
       SET fine_status = $1,
           dispute_reason = CASE
             WHEN $2::text IS NULL THEN dispute_reason
             ELSE $2
           END
       WHERE damage_id = $3
       RETURNING *`,
      [
        status,
        disputeReason == null ? null : String(disputeReason),
        damageId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Damage report not found."
      });
    }

    return res.json({
      message: "Fine status updated successfully.",
      damage: result.rows[0]
    });
  } catch (error) {
    console.error("Update fine status error:", error);

    return res.status(500).json({
      error: "Could not update fine status."
    });
  }
});

// ==========================================
// 11. GET REPAIR REQUESTS
// ==========================================

app.get("/api/repairs", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM public.repair_requests
      ORDER BY created_at DESC, repair_id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Load repairs error:", error);

    res.status(500).json({
      error: "Could not load repair requests."
    });
  }
});

// ==========================================
// 12. CREATE REPAIR REQUEST
// ==========================================

app.post("/api/repairs", async (req, res) => {
  const {
    room_block,
    room_floor,
    room_number,
    item_name,
    description,
    priority
  } = req.body;

  if (
    !room_block ||
    room_floor == null ||
    room_number == null ||
    typeof item_name !== "string" ||
    !item_name.trim() ||
    typeof description !== "string" ||
    !description.trim() ||
    !["Normal", "Urgent"].includes(priority)
  ) {
    return res.status(400).json({
      error: "Please provide all required repair details."
    });
  }

  try {
    const roomResult = await pool.query(
      `SELECT 1
       FROM public.rooms
       WHERE block = $1
         AND floor = $2
         AND room_number = $3`,
      [room_block, Number(room_floor), Number(room_number)]
    );

    if (roomResult.rows.length === 0) {
      return res.status(400).json({
        error: "The selected room does not exist."
      });
    }

    // Generate a short request number on the server.
    const requestNumber =
      "REP-" +
      Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 10).toString();

    const result = await pool.query(
      `INSERT INTO public.repair_requests
       (
         request_number,
         room_block,
         room_floor,
         room_number,
         item_name,
         description,
         priority
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        requestNumber,
        room_block,
        Number(room_floor),
        Number(room_number),
        item_name.trim(),
        description.trim(),
        priority
      ]
    );

    res.status(201).json({
      message: "Repair request created successfully.",
      repair: result.rows[0]
    });
  } catch (error) {
    console.error("Create repair error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Duplicate repair request number. Please try again."
      });
    }

    res.status(500).json({
      error: "Could not create repair request."
    });
  }
});

// ==========================================
// 13. UPDATE REPAIR STATUS
// ==========================================


app.patch("/api/repairs/:id/status", async (req, res) => {
  const { status } = req.body;

  const repairId = Number(req.params.id);

  const allowedStatuses = [
    "Reported",
    "Assigned",
    "In Progress",
    "Completed"
  ];

  if (!Number.isInteger(repairId) || repairId <= 0) {
    return res.status(400).json({
      error: "Invalid repair request ID."
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: "Invalid repair status."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Find the repair and lock its database row.
    const existing = await client.query(
      `SELECT repair_id, repair_status
       FROM public.repair_requests
       WHERE repair_id = $1
       FOR UPDATE`,
      [repairId]
    );

    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Repair request not found."
      });
    }

    // Prevent changes after completion.
    if (existing.rows[0].repair_status === "Completed") {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "This repair is already Completed and cannot be changed."
      });
    }

    const result = await client.query(
      `UPDATE public.repair_requests
       SET repair_status = $1
       WHERE repair_id = $2
       RETURNING *`,
      [status, repairId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Repair status updated successfully.",
      repair: result.rows[0]
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Update repair status error:", error);

    return res.status(500).json({
      error: "Could not update repair status."
    });

  } finally {
    client.release();
  }
});


// ==========================================
// 14. UNKNOWN API ROUTES
// Keep this AFTER all API routes.
// ==========================================

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

// ==========================================
// 15. START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(
    `Hostel Management System running at http://localhost:${PORT}`
  );
});
