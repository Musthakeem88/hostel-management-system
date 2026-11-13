/* =========================================================
   js/core/modal.js  —  dialogs: details, small forms, confirmations
   "modal" is the main dialog; "modal2" opens on top of it (forms and confirmations).
========================================================= */

function dialogOf(id) { return document.getElementById(id); }

function openModal(html, { wide = false, id = "modal" } = {}) {
  const dialog = dialogOf(id);
  $(`#${id}-body`).innerHTML = html;
  dialog.classList.toggle("wide", wide);
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function closeModal(id = "modal") {
  const dialog = dialogOf(id);
  if (dialog && dialog.open) dialog.close();
}

const modalHead = (title, id = "modal") => `
  <div class="modal-head">
    <h3>${esc(title)}</h3>
    <button type="button" class="icon-btn" data-action="close-modal" data-id="${id}" aria-label="Close">&times;</button>
  </div>`;

/* ---------- fields for small forms ---------- */

function fieldHtml(f) {
  const id = `f-${f.name}`;
  const common = `name="${esc(f.name)}" id="${id}"${f.required ? " required" : ""}`;
  let control;

  switch (f.type) {
    case "textarea":
      control = `<textarea ${common}${f.maxlength ? ` maxlength="${f.maxlength}"` : ""} placeholder="${esc(f.placeholder || "")}">${esc(f.value ?? "")}</textarea>`;
      break;
    case "select":
      control = `<select ${common}>${f.blank ? `<option value="">${esc(f.blank)}</option>` : ""}${options(f.options || [], f.value ?? "")}</select>`;
      break;
    case "checkbox":
      return `<label class="check"><input type="checkbox" name="${esc(f.name)}" value="1"${f.value ? " checked" : ""}> ${esc(f.label)}</label>`;
    case "number":
      control = `<input type="number" ${common} value="${esc(f.value ?? "")}" min="${f.min ?? 0}" step="${f.step ?? "0.01"}"${f.max !== undefined ? ` max="${f.max}"` : ""} inputmode="decimal">`;
      break;
    case "date":
      control = `<input type="date" ${common} value="${esc(f.value ?? "")}"${f.min ? ` min="${f.min}"` : ""}${f.max ? ` max="${f.max}"` : ""}>`;
      break;
    case "password":
      control = `<input type="password" ${common} autocomplete="${f.autocomplete || "new-password"}" minlength="8">`;
      break;
    default:
      control = `<input type="text" ${common} value="${esc(f.value ?? "")}"${f.maxlength ? ` maxlength="${f.maxlength}"` : ""}${f.list ? ` list="${f.list}"` : ""} placeholder="${esc(f.placeholder || "")}" autocomplete="off">`;
  }

  return `<label for="${id}">${esc(f.label)}${f.required ? " *" : ""}${control}${f.hint ? `<small class="muted">${esc(f.hint)}</small>` : ""}</label>`;
}

/* Opens a small form on top of everything. Resolves with the values, or null when cancelled. */
function formModal({ title, intro, fields = [], submitText = "Save", danger = false, extra = "" }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };

    const dialog = openModal(`
      ${modalHead(title, "modal2")}
      ${intro ? `<p class="muted modal-sub">${intro}</p>` : ""}
      <form id="modal2-form" novalidate>
        <div class="stack">${fields.map(fieldHtml).join("")}${extra}</div>
        <p class="form-error" id="modal2-error" role="alert" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-action="close-modal" data-id="modal2">Cancel</button>
          <button type="submit" class="btn${danger ? " danger" : ""}">${esc(submitText)}</button>
        </div>
      </form>`, { id: "modal2" });

    const form = $("#modal2-form");
    const first = form.querySelector("input, textarea, select");
    if (first) setTimeout(() => first.focus(), 30);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = {};
      new FormData(form).forEach((v, k) => { values[k] = typeof v === "string" ? v.trim() : v; });
      fields.filter((f) => f.type === "checkbox").forEach((f) => { values[f.name] = form.elements[f.name].checked; });
      finish(values);
      closeModal("modal2");
    });

    // A dialog's "close" event arrives a moment after it closes. If another dialog already opened in the
    // same place by then, that late event is not ours — ignore it.
    const onClose = () => {
      if (dialog.open) return;
      dialog.removeEventListener("close", onClose);
      finish(null);
    };
    dialog.addEventListener("close", onClose);
  });
}

function confirmDialog(message, { title = "Please confirm", confirmText = "Yes, continue", danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };

    const dialog = openModal(`
      ${modalHead(title, "modal2")}
      <p class="prewrap">${esc(message)}</p>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal" data-id="modal2">Cancel</button>
        <button type="button" class="btn${danger ? " danger" : ""}" id="confirm-yes">${esc(confirmText)}</button>
      </div>`, { id: "modal2" });

    $("#confirm-yes").addEventListener("click", () => { finish(true); closeModal("modal2"); });
    $("#confirm-yes").focus();
    const onClose = () => {
      if (dialog.open) return;
      dialog.removeEventListener("close", onClose);
      finish(false);
    };
    dialog.addEventListener("close", onClose);
  });
}

/* backdrop click closes a dialog */
document.addEventListener("click", (event) => {
  if (event.target instanceof HTMLDialogElement && event.target.open) event.target.close();
});

actions["close-modal"] = (el) => closeModal(el.dataset.id || "modal");
actions["close-lightbox"] = () => closeModal("lightbox");
