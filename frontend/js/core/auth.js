/* =========================================================
   js/core/auth.js  —  sign in, create student account, sign out, passwords
========================================================= */

function showLogin(message) {
  $("#app").hidden = true;
  $("#login").hidden = false;
  if (message) { const box = $("#signin-error"); box.textContent = message; box.hidden = false; }
  setTimeout(() => { const f = $("#signin-form [name=username]"); if (f && !$("#login").hidden) f.focus(); }, 50);
}

function switchAuthTab(tab) {
  $$(".pw-toggle[aria-pressed='true']").forEach((b) => b.click());
  $$("[data-auth-tab]").forEach((b) => b.classList.toggle("active", b.dataset.authTab === tab));
  $("#signin-form").hidden = tab !== "signin";
  $("#signup-form").hidden = tab !== "signup";
}

onSessionEnded = (message) => {
  stopPolling();
  clearToken();
  state.user = null;
  closeModal("modal2"); closeModal("modal");
  showLogin(message || "Your session ended. Please sign in again.");
};

async function startSession(data, remember) {
  setToken(data.token, remember);
  await bootApp();
}

forms.signin = async (form) => {
  const box = $("#signin-error");
  box.hidden = true;
  const v = formData(form);

  await submitting(form, async () => {
    try {
      const data = await api("/auth/login", { method: "POST", body: { username: v.username, password: v.password } });
      form.reset();
      await startSession(data, Boolean(form.elements.remember.checked));
    } catch (error) {
      box.textContent = error.message;
      box.hidden = false;
    }
  });
};

forms.signup = async (form) => {
  const box = $("#signup-error");
  box.hidden = true;

  await submitting(form, async () => {
    try {
      const data = await api("/auth/register", { method: "POST", body: formData(form) });
      form.reset();
      await startSession(data, false);
    } catch (error) {
      box.textContent = error.message;
      box.hidden = false;
    }
  });
};

async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* signing out anyway */ }
  stopPolling();
  clearToken();
  state.user = null; state.meta = null; state.d = {}; state.ui = {};
  closeModal("modal2"); closeModal("modal");
  location.hash = "";
  showLogin();
}

/* ---------- show / hide password ---------- */

/* wraps a password input in a box with an eye button (used on sign in, sign up and every password pop-up) */
function addPasswordToggle(input) {
  if (!input || input.dataset.pw || input.type !== "password") return;
  input.dataset.pw = "1";

  const wrap = document.createElement("span");
  wrap.className = "pw";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pw-toggle";
  button.setAttribute("aria-label", "Show password");
  button.setAttribute("aria-pressed", "false");
  button.title = "Show password";
  button.innerHTML = `<svg class="ic-show" viewBox="0 0 24 24" aria-hidden="true">${ICONS.eye}</svg><svg class="ic-hide" viewBox="0 0 24 24" aria-hidden="true">${ICONS.eyeOff}</svg>`;
  wrap.appendChild(button);

  button.addEventListener("click", (event) => {
    event.preventDefault();
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    button.title = show ? "Hide password" : "Show password";
    input.focus({ preventScroll: true });
  });
}

const addPasswordToggles = (root = document) => root.querySelectorAll('input[type="password"]').forEach(addPasswordToggle);
addPasswordToggles();
// pop-ups (change password, new user...) are drawn later, so watch for new password fields
new MutationObserver(() => addPasswordToggles()).observe(document.body, { childList: true, subtree: true });

/* the password goes back to hidden whenever the form is cleared or the person switches tab */
document.addEventListener("reset", (event) => {
  event.target.querySelectorAll && event.target.querySelectorAll(".pw-toggle[aria-pressed='true']").forEach((b) => b.click());
}, true);

/* ---------- passwords ---------- */

const passwordFields = (current = true) => [
  ...(current ? [{ name: "current_password", label: "Current password", type: "password", required: true, autocomplete: "current-password" }] : []),
  { name: "new_password", label: "New password", type: "password", required: true, hint: "At least 8 characters, with letters and numbers." },
  { name: "confirm_password", label: "Type the new password again", type: "password", required: true }
];

async function changePasswordFlow({ forced = false } = {}) {
  for (;;) {
    const v = await formModal({
      title: forced ? "Choose a new password" : "Change password",
      intro: forced ? "You are using a temporary password. Choose your own to continue." : "",
      fields: passwordFields(),
      submitText: "Change password"
    });

    if (!v) { if (forced) continue; return false; }
    if (v.new_password !== v.confirm_password) { toast("The two new passwords are not the same.", "error"); continue; }

    try {
      await api("/auth/change-password", { method: "POST", body: { current_password: v.current_password, new_password: v.new_password } });
      toast("Password changed.");
      return true;
    } catch (error) {
      toast(error.message, "error");
      if (!forced) return false;
    }
  }
}

actions["change-password"] = async () => { closeModal("modal"); await changePasswordFlow(); };
actions["logout"] = () => logout();

actions["user-menu"] = () => {
  const u = state.user;
  openModal(`
    ${modalHead("Account")}
    ${dl([["Name", esc(u.name)], ["Role", esc(u.roleLabel)], ["Username", esc(u.username)], u.studentNumber ? ["Student number", esc(u.studentNumber)] : null])}
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-goto="profile">My profile</button>
      <button type="button" class="btn ghost" data-action="change-password">Change password</button>
      <button type="button" class="btn danger" data-action="logout">Sign out</button>
    </div>`);
};
