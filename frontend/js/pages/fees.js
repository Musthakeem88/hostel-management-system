/* js/pages/fees.js  —  invoices, payments, receipts and the security deposit */

pages.fees = {
  async load() {
    const d = { fees: await api("/fees"), payments: await api("/payments"), deposits: [], deposit: null, hostels: [] };
    if (isRole("administrator", "management")) d.deposits = await api("/deposits");
    if (isRole("student") && state.user.studentNumber) d.deposit = await api(`/deposits/${encodeURIComponent(state.user.studentNumber)}`);
    if (isRole("administrator")) d.hostels = await api("/hostels");
    state.d.fees = d;
  },

  render() {
    const { fees, payments, deposits, deposit } = state.d.fees;
    const staffView = !isRole("student");
    const admin = isRole("administrator");
    const tabs = ["Invoices", "Payments", ...(deposits.length || admin || isRole("management") ? ["Deposits"] : [])];
    const f = ui("fees", { tab: "Invoices", status: "All" });
    if (!tabs.includes(f.tab)) f.tab = "Invoices";

    const owed = fees.filter((x) => !["Paid", "Cancelled"].includes(x.status)).reduce((s, x) => s + x.balance, 0);
    const statuses = ["All", "Unpaid", "Partially paid", "Paid", "Cancelled"];
    const list = fees.filter((x) => f.status === "All" || x.status === f.status);

    return `
      ${isRole("student") && deposit ? `
        <div class="stats">
          ${statCard("To pay", money(owed), { warn: owed > 0 })}
          ${statCard("Deposit paid", money(deposit.deposit_paid))}
          ${statCard("Taken for fines", money(deposit.deducted))}
          ${statCard("Deposit balance", money(deposit.balance), { hint: "Refunded after check-out, less any fines" })}
        </div>` : ""}

      <div class="toolbar">
        <div class="tabs">${tabs.map((t) => `<button type="button" data-action="tab" data-filter="fees.tab" data-value="${t}" class="${f.tab === t ? "active" : ""}">${t}</button>`).join("")}</div>
        <span class="grow"></span>
        ${admin ? '<button class="btn" data-action="fee-issue">Issue fee</button>' : ""}
        ${isRole("administrator", "management") ? '<button class="btn ghost" data-action="export" data-report="fines_fees" data-format="xlsx">Export</button>' : ""}
      </div>

      ${f.tab === "Invoices" ? `
        ${filterChips("fees.status", statuses, f.status)}
        <div class="card">${tbl([
          { label: "Invoice", render: (x) => `<span class="mono">${esc(x.invoice_number)}</span>` },
          ...(staffView ? [{ label: "Student", render: (x) => `${esc(x.student_name || "")}<br><span class="muted">${esc(x.student_number)}</span>` }] : []),
          { label: "Type", key: "fee_type" },
          { label: "Description", render: (x) => esc(x.description || "—"), cls: "wrap" },
          { label: "Amount", render: (x) => money(x.amount), num: true },
          { label: "Paid", render: (x) => money(x.paid), num: true },
          { label: "Balance", render: (x) => money(x.balance), num: true },
          { label: "Due", render: (x) => `<span class="nowrap">${fmtDate(x.due_date)}</span> ${x.overdue ? '<span class="badge bad">Overdue</span>' : ""}` },
          { label: "Status", render: (x) => badge(x.status) },
          { label: "", render: (x) => `<div class="row-actions"><button class="btn ghost small" data-action="invoice" data-id="${x.fee_id}">Invoice (PDF)</button>
              ${admin && !["Paid", "Cancelled"].includes(x.status) ? `<button class="btn small" data-action="fee-pay" data-id="${x.fee_id}">Record payment</button>` : ""}
              ${admin && x.paid === 0 && x.status !== "Cancelled" ? `<button class="btn ghost small danger" data-action="fee-cancel" data-id="${x.fee_id}">Cancel</button>` : ""}</div>` }
        ], list, { empty: "No invoices." })}</div>` : ""}

      ${f.tab === "Payments" ? `
        <div class="card">${tbl([
          { label: "Receipt", render: (p) => `<span class="mono">${esc(p.receipt_number)}</span>` },
          ...(staffView ? [{ label: "Student", key: "student_number" }] : []),
          { label: "For", render: (p) => esc(p.kind === "Refund" ? "Deposit refund" : p.fine_number ? `Fine ${p.fine_number}` : `${p.fee_type || "Fee"} ${p.invoice_number || ""}`) },
          { label: "Method", key: "method" },
          { label: "Date", render: (p) => fmtTime(p.paid_at) },
          { label: "Amount", render: (p) => `<span class="${p.kind === "Refund" ? "refund" : ""}">${p.kind === "Refund" ? "−" : ""}${money(p.amount)}</span>`, num: true },
          { label: "", render: (p) => `<button class="btn ghost small" data-action="receipt" data-id="${p.payment_id}">Receipt (PDF)</button>` }
        ], payments, { empty: "No payments yet." })}</div>` : ""}

      ${f.tab === "Deposits" ? `
        <div class="card">
          <p class="muted">Security deposits are refunded after check-out. Approved fines that are still unpaid are taken from the deposit first.</p>
          ${tbl([
            { label: "Student", render: (d) => `${esc(d.full_name)}<br><span class="muted">${esc(d.student_number)}</span>` },
            { label: "Status", render: (d) => badge(d.student_status || "Active") },
            { label: "Deposit paid", render: (d) => money(d.deposit_paid), num: true },
            { label: "Taken for fines", render: (d) => money(d.deducted), num: true },
            { label: "Refunded", render: (d) => money(d.refunded), num: true },
            { label: "Balance", render: (d) => `<b>${money(d.balance)}</b>`, num: true },
            { label: "Unpaid fines", render: (d) => money(d.unpaid_fines), num: true },
            { label: "", render: (d) => (admin && d.student_status && d.student_status !== "Active" && (d.balance > 0) ? `<button class="btn small" data-action="deposit-settle" data-id="${esc(d.student_number)}">Settle & refund</button>` : "") }
          ], deposits, { empty: "No deposits yet." })}
        </div>` : ""}`;
  }
};

