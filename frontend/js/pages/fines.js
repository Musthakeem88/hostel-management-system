/* js/pages/fines.js  —  fines: approval, due date, appeal, payment */

pages.fines = {
  async load() {
    state.d.fines = await api("/fines");
  },

  render() {
    const fines = state.d.fines;
    const staffView = !isRole("student");
    const f = ui("fines", { status: "All", q: "" });
    const statuses = ["All", "Approved", "Disputed", "Under Review", "Paid", "Waived"];
    const counts = { All: fines.length };
    statuses.slice(1).forEach((s) => { counts[s] = fines.filter((x) => x.status === s).length; });

    const list = fines.filter((x) => (f.status === "All" || x.status === f.status) && matches(x, f.q, ["fine_number", "student_number", "item_name", "room_id", "reason"]));
    const owed = fines.filter((x) => ["Approved", "Disputed", "Under Review"].includes(x.status)).reduce((s, x) => s + x.balance, 0);

    return `
      ${isRole("student") ? `<div class="notice ${owed > 0 ? "" : "good"}">${owed > 0 ? `You have <b>${money(owed)}</b> in fines to pay. You can appeal a fine you think is unfair.` : "You have no fines to pay."}</div>` : ""}
      <div class="toolbar">
        ${filterChips("fines.status", statuses, f.status, counts)}
        <input class="grow" type="search" placeholder="Search fine, student or item…" value="${esc(f.q)}" data-input="filter" data-filter="fines.q" aria-label="Search fines">
        ${can("reports") && isRole("administrator", "management") ? '<button class="btn ghost" data-action="export" data-report="fines_fees" data-format="xlsx">Export</button>' : ""}
      </div>

      <div class="card">
        ${tbl([
          { label: "Fine", render: (x) => `<button class="link mono" data-action="fine-open" data-id="${x.fine_id}">${esc(x.fine_number)}</button>` },
          ...(staffView ? [{ label: "Student", key: "student_number" }] : []),
          { label: "Room", key: "room_id" },
          { label: "Item", key: "item_name" },
          { label: "Reason", key: "reason", cls: "wrap" },
          { label: "Amount", render: (x) => money(x.amount), num: true },
          { label: "Balance", render: (x) => money(x.balance), num: true },
          { label: "Due", render: (x) => `<span class="nowrap">${fmtDate(x.due_date)}</span> ${x.overdue ? '<span class="badge bad">Overdue</span>' : ""}` },
          { label: "Status", render: (x) => badge(x.status) },
          { label: "", render: (x) => fineButtons(x) }
        ], list, { empty: isRole("student") ? "You have no fines." : "No fines yet." })}
      </div>`;
  }
};

function fineButtons(x) {
  const parts = [`<button class="btn ghost small" data-action="fine-open" data-id="${x.fine_id}">View</button>`];
  if (isRole("student") && x.status === "Approved") parts.push(`<button class="btn ghost small danger" data-action="fine-appeal" data-id="${x.fine_id}">Appeal</button>`);
  if (isRole("administrator")) {
    if (x.status === "Approved" && x.balance > 0) parts.push(`<button class="btn small" data-action="fine-pay" data-id="${x.fine_id}">Record payment</button>`);
    if (["Disputed", "Under Review"].includes(x.status)) parts.push(`<button class="btn small" data-action="fine-resolve" data-id="${x.fine_id}">Decide appeal</button>`);
  }
  return `<div class="row-actions">${parts.join("")}</div>`;
}

async function openFine(id) {
  try {
    const d = await api(`/fines/${id}`);
    const x = d.fine;
    const admin = isRole("administrator");

    openModal(`
      ${modalHead(`Fine ${x.fine_number}`)}
      ${dl([
        ["Status", `${badge(x.status)} ${x.overdue ? '<span class="badge bad">Overdue</span>' : ""}`], ["Student", esc(x.student_number)], ["Room", esc(x.room_id)], ["Item", esc(x.item_name)],
        ["Damage report", `<span class="mono">${esc(x.report_number)}</span>`], ["Type of damage", esc(x.damage_type || "—")],
        ["Amount", `<b>${money(x.amount)}</b>`], ["Paid", money(x.paid)], ["Balance", `<b>${money(x.balance)}</b>`], ["Due", fmtDate(x.due_date)],
        ["Why", `<span class="prewrap">${esc(x.reason)}</span>`], ["Approved by", `${esc(x.approved_by_name || "—")}${x.approved_at ? ` · ${fmtTime(x.approved_at)}` : ""}`],
        x.waived_reason ? ["Waived because", esc(x.waived_reason)] : null
      ])}

      ${section(`Proof photos (${d.evidence.length})`)}
      ${photoGallery(d.evidence, true)}

      ${d.appeals.length ? `${section("Appeals")}${d.appeals.map((a) => `<p>${badge(a.status)} <span class="muted">${fmtTime(a.created_at)}</span><br>${esc(a.reason)}${a.decision_note ? `<br><b>Decision:</b> ${esc(a.decision_note)} <span class="muted">(${esc(a.decided_by_name || "")})</span>` : ""}</p>`).join("")}` : ""}

      ${d.payments.length ? `${section("Payments")}${tbl([
        { label: "Receipt", key: "receipt_number" }, { label: "Method", key: "method" }, { label: "Date", render: (p) => fmtTime(p.paid_at) },
        { label: "Amount", render: (p) => money(p.amount), num: true },
        { label: "", render: (p) => `<button class="btn ghost small" data-action="receipt" data-id="${p.payment_id}">Receipt (PDF)</button>` }
      ], d.payments)}` : ""}

      <div class="modal-actions">
        ${isRole("student") && x.status === "Approved" ? `<button class="btn ghost danger" data-action="fine-appeal" data-id="${x.fine_id}">Appeal this fine</button>` : ""}
        ${admin && x.status === "Approved" && x.balance > 0 ? `<button class="btn" data-action="fine-pay" data-id="${x.fine_id}">Record payment</button>` : ""}
        ${admin && x.status === "Disputed" ? `<button class="btn ghost" data-action="fine-review" data-id="${x.fine_id}">Start review</button>` : ""}
        ${admin && ["Disputed", "Under Review"].includes(x.status) ? `<button class="btn" data-action="fine-resolve" data-id="${x.fine_id}">Decide appeal</button>` : ""}
        ${admin && ["Approved", "Disputed", "Under Review"].includes(x.status) ? `<button class="btn ghost danger" data-action="fine-waive" data-id="${x.fine_id}">Waive</button>` : ""}
        <button class="btn ghost" data-action="close-modal">Close</button>
      </div>`, { wide: true });
  } catch (error) { toast(error.message, "error"); }
}

