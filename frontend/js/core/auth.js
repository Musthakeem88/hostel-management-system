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
