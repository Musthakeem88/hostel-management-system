/* =========================================================
   js/core/photos.js  —  taking / choosing photos
   - photos are shrunk on the phone before upload (saves data, works on weak Wi-Fi)
   - a failed upload is retried automatically
   - proof photos are shown as thumbnails that open full-size
========================================================= */

const photoState = {};   // pickerId -> [{ key, id, url, status, name }]
let photoKey = 0;

function photoPicker(pid, { max = 6, label = "Add photo", compact = false, hint = "" } = {}) {
  photoState[pid] = photoState[pid] || [];
  return `
    <div class="photo-picker" data-picker="${esc(pid)}" data-max="${max}">
      <div class="photo-grid">
        ${renderThumbs(pid)}
        <label class="photo-add${compact ? " compact" : ""}">
          <input type="file" accept="image/*" multiple data-photo-input="${esc(pid)}" data-change="photo-input">
          ${icon("camera")}<span>${esc(label)}</span>
        </label>
      </div>
      ${hint ? `<small class="muted">${esc(hint)}</small>` : ""}
    </div>`;
}

function renderThumbs(pid) {
  return (photoState[pid] || []).map((p) => `
    <span class="photo-thumb${p.status === "uploading" ? " up" : ""}${p.status === "error" ? " err" : ""}" title="${esc(p.name || "")}">
      ${p.url ? `<img src="${esc(p.url)}" alt="Photo" data-action="open-photo" data-url="${esc(p.url)}">` : ""}
      ${p.status !== "done" ? `<span class="st">${p.status === "uploading" ? "uploading…" : "failed"}</span>` : ""}
      <button type="button" class="x" data-action="remove-photo" data-picker="${esc(pid)}" data-key="${p.key}" aria-label="Remove photo">&times;</button>
    </span>`).join("");
}

function refreshPicker(pid) {
  const picker = document.querySelector(`[data-picker="${CSS.escape(pid)}"]`);
  if (!picker) return;
  const grid = picker.querySelector(".photo-grid");
  const add = grid.querySelector(".photo-add");
  grid.querySelectorAll(".photo-thumb").forEach((n) => n.remove());
  add.insertAdjacentHTML("beforebegin", renderThumbs(pid));
  add.style.display = (photoState[pid] || []).length >= Number(picker.dataset.max) ? "none" : "";

  // the count on the checklist's small buttons
  const counter = document.querySelector(`[data-photo-count="${CSS.escape(pid)}"]`);
  if (counter) counter.textContent = (photoState[pid] || []).filter((p) => p.status === "done").length || "";
}

const photoIds = (pid) => (photoState[pid] || []).filter((p) => p.status === "done").map((p) => p.id);
const photosBusy = (pid) => (pid ? (photoState[pid] || []) : Object.values(photoState).flat()).some((p) => p.status === "uploading");
const resetPhotos = (pid) => { photoState[pid] = []; refreshPicker(pid); };
const photoGallery = (photos, big = false) =>
  photos && photos.length
    ? `<div class="photo-grid">${photos.map((p) => `<span class="photo-thumb${big ? " big" : ""}"><img src="${esc(p.url)}" alt="${esc(p.caption || "Photo")}" data-action="open-photo" data-url="${esc(p.url)}"></span>`).join("")}</div>`
    : `<p class="muted">No photos.</p>`;

/* shrink to at most 1600px and re-save as JPEG */
function compressImage(file, maxSize = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo could not be read. Please use a JPG or PNG photo.")); };
    img.src = url;
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* upload with automatic retries (weak Wi-Fi): waits 1 s, then 3 s, then 6 s */
async function uploadWithRetry(dataUrl, name, purpose = "photo", onRetry = () => {}) {
  const delays = [0, 1000, 3000, 6000];
  let lastError;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) { onRetry(attempt); await wait(delays[attempt]); }
    try {
      return await api("/files", { method: "POST", body: { data: dataUrl, name, purpose } });
    } catch (error) {
      lastError = error;
      // a clear refusal from the server (not a network / server problem) will not get better by retrying
      if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) break;
    }
  }
  throw lastError;
}

async function addPhotos(pid, files) {
  const picker = document.querySelector(`[data-picker="${CSS.escape(pid)}"]`);
  const max = picker ? Number(picker.dataset.max) : 6;
  photoState[pid] = photoState[pid] || [];

  for (const file of files) {
    if (photoState[pid].length >= max) { toast(`You can add at most ${max} photos here.`, "error"); break; }

    const entry = { key: ++photoKey, id: null, url: null, status: "uploading", name: file.name };
    photoState[pid].push(entry);
    refreshPicker(pid);

    try {
      const dataUrl = await compressImage(file);
      entry.url = dataUrl;                    // show the thumbnail right away
      refreshPicker(pid);
      const saved = await uploadWithRetry(dataUrl, file.name || "photo.jpg", "photo", () => { entry.status = "uploading"; });
      entry.id = saved.id;
      entry.url = saved.url;
      entry.status = "done";
    } catch (error) {
      entry.status = "error";
      toast(`Photo not uploaded: ${error.message}`, "error");
    }
    refreshPicker(pid);
  }
}

changes["photo-input"] = (input) => {
  const files = Array.from(input.files || []);
  input.value = "";
  if (files.length) addPhotos(input.dataset.photoInput, files);
};

actions["remove-photo"] = (el) => {
  const pid = el.dataset.picker;
  photoState[pid] = (photoState[pid] || []).filter((p) => String(p.key) !== el.dataset.key);
  refreshPicker(pid);
};

actions["open-photo"] = (el) => {
  $("#lightbox-img").src = el.dataset.url;
  const box = dialogOf("lightbox");
  if (!box.open) box.showModal();
};
