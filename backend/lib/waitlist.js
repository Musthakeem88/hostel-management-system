/* Gives free rooms to waiting applicants, in the order they applied. */
const pool = require("../db");
const logger = require("./logger");
const { allocate, findAvailableRoom, AllocationError } = require("./allocation");
const { notifyStudent } = require("./notify");
const { roomId } = require("./validate");
const { audit } = require("./audit");

async function renumber() {
  const waiting = (await pool.query(
    "SELECT application_id FROM room_applications WHERE status = 'Waitlisted' ORDER BY waitlist_position, application_id")).rows;
  let position = 1;
  for (const w of waiting) {
    await pool.query("UPDATE room_applications SET waitlist_position = $1 WHERE application_id = $2", [position, w.application_id]);
    position += 1;
  }
}

async function processWaitlist(actorReq) {
  let allocated = 0;
  const waiting = (await pool.query(
    "SELECT * FROM room_applications WHERE status = 'Waitlisted' ORDER BY waitlist_position, application_id")).rows;

  for (const app of waiting) {
    const room = await findAvailableRoom(pool, { preferredBlock: app.preferred_block, roomType: app.preferred_room_type });
    if (!room) break; // no space left anywhere

    const client = await pool.connect();
    let student;
    try {
      await client.query("BEGIN");
      student = await allocate(client, app, { block: room.block, floor: Number(room.floor), number: Number(room.room_number) }, actorReq && actorReq.user ? actorReq.user.id : null);
      await client.query(
        `UPDATE room_applications SET status = 'Approved', waitlist_position = NULL, assigned_block = $1, assigned_floor = $2,
                assigned_number = $3, decided_at = CURRENT_TIMESTAMP, decision_note = 'Room allocated from the waiting list'
         WHERE application_id = $4`,
        [room.block, room.floor, room.room_number, app.application_id]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      client.release();
      if (!(error instanceof AllocationError)) logger.warn("Waiting-list allocation failed", { message: error.message });
      continue;
    }
    client.release();

    allocated += 1;
    const rid = roomId(room.block, room.floor, room.room_number);
    await notifyStudent(app.student_number, { title: "A room is ready for you", message: `You have been allocated room ${rid} from the waiting list.`, type: "application", page: "applications", related_id: app.application_id });
    await audit(actorReq, "waitlist_allocate", "application", app.application_id, { student: app.student_number, room: rid });
  }

  await renumber();
  return { allocated };
}

module.exports = { processWaitlist, renumber };