actions["fine-open"] = (el) => openFine(el.dataset.id);
actions.receipt = (el) => openPdf(`/payments/${el.dataset.id}/receipt`);

actions["fine-appeal"] = async (el) => {
  const v = await formModal({
    title: "Appeal this fine",
    intro: "Explain why you think the fine is wrong or too high. The administrator will review it and tell you the decision.",
    fields: [{ name: "reason", label: "Your reason", type: "textarea", required: true, maxlength: 1000 }],
    submitText: "Send appeal"
  });
  if (!v) return;
  const ok = await attempt(() => api(`/fines/${el.dataset.id}/appeal`, { method: "POST", body: { reason: v.reason } }));
  if (ok) closeModal("modal");
};

actions["fine-pay"] = async (el) => {
  const fine = (await api(`/fines/${el.dataset.id}`)).fine;
  const v = await formModal({
    title: `Record payment · ${fine.fine_number}`,
    intro: `Balance to pay: <b>${money(fine.balance)}</b>.`,
    fields: [
      { name: "amount", label: "Amount received (RM)", type: "number", required: true, value: fine.balance },
      { name: "method", label: "Method", type: "select", required: true, options: PAYMENT_METHODS, value: "Cash", hint: "“Deposit deduction” takes the money from the student’s security deposit." },
      { name: "reference", label: "Reference (receipt / transfer number)", maxlength: 80 },
      { name: "note", label: "Note", maxlength: 200 }
    ],
    submitText: "Record payment"
  });
  if (!v) return;
  const result = await attempt(() => api("/payments", { method: "POST", body: { fine_id: fine.fine_id, amount: Number(v.amount), method: v.method, reference: v.reference, note: v.note } }));
  if (result) { closeModal("modal"); if (await confirmDialog("Open the receipt (PDF)?", { confirmText: "Open receipt", title: "Payment recorded" })) openPdf(`/payments/${result.payment.payment_id}/receipt`); }
};

actions["fine-review"] = async (el) => {
  const ok = await attempt(() => api(`/fines/${el.dataset.id}/review`, { method: "POST", body: {} }));
  if (ok) openFine(el.dataset.id);
};

actions["fine-resolve"] = async (el) => {
  const fine = (await api(`/fines/${el.dataset.id}`)).fine;
  const v = await formModal({
    title: `Decide the appeal · ${fine.fine_number}`,
    intro: `Current fine: <b>${money(fine.amount)}</b>.`,
    fields: [
      { name: "decision", label: "Decision", type: "select", required: true, options: [{ value: "Upheld", label: "Upheld — the fine stays" }, { value: "Reduced", label: "Reduced — lower the amount" }, { value: "Waived", label: "Waived — no fine" }], value: "Upheld" },
      { name: "new_amount", label: "New amount (RM) — only when reducing", type: "number", value: "" },
      { name: "note", label: "Explanation for the student", type: "textarea", required: true, maxlength: 500 }
    ],
    submitText: "Save decision"
  });
  if (!v) return;
  const body = { decision: v.decision, note: v.note };
  if (v.decision === "Reduced") body.new_amount = Number(v.new_amount);
  const ok = await attempt(() => api(`/fines/${fine.fine_id}/resolve-appeal`, { method: "POST", body }));
  if (ok) closeModal("modal");
};

actions["fine-waive"] = async (el) => {
  const v = await formModal({ title: "Waive this fine", intro: "The student will no longer have to pay it.", fields: [{ name: "reason", label: "Reason", type: "textarea", required: true, maxlength: 500 }], submitText: "Waive fine", danger: true });
  if (!v) return;
  const ok = await attempt(() => api(`/fines/${el.dataset.id}/waive`, { method: "POST", body: { reason: v.reason } }));
  if (ok) closeModal("modal");
};
