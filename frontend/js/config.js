/* =========================================================
   HOSTEL MANAGEMENT SYSTEM
   js/config.js  —  constants, DOM references and shared state
========================================================= */

const API_BASE = "/api";

const $ = (selector) => document.querySelector(selector);
const view = $("#view");
const titleElement = $("#title");
const nav = $("#nav");
const toastElement = $("#toast");

const ITEMS = [
  "Bed", "Mattress", "Desk", "Chair", "Wardrobe",
  "Ceiling fan", "Tube light", "Window", "Sink", "Mirror"
];

const CONDITIONS = ["Good", "Damaged", "Broken"];
const FINE_FLOW = ["Pending", "Under Review", "Approved", "Paid"];
const REPAIR_FLOW = ["Reported", "Assigned", "In Progress", "Completed"];
const MAINTENANCE_TYPES = ["Electrical", "Plumbing", "Furniture", "Cleaning"];
const MAINTENANCE_STATUS = ["Pending", "In Progress", "Completed"];

let rooms = [];
let students = [];
let damages = [];
let repairs = [];
let maintenance = [];
let inspections = [];
let selectedRoomFilter = "All";
let selectedMaintenanceFilter = "All";

// Each file in js/views/ adds a template function to this object.
const views = {};
