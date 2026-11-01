/* Putting students into rooms and taking them out again.
   Every function takes `db` — pass a transaction client so the whole move is all-or-nothing. */
const { today } = require("./validate");
const { assignBed, freeBed, ensureBeds, ensureCleaningJob } = require("./rooms");
const { createAllocationFees } = require("./billing");

class AllocationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Locks the room and checks it can take one more student
async function reserveBed(db, block, floor, number) {
  const r = await db.query(
    "SELECT capacity, occupied, under_maintenance FROM rooms WHERE block = $1 AND floor = $2 AND room_number = $3 FOR UPDATE",
    [block, floor, number]
  );
  if (!r.rows.length) throw new AllocationError(404, "Room not found.");
  const room = r.rows[0];
  if (room.under_maintenance) throw new AllocationError(400, "This room is under maintenance.");
  if (Number(room.occupied) >= Number(room.capacity)) throw new AllocationError(400, "This room is full.");

  await db.query("UPDATE rooms SET occupied = occupied + 1 WHERE block = $1 AND floor = $2 AND room_number = $3", [block, floor, number]);
  await ensureBeds(db, block, floor, number, room.capacity);
}

async function releaseBed(db, block, floor, number) {
  await db.query(
    `UPDATE rooms SET occupied = CASE WHEN occupied > 0 THEN occupied - 1 ELSE 0 END
     WHERE block = $1 AND floor = $2 AND room_number = $3`,
    [block, floor, number]
  );
}

/* Registers a student in a room (new student, or a returning one who checked out). */
async function allocate(db, student, room, actorId) {
  const existing = (await db.query("SELECT * FROM students WHERE student_number = $1", [student.student_number])).rows[0];

  if (existing && (existing.student_status == null || existing.student_status === "Active")) {
    throw new AllocationError(409, "This student already has a room.");
  }

  await reserveBed(db, room.block, room.floor, room.number);

  let row;
  if (existing) {
    row = (await db.query(
      `UPDATE students SET full_name = $1, email = $2, phone = $3, room_block = $4, room_floor = $5, room_number = $6,
              faculty = $7, emergency_contact_name = $8, emergency_contact_phone = $9, hostel = $4,
              student_status = 'Active', check_in_date = $10, check_out_date = NULL
       WHERE student_number = $11 RETURNING *`,
      [student.full_name, student.email, student.phone || null, room.block, room.floor, room.number,
       student.faculty || null, student.emergency_contact_name || null, student.emergency_contact_phone || null, today(), student.student_number]
    )).rows[0];
  } else {
    row = (await db.query(
      `INSERT INTO students
         (student_number, full_name, email, phone, room_block, room_floor, room_number,
          faculty, emergency_contact_name, emergency_contact_phone, hostel, student_status, check_in_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $5, 'Active', $11)
       RETURNING *`,
      [student.student_number, student.full_name, student.email, student.phone || null, room.block, room.floor, room.number,
       student.faculty || null, student.emergency_contact_name || null, student.emergency_contact_phone || null, today()]
    )).rows[0];
  }

  await assignBed(db, row.student_number, room.block, room.floor, room.number);

  // link to the student's login if they already have one
  await db.query(
    "UPDATE students SET user_id = (SELECT user_id FROM users WHERE student_number = $1 ORDER BY user_id LIMIT 1) WHERE student_number = $1",
    [row.student_number]
  );

  await ensureCleaningJob(db, room.block, room.floor, room.number, { studentNumber: row.student_number, userId: actorId });
  await createAllocationFees(db, row.student_number, actorId);

  return row;
}

/* Frees the student's bed (check-out, or the first half of a room transfer). */
async function vacate(db, student) {
  await releaseBed(db, student.room_block, student.room_floor, student.room_number);
  await freeBed(db, student.student_number);
}

// Best room for an application: preferred block first, then most-filled room that still has space
async function findAvailableRoom(db, { preferredBlock, roomType, excludeRoom } = {}) {
  const rooms = (await db.query(
    `SELECT block, floor, room_number, capacity, occupied, room_type FROM rooms
     WHERE under_maintenance = FALSE AND occupied < capacity
     ORDER BY occupied DESC, block, floor, room_number`
  )).rows;

  const usable = rooms.filter((r) =>
    !(excludeRoom && r.block === excludeRoom.block && Number(r.floor) === Number(excludeRoom.floor) && Number(r.room_number) === Number(excludeRoom.number)));

  const score = (r) =>
    (preferredBlock && String(r.block) === String(preferredBlock) ? 2 : 0) +
    (roomType && r.room_type === roomType ? 1 : 0);

  usable.sort((a, b) => score(b) - score(a));
  return usable[0] || null;
}

module.exports = { AllocationError, allocate, vacate, reserveBed, releaseBed, findAvailableRoom };