actions.tab = (el) => { ui(el.dataset.filter.split(".")[0])[el.dataset.filter.split(".")[1]] = el.dataset.value; rerender(); };
actions.invoice = (el) => openPdf(`/fees/${el.dataset.id}/invoice`);

actions["fee-issue"] = async () => {
  const { hostels } = state.d.fees;
  const v = await formModal({
    title: "Issue a fee",
    fields: [
      { name: "scope", label: "Charge", type: "select", required: true, options: [{ value: "student", label: "One student" }, { value: "block", label: "Everyone in a hostel" }, { value: "all", label: "Every resident" }], value: "student" },
      { name: "student_number", label: "Student number (when charging one student)", maxlength: 30 },
      { name: "block", label: "Hostel (when charging a hostel)", type: "select", options: hostels.map((h) => ({ value: h.block, label: h.name })), blank: "—" },
      { name: "fee_type", label: "Type", type: "select", required: true, options: ["Hostel fee", "Security deposit", "Other"], value: "Hostel fee" },
      { name: "description", label: "Description", maxlength: 200, placeholder: "e.g. Semester 2 hostel fee" },
      { name: "amount", label: "Amount each (RM)", type: "number", required: true },
      { name: "due_date", label: "Due date", type: "date", required: true, value: addDaysISO(todayISO(), 14) }
    ],
    submitText: "Issue"
  });
  if (v) attempt(() => api("/fees", { method: "POST", body: { ...v, amount: Number(v.amount) } }));
};

actions["fee-pay"] = async (el) => {
  const fee = state.d.fees.fees.find((x) => String(x.fee_id) === el.dataset.id);
  const v = await formModal({
    title: `Record payment · ${fee.invoice_number}`,
    intro: `${esc(fee.fee_type)} for ${esc(fee.student_number)} — balance <b>${money(fee.balance)}</b>.`,
    fields: [
      { name: "amount", label: "Amount received (RM)", type: "number", required: true, value: fee.balance },
      { name: "method", label: "Method", type: "select", required: true, options: PAYMENT_METHODS.filter((m) => m !== "Deposit deduction"), value: "Cash" },
      { name: "reference", label: "Reference", maxlength: 80 },
      { name: "note", label: "Note", maxlength: 200 }
    ],
    submitText: "Record payment"
  });
  if (!v) return;
  const result = await attempt(() => api("/payments", { method: "POST", body: { fee_id: fee.fee_id, amount: Number(v.amount), method: v.method, reference: v.reference, note: v.note } }));
  if (result && await confirmDialog("Open the receipt (PDF)?", { confirmText: "Open receipt", title: "Payment recorded" })) openPdf(`/payments/${result.payment.payment_id}/receipt`);
};

actions["fee-cancel"] = async (el) => {
  if (await confirmDialog("Cancel this fee? It will no longer be owed.", { confirmText: "Cancel fee", danger: true })) attempt(() => api(`/fees/${el.dataset.id}/cancel`, { method: "POST", body: {} }));
};

actions["deposit-settle"] = async (el) => {
  const number = el.dataset.id;
  const d = await api(`/deposits/${encodeURIComponent(number)}`);
  const v = await formModal({
    title: `Settle the deposit · ${number}`,
    intro: `Deposit balance <b>${money(d.balance)}</b>, unpaid fines <b>${money(d.unpaid_fines)}</b>. The fines are taken first; the rest (<b>${money(d.refundable)}</b>) is refunded.`,
    fields: [{ name: "refund_method", label: "Refund method", type: "select", options: ["Bank transfer", "Cash", "Online"], value: "Bank transfer" }],
    submitText: "Settle and refund"
  });
  if (v) attempt(() => api(`/deposits/${encodeURIComponent(number)}/settle`, { method: "POST", body: v }));
};
