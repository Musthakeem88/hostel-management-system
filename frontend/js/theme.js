/* =========================================================
   js/theme.js  —  light / dark mode
   Loaded in <head> so the theme is applied before the page paints.
   Order of preference: saved choice -> system setting.
========================================================= */
(function () {
  var KEY = "hostel-theme";
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function save(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) { /* storage blocked */ }
  }

  function systemTheme() {
    return media && media.matches ? "dark" : "light";
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#1c2540" : "#7fa4cf");

    var button = document.getElementById("theme-toggle");
    if (button) {
      var next = theme === "dark" ? "light" : "dark";
      button.setAttribute("aria-label", "Switch to " + next + " mode");
      button.setAttribute("title", "Switch to " + next + " mode");
    }
  }

  apply(saved() || systemTheme());

  document.addEventListener("DOMContentLoaded", function () {
    apply(root.getAttribute("data-theme"));

    ["theme-toggle", "login-theme"].forEach(function (id) {
      var button = document.getElementById(id);
      if (!button) return;

      button.addEventListener("click", function () {
        var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
        save(next);
        apply(next);
      });
    });
  });

  // Follow the system setting until the user picks a theme themselves.
  if (media && media.addEventListener) {
    media.addEventListener("change", function () {
      if (!saved()) apply(systemTheme());
    });
  }
})();
