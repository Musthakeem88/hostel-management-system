const express = require("express");
const { modules } = require("../lib/modules");
const { ROLES, ROLE_LABELS } = require("../lib/roles");
const { DAMAGE_TYPES } = require("../lib/fines");

const router = express.Router();

// What a page needs to draw a module for this role (no code, just data)
function publicSpec(key, spec, role) {
  return {
    key,
    title: spec.title,
    summary: spec.summary,
    columns: spec.columns,
    fields: spec.fields,
    statusField: spec.statusField || null,
    scoped: Boolean(spec.ownerField) && role === "student",
    canCreate: (spec.createRoles || []).includes(role),
    canEdit: (spec.editRoles || []).includes(role),
    actions: (spec.actions || []).filter((a) => a.roles.includes(role)).map((a) => ({
      key: a.key, label: a.label, tone: a.tone || "", confirm: a.confirm || null, from: a.from, inputs: a.inputs || []
    }))
  };
}

router.get("/", (req, res) => {
  const role = req.user.role;
  const visible = {};

  Object.entries(modules).forEach(([key, spec]) => {
    if (spec.listRoles.includes(role)) visible[key] = publicSpec(key, spec, role);
  });

  res.json({
    roles: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
    modules: visible,
    enums: {
      conditions: ["Good", "Damaged", "Broken"],
      itemStatuses: ["In use", "Under repair", "Replaced", "Retired"],
      damageTypes: DAMAGE_TYPES,
      priorities: ["Low", "Normal", "Urgent"],
      feeTypes: ["Hostel fee", "Security deposit", "Other"],
      paymentMethods: ["Cash", "Bank transfer", "Card", "Online", "Deposit deduction"],
      roomTypes: ["Single", "Double", "Triple", "Quad", "Standard"],
      maintenanceTypes: ["Electrical", "Plumbing", "Furniture", "Cleaning"]
    }
  });
});

module.exports = router;
