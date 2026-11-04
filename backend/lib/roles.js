/* Roles and which pages / actions each role may use. The server is the authority:
   every API route is protected with requireRole(); the front end only hides what you cannot use. */

const ROLES = ["student", "warden", "administrator", "maintenance", "security", "management"];

const ROLE_LABELS = {
  student: "Student",
  warden: "Warden",
  administrator: "Administrator",
  maintenance: "Maintenance staff",
  security: "Security guard",
  management: "Management"
};

const PAGE_ACCESS = {
  student: ["dashboard", "myroom", "applications", "repairs", "fines", "fees", "complaints",
            "leaves", "transfers", "visitors", "notices", "notifications", "profile"],
  warden: ["dashboard", "rooms", "students", "items", "inspections", "damage", "fines", "repairs",
           "maintenance", "applications", "visitors", "leaves", "transfers", "complaints", "notices",
           "keys", "incidents", "lostfound", "reports", "notifications", "profile"],
  administrator: ["dashboard", "rooms", "students", "items", "inspections", "damage", "fines", "repairs",
                  "maintenance", "applications", "fees", "reports", "visitors", "leaves", "transfers",
                  "complaints", "notices", "keys", "incidents", "lostfound", "utilities", "users",
                  "audit", "settings", "notifications", "profile"],
  maintenance: ["dashboard", "repairs", "maintenance", "notifications", "profile"],
  security: ["dashboard", "visitors", "leaves", "incidents", "keys", "lostfound", "notices",
             "notifications", "profile"],
  management: ["dashboard", "rooms", "damage", "fines", "repairs", "maintenance", "fees", "reports",
               "utilities", "notices", "notifications", "profile"]
};

// Roles that may look at campus-wide data (everything except student scope)
const STAFF = ["warden", "administrator", "maintenance", "security", "management"];

module.exports = { ROLES, ROLE_LABELS, PAGE_ACCESS, STAFF };
