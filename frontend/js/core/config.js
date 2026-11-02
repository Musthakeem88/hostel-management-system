/* =========================================================
   js/core/config.js  —  constants, shared state and the page registry
   All scripts share one global scope; pages register themselves in `pages`,
   click / submit / change handlers in `actions`, `forms` and `changes`.
========================================================= */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const view = $("#view");

const state = {
  user: null,        // signed-in user (id, name, role, pages, studentNumber...)
  meta: null,        // /api/meta: enums + module definitions for this role
  unread: 0,         // unread notifications
  d: {},             // data loaded for each page
  ui: {}             // each page's filters / tabs
};

const pages = {};    // key -> { load(), render(), ready() }
const actions = {};  // data-action="name"  -> (element, event)
const forms = {};    // data-form="name"    -> (form, event)
const changes = {};  // data-change="name"  -> (element, event)

const CONDITIONS = ["Good", "Damaged", "Broken"];
const DAMAGE_TYPES = ["Normal wear", "Accidental damage", "Confirmed vandalism"];
const PRIORITIES = ["Low", "Normal", "Urgent"];
const REPAIR_FLOW = ["Reported", "Assigned", "In Progress", "Completed"];
const MAINTENANCE_TYPES = ["Electrical", "Plumbing", "Furniture", "Cleaning"];
const MAINTENANCE_STATUS = ["Pending", "In Progress", "Completed"];
const PAYMENT_METHODS = ["Cash", "Bank transfer", "Card", "Online", "Deposit deduction"];
const DEFAULT_ITEMS = ["Bed", "Mattress", "Desk", "Chair", "Wardrobe", "Ceiling fan", "Tube light", "Window", "Sink", "Mirror"];

/* ---------- pages: where they sit in the menu ---------- */
const GROUPS = ["Overview", "Residents", "Inspections & damage", "Repairs & upkeep", "Money", "Community", "Management", "Account"];

const PAGE_META = {
  dashboard:    { title: "Dashboard", short: "Home", group: "Overview", icon: "dashboard" },
  myroom:       { title: "My room", short: "My room", group: "Residents", icon: "rooms" },
  applications: { title: "Room applications", short: "Apply", group: "Residents", icon: "applications" },
  rooms:        { title: "Rooms", short: "Rooms", group: "Residents", icon: "rooms" },
  students:     { title: "Students", short: "Students", group: "Residents", icon: "students" },
  items:        { title: "Items", short: "Items", group: "Residents", icon: "items" },
  inspections:  { title: "Inspections", short: "Inspect", group: "Inspections & damage", icon: "inspections" },
  damage:       { title: "Damage reports", short: "Damage", group: "Inspections & damage", icon: "damage" },
  fines:        { title: "Fines", short: "Fines", group: "Inspections & damage", icon: "fines" },
  repairs:      { title: "Repairs", short: "Repairs", group: "Repairs & upkeep", icon: "repairs" },
  maintenance:  { title: "Maintenance", short: "Maint.", group: "Repairs & upkeep", icon: "maintenance" },
  fees:         { title: "Fees & payments", short: "Fees", group: "Money", icon: "fees" },
  visitors:     { title: "Visitors", short: "Visitors", group: "Community", icon: "visitors" },
  leaves:       { title: "Leave & late return", short: "Leave", group: "Community", icon: "leaves" },
  transfers:    { title: "Room transfers", short: "Transfer", group: "Community", icon: "transfers" },
  complaints:   { title: "Complaints & feedback", short: "Feedback", group: "Community", icon: "complaints" },
  notices:      { title: "Notice board", short: "Notices", group: "Community", icon: "notices" },
  keys:         { title: "Room keys", short: "Keys", group: "Community", icon: "keys" },
  incidents:    { title: "Incidents", short: "Incidents", group: "Community", icon: "incidents" },
  lostfound:    { title: "Lost & found", short: "Lost", group: "Community", icon: "lostfound" },
  reports:      { title: "Reports", short: "Reports", group: "Management", icon: "reports" },
  users:        { title: "Users", short: "Users", group: "Management", icon: "users" },
  audit:        { title: "Activity log", short: "Log", group: "Management", icon: "audit" },
  settings:     { title: "Settings", short: "Settings", group: "Management", icon: "settings" },
  notifications:{ title: "Notifications", short: "Alerts", group: "Account", icon: "bell" },
  profile:      { title: "My profile", short: "Profile", group: "Account", icon: "profile" }
};

// the four tabs shown at the bottom of a phone (the rest are under "More")
/* the small grey sentence under each page title */
const PAGE_SUB = {
  dashboard: "Here is what is happening across the hostel today.",
  myroom: "Your room, bed and the items in it.",
  applications: "Room applications and the waiting list.",
  rooms: "Every room, its beds and who lives there.",
  students: "Student records, room allocation and check-out.",
  items: "University property, its condition and history.",
  inspections: "Check-in and check-out inspections with photos.",
  damage: "Damage reports and the review decisions.",
  fines: "Fines, appeals and payments.",
  repairs: "Repair requests and who is fixing them.",
  maintenance: "Maintenance jobs for rooms and buildings.",
  fees: "Invoices, payments, receipts and deposits.",
  visitors: "Visitor requests and approvals.",
  leaves: "Leave and late-return requests.",
  transfers: "Room transfer requests.",
  complaints: "Complaints and feedback from students.",
  notices: "Announcements for residents and staff.",
  keys: "Who holds which room key.",
  incidents: "Incident reports and follow-up.",
  lostfound: "Items lost and found in the hostel.",
  reports: "Reports to preview, print and download.",
  users: "Accounts, roles and passwords.",
  audit: "Who did what, and when.",
  settings: "Fees, rules and system status.",
  notifications: "Your latest alerts.",
  profile: "Your details, documents and password."
};

const PRIMARY = {
  student: ["dashboard", "myroom", "repairs", "fines"],
  warden: ["dashboard", "inspections", "damage", "repairs"],
  administrator: ["dashboard", "damage", "fines", "fees"],
  maintenance: ["dashboard", "repairs", "maintenance", "notifications"],
  security: ["dashboard", "visitors", "leaves", "incidents"],
  management: ["dashboard", "reports", "damage", "fees"]
};

// small line icons (24x24, stroke only)
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  rooms: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12" r="1"/>',
  students: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5c2 .7 3.5 2.6 3.5 5.5"/>',
  items: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  inspections: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  damage: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  fines: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2.1-.5-2.6-1.5"/><path d="M12 6.5V8m0 8v1.5"/>',
  repairs: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3l9.4-9.4z"/>',
  maintenance: '<path d="M13 5.5 18.5 11 16 13.5 10.5 8z"/><path d="M12 12.5 4.5 20"/>',
  fees: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>',
  applications: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  visitors: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6"/>',
  leaves: '<path d="M4 12h12"/><path d="m12 6 6 6-6 6"/><path d="M20 4v16"/>',
  transfers: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  complaints: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  notices: '<path d="M4 10v4h3l7 4V6l-7 4z"/><path d="M17 9.5a3.5 3.5 0 0 1 0 5"/>',
  keys: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  incidents: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  lostfound: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6"/><path d="M17 3.5l1.2 1 1.8-.3M20 7l-.5 1.7"/>',
  audit: '<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'
};

const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

const can = (page) => Boolean(state.user && state.user.pages.includes(page));
const isRole = (...roles) => Boolean(state.user && roles.includes(state.user.role));
