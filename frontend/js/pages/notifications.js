/* js/pages/notifications.js  —  in-system notifications */

pages.notifications = {
  async load() {
    state.d.notifications = await api("/notifications?limit=100");
  },

  render() {
    const list = state.d.notifications;
    const unread = list.filter((n) => !n.read_at).length;

    return `
      <div class="toolbar">
        <span class="muted">${unread ? `${unread} unread` : "You are all caught up."}</span>
        <span class="grow"></span>
        ${unread ? '<button class="btn ghost small" data-action="notif-read-all">Mark all as read</button>' : ""}
      </div>
      ${list.length ? `<div class="notif-list">${list.map((n) => `
        <button type="button" class="notif${n.read_at ? "" : " unread"}" data-action="notif-open" data-id="${n.notification_id}">
          <span class="dot"></span>
          <span><b>${esc(n.title)}</b>${n.message ? `<span class="muted">${esc(n.message)}</span>` : ""}</span>
          <small>${esc(ago(n.created_at))}</small>
        </button>`).join("")}</div>` : `<div class="card"><div class="empty-card"><b>No notifications yet</b>Updates about repairs, inspections, damage, fines and approvals will appear here.</div></div>`}`;
  }
};

const NOTIFICATION_OPENERS = { damage: "openDamage", fine: "openFine", repair: "openRepair", inspection: "viewInspection" };

actions["notif-open"] = async (el) => {
  const n = state.d.notifications.find((x) => String(x.notification_id) === el.dataset.id);
  if (!n) return;

  if (!n.read_at) {
    n.read_at = new Date().toISOString();
    api(`/notifications/${n.notification_id}/read`, { method: "POST", body: {} }).then(pollUnread).catch(() => {});
    rerender();
  }

  const opener = NOTIFICATION_OPENERS[n.type];
  if (opener && n.related_id && typeof window[opener] === "function") { window[opener](n.related_id); return; }
  if (n.page && can(n.page)) go(n.page);
};

actions["notif-read-all"] = async () => {
  await attempt(() => api("/notifications/read-all", { method: "POST", body: {} }), { success: "All notifications marked as read." });
  pollUnread();
};
