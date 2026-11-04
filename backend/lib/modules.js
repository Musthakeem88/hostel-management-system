/* Definitions of the "list + form + approval buttons" modules.
   One generic engine (routes/modules.js) turns each definition into API routes,
   and the front end draws the page from the same definition (GET /api/meta). */
const { roomId, today } = require("./validate");
const { bad, HttpError } = require("./http");
const { getSetting } = require("./settings");
const { reserveBed, vacate, AllocationError } = require("./allocation");
const { assignBed, ensureCleaningJob } = require("./rooms");
const { notifyRoles, notifyStudent } = require("./notify");

const STAFF_ALL = ["warden", "administrator", "maintenance", "security", "management"];
const ALL_ROLES = ["student", ...STAFF_ALL];

/* A "when" helper: now as 'YYYY-MM-DD HH:MM' in server time */
const pad = (n) => String(n).padStart(2, "0");
const nowParts = () => {
  const d = new Date();
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

const modules = {
  /* ---------------------------------------------------------------- visitors */
  visitors: {
    title: "Visitors", icon: "visitors", table: "visitors", pk: "visitor_id", order: "visit_date DESC, visitor_id DESC",
    ownerField: "student_number", listRoles: ["student", "warden", "administrator", "security"],
    createRoles: ["student", "warden", "administrator", "security"], statusField: "status",
    summary: "Visitors are approved by the warden and checked in and out at the gate.",
    columns: [
      { name: "visitor_id", label: "ID", hidden: true }, { name: "visit_date", label: "Visit date", type: "date" },
      { name: "student_number", label: "Student" }, { name: "visitor_name", label: "Visitor" },
      { name: "relationship", label: "Relationship" }, { name: "purpose", label: "Purpose" },
      { name: "status", label: "Status", type: "badge" }, { name: "time_in", label: "In", type: "time" }, { name: "time_out", label: "Out", type: "time" }
    ],
    fields: [
      { name: "student_number", label: "Student visited", type: "student", required: true },
      { name: "visitor_name", label: "Visitor name", type: "text", required: true, max: 120 },
      { name: "visitor_ic", label: "ID / IC number", type: "text", max: 30 },
      { name: "relationship", label: "Relationship", type: "select", options: ["Parent", "Sibling", "Relative", "Friend", "Other"] },
      { name: "purpose", label: "Purpose of visit", type: "text", max: 200 },
      { name: "visit_date", label: "Visit date", type: "date", required: true, default: "today" }
    ],
    beforeCreate({ user, values }) {
      values.status = ["warden", "administrator"].includes(user.role) ? "Approved" : "Pending";
      values.recorded_by = user.id;
    },
    async afterCreate({ values, row }) {
      if (values.status === "Pending") await notifyRoles(["warden"], { title: "Visitor waiting for approval", message: `${values.visitor_name} to visit ${values.student_number} on ${values.visit_date}.`, type: "visitor", page: "visitors", related_id: row.visitor_id });
    },
    actions: [
      { key: "approve", label: "Approve", roles: ["warden", "administrator"], from: ["Pending"], set: { status: "Approved" }, setUser: { decided_by: "id" }, tone: "good",
        notify: (row) => ({ student: row.student_number, title: "Visitor approved", message: `${row.visitor_name} may visit on ${String(row.visit_date).slice(0, 10)}.` }) },
      { key: "reject", label: "Reject", roles: ["warden", "administrator"], from: ["Pending"], set: { status: "Rejected" }, setUser: { decided_by: "id" }, tone: "bad", confirm: "Reject this visitor?",
        notify: (row) => ({ student: row.student_number, title: "Visitor rejected", message: `${row.visitor_name} was not approved.` }) },
      { key: "check_in", label: "Check in", roles: ["security", "warden", "administrator"], from: ["Approved"], set: { status: "Checked in" }, stamps: ["time_in"] },
      { key: "check_out", label: "Check out", roles: ["security", "warden", "administrator"], from: ["Checked in"], set: { status: "Checked out" }, stamps: ["time_out"] }
    ]
  },

  /* ---------------------------------------------------------------- leave */
  leaves: {
    title: "Leave & late return", icon: "leaves", table: "leave_requests", pk: "leave_id", order: "leave_from DESC, leave_id DESC",
    ownerField: "student_number", listRoles: ["student", "warden", "administrator", "security"],
    createRoles: ["student", "warden", "administrator", "security"], statusField: "status",
    summary: "Students ask permission to leave or return late. Security records when students come back.",
    columns: [
      { name: "leave_id", label: "ID", hidden: true }, { name: "student_number", label: "Student" },
      { name: "leave_type", label: "Type" }, { name: "destination", label: "Destination" },
      { name: "leave_from", label: "From", type: "date" }, { name: "leave_to", label: "To", type: "date" },
      { name: "return_time", label: "Return by" }, { name: "status", label: "Status", type: "badge" },
      { name: "returned_at", label: "Returned", type: "time" }, { name: "decision_note", label: "Note" }
    ],
    fields: [
      { name: "student_number", label: "Student", type: "student", required: true },
      { name: "leave_type", label: "Type", type: "select", required: true, options: ["Weekend", "Home visit", "Medical", "Emergency", "Late return permission", "Other", "Late arrival"] },
      { name: "destination", label: "Destination", type: "text", max: 150 },
      { name: "reason", label: "Reason", type: "textarea", required: true, max: 500 },
      { name: "leave_from", label: "From", type: "date", required: true, default: "today" },
      { name: "leave_to", label: "To", type: "date", required: true, default: "today" },
      { name: "return_time", label: "Return by (HH:MM)", type: "text", max: 5, pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }
    ],
    beforeCreate({ user, values }) {
      if (values.leave_to < values.leave_from) throw bad("The return date cannot be before the leave date.");
      if (values.leave_type === "Late arrival") {
        if (!["security", "warden", "administrator"].includes(user.role)) throw bad("Only security or wardens can record a late arrival.");
        values.status = "Returned late";
        values.returned_late = 1;
        values.returned_at = { sql: "CURRENT_TIMESTAMP" };
        values.recorded_by = user.id;
      } else {
        values.status = "Pending";
      }
    },
    async afterCreate({ values, row }) {
      if (values.status === "Pending") await notifyRoles(["warden"], { title: "Leave request waiting", message: `${values.student_number}: ${values.leave_type} (${values.leave_from} to ${values.leave_to}).`, type: "leave", page: "leaves", related_id: row.leave_id });
      if (values.status === "Returned late") await notifyRoles(["warden"], { title: "Late arrival recorded", message: `${values.student_number} arrived late. ${values.reason}`, type: "leave", page: "leaves", related_id: row.leave_id });
    },
    actions: [
      { key: "approve", label: "Approve", roles: ["warden", "administrator"], from: ["Pending"], set: { status: "Approved" }, setUser: { decided_by: "id" }, tone: "good",
        inputs: [{ name: "decision_note", label: "Note (optional)", type: "text", max: 300 }],
        notify: (row) => ({ student: row.student_number, title: "Leave approved", message: `Your ${row.leave_type.toLowerCase()} request was approved.` }) },
      { key: "reject", label: "Reject", roles: ["warden", "administrator"], from: ["Pending"], set: { status: "Rejected" }, setUser: { decided_by: "id" }, tone: "bad",
        inputs: [{ name: "decision_note", label: "Reason", type: "text", required: true, max: 300 }],
        notify: (row, input) => ({ student: row.student_number, title: "Leave rejected", message: input.decision_note }) },
      { key: "depart", label: "Left hostel", roles: ["security", "warden", "administrator"], from: ["Approved"], set: { status: "Departed" } },
      { key: "returned", label: "Mark returned", roles: ["security", "warden", "administrator"], from: ["Approved", "Departed"], tone: "good",
        async handler({ client, row, user }) {
          // late = after the approved return date + time (default curfew from settings)
          const limitTime = row.return_time || (await getSetting("late_return_time", "22:00", client));
          const now = nowParts();
          const late = now.date > String(row.leave_to).slice(0, 10) || (now.date === String(row.leave_to).slice(0, 10) && now.time > limitTime);
          await client.query(
            "UPDATE leave_requests SET status = $1, returned_late = $2, returned_at = CURRENT_TIMESTAMP, recorded_by = $3 WHERE leave_id = $4",
            [late ? "Returned late" : "Returned", late ? 1 : 0, user.id, row.leave_id]);
          return { late };
        },
        after: async ({ row, result }) => { if (result && result.late) await notifyRoles(["warden"], { title: "Late return", message: `${row.student_number} returned late.`, type: "leave", page: "leaves", related_id: row.leave_id }); } }
    ]
  },

  /* ---------------------------------------------------------------- room transfer */
  transfers: {
    title: "Room transfers", icon: "transfers", table: "room_transfers", pk: "transfer_id", order: "transfer_id DESC",
    ownerField: "student_number", listRoles: ["student", "warden", "administrator"],
    createRoles: ["student", "warden", "administrator"], statusField: "status",
    summary: "Students ask to move rooms. The administrator approves and picks the new room.",
    columns: [
      { name: "transfer_id", label: "ID", hidden: true }, { name: "student_number", label: "Student" },
      { name: "from_room", label: "From", type: "computed" }, { name: "to_room", label: "To", type: "computed" },
      { name: "preferred_block", label: "Preferred hostel" }, { name: "reason", label: "Reason" },
      { name: "status", label: "Status", type: "badge" }, { name: "decision_note", label: "Decision" }
    ],
    selectExtra: ["from_block", "from_floor", "from_number", "to_block", "to_floor", "to_number"],
    present(row) {
      return {
        ...row,
        from_room: row.from_block ? roomId(row.from_block, row.from_floor, row.from_number) : "",
        to_room: row.to_block ? roomId(row.to_block, row.to_floor, row.to_number) : ""
      };
    },
    fields: [
      { name: "student_number", label: "Student", type: "student", required: true },
      { name: "preferred_block", label: "Preferred hostel", type: "block" },
      { name: "reason", label: "Reason for moving", type: "textarea", required: true, max: 500 }
    ],
    async beforeCreate({ client, values }) {
      const s = (await client.query(
        "SELECT room_block, room_floor, room_number FROM students WHERE student_number = $1 AND (student_status IS NULL OR student_status = 'Active')", [values.student_number])).rows[0];
      if (!s) throw bad("The student does not have a room to move from.");
      const open = await client.query("SELECT 1 FROM room_transfers WHERE student_number = $1 AND status = 'Pending'", [values.student_number]);
      if (open.rows.length) throw new HttpError(409, "There is already a pending transfer request for this student.");
      values.from_block = s.room_block; values.from_floor = s.room_floor; values.from_number = s.room_number;
      values.status = "Pending";
    },
    async afterCreate({ values, row }) {
      await notifyRoles(["administrator"], { title: "Room transfer waiting", message: `${values.student_number} asks to move rooms.`, type: "transfer", page: "transfers", related_id: row.transfer_id });
    },
    actions: [
      { key: "approve", label: "Approve & move", roles: ["administrator"], from: ["Pending"], tone: "good",
        inputs: [{ name: "to_room", label: "New room", type: "room", required: true }, { name: "decision_note", label: "Note (optional)", type: "text", max: 300 }],
        async handler({ client, row, input, user }) {
          const target = input.to_room;
          if (target.block === row.from_block && Number(target.floor) === Number(row.from_floor) && Number(target.number) === Number(row.from_number)) throw bad("The student is already in that room.");

          const student = (await client.query("SELECT * FROM students WHERE student_number = $1", [row.student_number])).rows[0];
          try {
            await reserveBed(client, target.block, target.floor, target.number);
          } catch (error) {
            if (error instanceof AllocationError) throw new HttpError(error.status, error.message);
            throw error;
          }
          await vacate(client, student);
          await client.query("UPDATE students SET room_block = $1, room_floor = $2, room_number = $3, hostel = $1 WHERE student_number = $4", [target.block, target.floor, target.number, row.student_number]);
          await assignBed(client, row.student_number, target.block, target.floor, target.number);
          await ensureCleaningJob(client, target.block, target.floor, target.number, { studentNumber: row.student_number, userId: user.id });
          await client.query(
            `UPDATE room_transfers SET status = 'Completed', to_block = $1, to_floor = $2, to_number = $3, decision_note = $4,
                    decided_by = $5, completed_at = CURRENT_TIMESTAMP WHERE transfer_id = $6`,
            [target.block, target.floor, target.number, input.decision_note || "Approved", user.id, row.transfer_id]);
          return { to: roomId(target.block, target.floor, target.number) };
        },
        after: async ({ row, result }) => {
          await notifyStudent(row.student_number, { title: "Room transfer approved", message: `You have been moved to room ${result.to}. A check-out inspection of the old room and a check-in inspection of the new room will follow.`, type: "transfer", page: "myroom" });
          await notifyRoles(["warden"], { title: "Room transfer completed", message: `${row.student_number} moved to ${result.to}. Please inspect both rooms.`, type: "transfer", page: "inspections" });
        } },
      { key: "reject", label: "Reject", roles: ["administrator"], from: ["Pending"], set: { status: "Rejected" }, setUser: { decided_by: "id" }, tone: "bad",
        inputs: [{ name: "decision_note", label: "Reason", type: "text", required: true, max: 300 }],
        notify: (row, input) => ({ student: row.student_number, title: "Room transfer declined", message: input.decision_note }) }
    ]
  },

  /* ---------------------------------------------------------------- complaints */
  complaints: {
    title: "Complaints & feedback", icon: "complaints", table: "complaints", pk: "complaint_id", order: "complaint_id DESC",
    ownerField: "student_number", listRoles: ["student", "warden", "administrator"], createRoles: ["student"], statusField: "status",
    summary: "Students send complaints, feedback or suggestions. Wardens reply.",
    columns: [
      { name: "complaint_id", label: "ID", hidden: true }, { name: "student_number", label: "Student" },
      { name: "category", label: "Type" }, { name: "subject", label: "Subject" }, { name: "message", label: "Message" },
      { name: "status", label: "Status", type: "badge" }, { name: "response", label: "Reply" }
    ],
    fields: [
      { name: "student_number", label: "Student", type: "student", required: true },
      { name: "category", label: "Type", type: "select", required: true, options: ["Complaint", "Feedback", "Suggestion"] },
      { name: "subject", label: "Subject", type: "text", required: true, max: 150 },
      { name: "message", label: "Message", type: "textarea", required: true, max: 2000 }
    ],
    beforeCreate({ values }) { values.status = "Open"; },
    async afterCreate({ values, row }) { await notifyRoles(["warden"], { title: `New ${String(values.category).toLowerCase()}`, message: values.subject, type: "complaint", page: "complaints", related_id: row.complaint_id }); },
    actions: [
      { key: "review", label: "Start review", roles: ["warden", "administrator"], from: ["Open"], set: { status: "In review" } },
      { key: "respond", label: "Reply & resolve", roles: ["warden", "administrator"], from: ["Open", "In review"], set: { status: "Resolved" }, setUser: { responded_by: "id" }, stamps: ["responded_at"], tone: "good",
        inputs: [{ name: "response", label: "Your reply", type: "textarea", required: true, max: 1000 }],
        notify: (row, input) => ({ student: row.student_number, title: "Reply to your message", message: input.response.slice(0, 150) }) }
    ]
  },

  /* ---------------------------------------------------------------- notice board */
  notices: {
    title: "Notice board", icon: "notices", table: "notices", pk: "notice_id", order: "publish_date DESC, notice_id DESC",
    listRoles: ALL_ROLES, createRoles: ["warden", "administrator"], editRoles: ["warden", "administrator"], statusField: "status",
    summary: "Announcements for students and staff.",
    columns: [
      { name: "notice_id", label: "ID", hidden: true }, { name: "publish_date", label: "Date", type: "date" },
      { name: "title", label: "Title" }, { name: "body", label: "Notice" }, { name: "audience", label: "For" },
      { name: "priority", label: "Priority", type: "badge" }, { name: "expires_date", label: "Expires", type: "date" },
      { name: "status", label: "Status", type: "badge" }, { name: "posted_by_name", label: "Posted by" }
    ],
    fields: [
      { name: "title", label: "Title", type: "text", required: true, max: 150, editable: true },
      { name: "body", label: "Notice", type: "textarea", required: true, max: 3000, editable: true },
      { name: "audience", label: "For", type: "select", options: ["All", "Students", "Staff"], default: "All", editable: true },
      { name: "priority", label: "Priority", type: "select", options: ["Normal", "Important"], default: "Normal", editable: true },
      { name: "publish_date", label: "Publish date", type: "date", default: "today" },
      { name: "expires_date", label: "Expires on", type: "date", editable: true }
    ],
    scope(user) {
      if (["warden", "administrator"].includes(user.role)) return { sql: "", params: [] };
      const audiences = user.role === "student" ? ["All", "Students"] : ["All", "Staff"];
      return { sql: `status = 'Published' AND publish_date <= $1 AND (expires_date IS NULL OR expires_date >= $1) AND audience IN ('${audiences.join("','")}')`, params: [today()] };
    },
    beforeCreate({ user, values }) {
      values.status = "Published"; values.posted_by = user.id; values.posted_by_name = user.name;
      if (values.expires_date && values.expires_date < values.publish_date) throw bad("The expiry date cannot be before the publish date.");
    },
    async afterCreate({ values, row, pool }) {
      if (values.priority !== "Important") return;
      const roles = values.audience === "Students" ? ["student"] : values.audience === "Staff" ? ["warden", "administrator", "maintenance", "security", "management"] : ALL_ROLES;
      await notifyRoles(roles, { title: `Notice: ${values.title}`.slice(0, 150), message: String(values.body).slice(0, 150), type: "notice", page: "notices", related_id: row.notice_id });
    },
    actions: [
      { key: "archive", label: "Archive", roles: ["warden", "administrator"], from: ["Published"], set: { status: "Archived" } },
      { key: "publish", label: "Publish again", roles: ["warden", "administrator"], from: ["Archived"], set: { status: "Published" } }
    ]
  },

  /* ---------------------------------------------------------------- room keys */
  keys: {
    title: "Room keys", icon: "keys", table: "key_records", pk: "key_id", order: "key_id DESC",
    listRoles: ["warden", "administrator", "security"], createRoles: ["warden", "administrator", "security"], statusField: "status",
    summary: "Who holds which room key.",
    columns: [
      { name: "key_id", label: "ID", hidden: true }, { name: "room_id", label: "Room", type: "computed" },
      { name: "key_number", label: "Key" }, { name: "student_number", label: "Held by" },
      { name: "status", label: "Status", type: "badge" }, { name: "issued_at", label: "Issued", type: "time" },
      { name: "returned_at", label: "Returned", type: "time" }, { name: "note", label: "Note" }
    ],
    selectExtra: ["room_block", "room_floor", "room_number"],
    present(row) { return { ...row, room_id: roomId(row.room_block, row.room_floor, row.room_number) }; },
    fields: [
      { name: "room", label: "Room", type: "room", required: true, prefix: "room_" },
      { name: "key_number", label: "Key number", type: "text", required: true, max: 30 },
      { name: "student_number", label: "Issued to (student)", type: "student" },
      { name: "note", label: "Note", type: "text", max: 200 }
    ],
    async beforeCreate({ client, user, values }) {
      const dup = await client.query(
        "SELECT 1 FROM key_records WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND key_number = $4 AND status = 'Issued'",
        [values.room_block, values.room_floor, values.room_number, values.key_number]);
      if (dup.rows.length) throw new HttpError(409, "That key is already issued. Return it first.");
      values.status = "Issued"; values.issued_by = user.id; values.issued_at = { sql: "CURRENT_TIMESTAMP" };
    },
    actions: [
      { key: "return", label: "Returned", roles: ["warden", "administrator", "security"], from: ["Issued"], set: { status: "Returned" }, stamps: ["returned_at"], tone: "good" },
      { key: "lost", label: "Report lost", roles: ["warden", "administrator", "security"], from: ["Issued"], set: { status: "Lost" }, tone: "bad", confirm: "Report this key as lost?",
        after: async ({ row }) => { await notifyRoles(["administrator"], { title: "Room key lost", message: `Key ${row.key_number} for room ${roomId(row.room_block, row.room_floor, row.room_number)} was reported lost.`, type: "key", page: "keys", related_id: row.key_id }); } }
    ]
  },

  /* ---------------------------------------------------------------- incidents */
  incidents: {
    title: "Incidents & emergencies", icon: "incidents", table: "incidents", pk: "incident_id", order: "incident_id DESC",
    listRoles: ["warden", "administrator", "security"], createRoles: ["warden", "administrator", "security"], statusField: "status",
    summary: "Report fires, medical emergencies, theft and other incidents. High and critical reports alert the administrator at once.",
    columns: [
      { name: "incident_id", label: "ID", hidden: true }, { name: "reported_at", label: "Reported", type: "time" },
      { name: "incident_type", label: "Type" }, { name: "severity", label: "Severity", type: "badge" },
      { name: "location", label: "Location" }, { name: "student_number", label: "Student" },
      { name: "description", label: "What happened" }, { name: "status", label: "Status", type: "badge" },
      { name: "action_taken", label: "Action taken" }, { name: "resolved_at", label: "Resolved", type: "time" }
    ],
    fields: [
      { name: "incident_type", label: "Type", type: "select", required: true, options: ["Fire", "Medical emergency", "Theft", "Fight", "Flood / leak", "Safety hazard", "Other"] },
      { name: "severity", label: "Severity", type: "select", required: true, options: ["Low", "Medium", "High", "Critical"] },
      { name: "location", label: "Location", type: "text", max: 150 },
      { name: "room", label: "Room (if any)", type: "room", prefix: "room_" },
      { name: "student_number", label: "Student involved", type: "student" },
      { name: "description", label: "What happened", type: "textarea", required: true, max: 2000 }
    ],
    selectExtra: ["room_block", "room_floor", "room_number"],
    beforeCreate({ user, values }) {
      values.status = "Open"; values.reported_by = user.id; values.reported_by_name = user.name; values.reported_at = { sql: "CURRENT_TIMESTAMP" };
    },
    async afterCreate({ values, row }) {
      if (["High", "Critical"].includes(values.severity)) {
        await notifyRoles(["administrator", "warden"], { title: `${String(values.severity).toUpperCase()} incident: ${values.incident_type}`, message: `${values.location || "Hostel"} - ${String(values.description).slice(0, 120)}`, type: "incident", page: "incidents", related_id: row.incident_id });
      }
    },
    actions: [
      { key: "investigate", label: "Investigating", roles: ["warden", "administrator"], from: ["Open"], set: { status: "Investigating" },
        inputs: [{ name: "action_taken", label: "Action so far", type: "text", max: 500 }] },
      { key: "resolve", label: "Resolve", roles: ["warden", "administrator"], from: ["Open", "Investigating"], set: { status: "Resolved" }, stamps: ["resolved_at"], tone: "good",
        inputs: [{ name: "action_taken", label: "Action taken", type: "textarea", required: true, max: 1000 }] }
    ]
  },

  /* ---------------------------------------------------------------- lost and found */
  lostfound: {
    title: "Lost & found", icon: "lostfound", table: "lost_found", pk: "item_id", order: "item_id DESC",
    ownerField: "student_number", listRoles: ["student", "warden", "administrator", "security"],
    createRoles: ["student", "warden", "administrator", "security"], statusField: "status",
    summary: "Lost and found items. Built on request, kept simple.",
    columns: [
      { name: "item_id", label: "ID", hidden: true }, { name: "date_reported", label: "Date", type: "date" },
      { name: "kind", label: "Lost / Found", type: "badge" }, { name: "item_name", label: "Item" },
      { name: "description", label: "Description" }, { name: "location", label: "Where" },
      { name: "student_number", label: "Student" }, { name: "status", label: "Status", type: "badge" }, { name: "resolution_note", label: "Outcome" }
    ],
    fields: [
      { name: "kind", label: "Lost or found?", type: "select", required: true, options: ["Lost", "Found"] },
      { name: "item_name", label: "Item", type: "text", required: true, max: 100 },
      { name: "description", label: "Description", type: "textarea", max: 500 },
      { name: "location", label: "Where", type: "text", max: 150 },
      { name: "student_number", label: "Student (owner / finder)", type: "student" },
      { name: "date_reported", label: "Date", type: "date", required: true, default: "today" }
    ],
    beforeCreate({ user, values }) { values.status = "Open"; values.recorded_by = user.id; },
    actions: [
      { key: "claim", label: "Claimed / returned", roles: ["warden", "administrator", "security"], from: ["Open"], set: { status: "Claimed" }, tone: "good",
        inputs: [{ name: "resolution_note", label: "Who collected it?", type: "text", max: 200 }] },
      { key: "close", label: "Close", roles: ["warden", "administrator", "security"], from: ["Open"], set: { status: "Closed" } }
    ]
  },

  /* ---------------------------------------------------------------- utilities */
  utilities: {
    title: "Electricity & water", icon: "utilities", table: "utility_readings", pk: "reading_id", order: "reading_date DESC, reading_id DESC",
    listRoles: ["administrator", "management"], createRoles: ["administrator"],
    summary: "Meter readings per hostel block. Consumption is worked out from the previous reading.",
    columns: [
      { name: "reading_id", label: "ID", hidden: true }, { name: "reading_date", label: "Date", type: "date" },
      { name: "block", label: "Hostel" }, { name: "utility", label: "Utility" },
      { name: "reading_value", label: "Reading", type: "number" }, { name: "consumption", label: "Used", type: "number" },
      { name: "unit", label: "Unit" }, { name: "cost", label: "Cost (RM)", type: "number" }, { name: "note", label: "Note" }
    ],
    fields: [
      { name: "block", label: "Hostel", type: "block", required: true },
      { name: "utility", label: "Utility", type: "select", required: true, options: ["Electricity", "Water"] },
      { name: "reading_date", label: "Reading date", type: "date", required: true, default: "today" },
      { name: "reading_value", label: "Meter reading", type: "number", required: true },
      { name: "cost", label: "Bill amount (RM)", type: "number" },
      { name: "note", label: "Note", type: "text", max: 200 }
    ],
    async beforeCreate({ client, user, values }) {
      const previous = (await client.query(
        "SELECT reading_value FROM utility_readings WHERE block = $1 AND utility = $2 AND reading_date <= $3 ORDER BY reading_date DESC, reading_id DESC LIMIT 1",
        [values.block, values.utility, values.reading_date])).rows[0];
      if (previous && Number(values.reading_value) < Number(previous.reading_value)) {
        throw bad(`The reading is lower than the previous reading (${previous.reading_value}).`);
      }
      values.unit = values.utility === "Water" ? "m3" : "kWh";
      values.consumption = previous ? Math.round((Number(values.reading_value) - Number(previous.reading_value)) * 100) / 100 : null;
      values.recorded_by = user.id;
    },
    actions: []
  }
};

module.exports = { modules, ALL_ROLES };
