/* =========================================================
   js/core/api.js  —  talking to the server (sign-in token, JSON, downloads)
========================================================= */

const TOKEN_KEY = "hostel-token";

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function setToken(token, remember) {
  try {
    sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch { /* storage blocked */ }
}

function clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}

let onSessionEnded = () => {};

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection and try again.", 0);
  }

  const isJson = (response.headers.get("content-type") || "").includes("json");
  const data = isJson ? await response.json() : {};

  if (response.status === 401 && token && !path.startsWith("/auth/login")) {
    onSessionEnded(data.error);
    throw new ApiError(data.error || "Please sign in again.", 401, data);
  }

  if (!response.ok) throw new ApiError(data.error || `Something went wrong (${response.status}).`, response.status, data);
  return data;
}

async function fetchBlob(path) {
  const token = getToken();
  const response = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    let message = "Could not download the file.";
    try { message = (await response.json()).error || message; } catch { /* not JSON */ }
    throw new ApiError(message, response.status);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const name = (/filename="?([^";]+)"?/.exec(disposition) || [])[1] || "download";
  return { blob: await response.blob(), name };
}

async function downloadFile(path, fallbackName) {
  try {
    const { blob, name } = await fetchBlob(path);
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name || fallbackName });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    toast(error.message, "error");
  }
}

// open a PDF (receipt, invoice) in a new tab; the tab is opened first so pop-up blockers allow it
async function openPdf(path) {
  const tab = window.open("about:blank", "_blank");
  try {
    const { blob } = await fetchBlob(path);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (error) {
    if (tab) tab.close();
    toast(error.message, "error");
  }
}

// run something that talks to the server, show success / error toasts
async function attempt(work, { success, refreshAfter = true } = {}) {
  try {
    const result = await work();
    const message = success === undefined ? (result && result.message) : (typeof success === "function" ? success(result) : success);
    if (message) toast(message);
    if (refreshAfter) await refresh();
    return result;
  } catch (error) {
    if (error.status !== 401) toast(error.message, "error");
    return null;
  }
}
