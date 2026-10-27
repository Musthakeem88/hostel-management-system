const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
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

module.exports = router;
