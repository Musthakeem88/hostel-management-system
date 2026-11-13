/* js/pages/reports.js  —  the reports, with preview, PDF and Excel download */

pages.reports = {
  async load() {
    const d = { list: await api("/reports"), hostels: await api("/hostels"), archive: [] };
    if (isRole("administrator", "management")) d.archive = await api("/reports/archive");
    state.d.reports = d;
  },

  render() {
    const { list, hostels, archive } = state.d.reports;
    const previews = ui("reports", { previews: {} }).previews;
    const thisMonth = todayISO().slice(0, 7);

    return `
      <p class="muted">Choose a report, set the filters, then preview it or download it as PDF or Excel.</p>
      <div class="stack">
        ${list.map((r) => `
          <div class="card report-card" data-report-card="${r.key}">
            <div><h3>${esc(r.title)}</h3><span class="muted">${esc(r.description)}</span></div>
            <div class="toolbar">
              ${r.filters.includes("block") ? `<select data-rf="block" aria-label="Hostel"><option value="">All hostels</option>${options(hostels.map((h) => ({ value: h.block, label: h.name })))}</select>` : ""}
              ${r.filters.includes("condition") ? `<select data-rf="condition" aria-label="Condition"><option value="">Any condition</option>${options(CONDITIONS)}</select>` : ""}
              ${r.filters.includes("from") ? `<label class="inline">From <input type="date" data-rf="from"></label><label class="inline">To <input type="date" data-rf="to"></label>` : ""}
              ${r.filters.includes("month") ? `<label class="inline">Month <input type="month" data-rf="month" value="${thisMonth}"></label>` : ""}
              <span class="grow"></span>
              <button class="btn small" data-action="report-preview" data-key="${r.key}">Preview</button>
              <button class="btn ghost small" data-action="report-download" data-key="${r.key}" data-format="pdf">PDF</button>
              <button class="btn ghost small" data-action="report-download" data-key="${r.key}" data-format="xlsx">Excel</button>
            </div>
            <div class="report-out" id="report-out-${r.key}">${previews[r.key] ? previewHtml(previews[r.key]) : ""}</div>
          </div>`).join("")}
      </div>

      ${isRole("administrator", "management") ? `
      <div class="card">
        <h3>Monthly reports (made automatically)</h3>
        <p class="muted">A summary PDF is created on the first day of each month and management is notified.</p>
        ${tbl([
          { label: "Month", key: "period" }, { label: "Created", render: (a) => fmtTime(a.created_at) },
          { label: "", render: (a) => `<a class="btn ghost small" href="${esc(a.url)}" target="_blank" rel="noopener">Open PDF</a>` }
        ], archive, { empty: "No monthly report has been made yet." })}
      </div>` : ""}`;
  }
};

function reportQuery(key) {
  const card = document.querySelector(`[data-report-card="${key}"]`);
  const params = new URLSearchParams();
  $$("[data-rf]", card).forEach((el) => { if (el.value) params.set(el.dataset.rf === "month" ? "month" : el.dataset.rf, el.value); });
  return params;
}

function previewHtml(report) {
  const rows = report.rows.slice(0, 300);
  return `
    <p class="muted">${esc(report.subtitle || "")}</p>
    <div class="summary-chips">${(report.summary || []).map((s) => `<span>${esc(s.label)}<b>${esc(s.value)}</b></span>`).join("")}</div>
    ${tbl(report.columns.map((c) => ({ label: c.label, key: c.key, num: c.align === "right" })), rows, { empty: "No records for these filters." })}
    ${report.rows.length > 300 ? `<p class="muted">Showing the first 300 of ${report.rows.length} rows. Download the file to see everything.</p>` : ""}`;
}

actions["report-preview"] = async (el) => {
  const key = el.dataset.key;
  const out = $(`#report-out-${key}`);
  out.innerHTML = '<div class="skeleton"></div>';
  try {
    const report = await api(`/reports/${key}?${reportQuery(key)}`);
    ui("reports").previews[key] = report;
    out.innerHTML = previewHtml(report);
  } catch (error) { out.innerHTML = ""; toast(error.message, "error"); }
};

actions["report-download"] = (el) => {
  const params = reportQuery(el.dataset.key);
  params.set("format", el.dataset.format);
  downloadFile(`/reports/${el.dataset.key}?${params}`);
};
