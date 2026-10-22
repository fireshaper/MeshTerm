// MeshTerm theme boot (CR-004 §4.4). Loaded blocking from index.html, before the first
// paint, so a saved theme shows without a flash of Default. Keep it tiny, old-browser
// safe and dependency-free; the app's ThemeProvider takes over once it loads.
(function () {
  var root = document.documentElement;
  var link = document.getElementById("mt-theme");
  var valid = /^[a-z0-9-]{1,40}$/;
  var dark = function () {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  };
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("meshterm.theme") || "null");
  } catch {
    saved = null;
  }
  var forced = null;
  try {
    forced = new URLSearchParams(location.search).get("theme");
  } catch {
    forced = null;
  }
  var pref = saved && /^(system|light|dark)$/.test(saved.mode) ? saved.mode : "system";
  var scheme = "auto";
  if (forced && valid.test(forced)) {
    // `?theme=<id>`: this page load only (recovery and screenshots), never saved.
    if (link) link.href = "/themes/" + forced + "/theme.css";
    root.setAttribute("data-mt-theme", forced);
    root.setAttribute("data-mt-theme-forced", "");
    scheme = saved && forced === saved.id ? saved.scheme : "auto";
  } else if (saved && valid.test(saved.id) && saved.id !== "default") {
    var entry = /^[\w./-]+\.css$/.test(saved.entry) ? saved.entry : "theme.css";
    if (link)
      link.href =
        "/themes/" + saved.id + "/" + entry + "?v=" + encodeURIComponent(saved.hash || "");
    root.setAttribute("data-mt-theme", saved.id);
    scheme = saved.scheme;
  } else {
    root.setAttribute("data-mt-theme", "default");
    scheme = saved && saved.id === "default" ? saved.scheme : "auto";
  }
  var mode =
    scheme === "light" || scheme === "dark"
      ? scheme
      : pref === "system"
        ? dark()
          ? "dark"
          : "light"
        : pref;
  root.setAttribute("data-mt-mode", mode);
  var meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute("content", mode);
  // Effects (CR-004 §7): the saved theme's, unless turned off here or under more contrast;
  // under reduced motion only the ones that don't move.
  var media = function (q) {
    return !!(window.matchMedia && window.matchMedia(q).matches);
  };
  var on = true;
  try {
    on = localStorage.getItem("meshterm.effects") !== "false";
  } catch {
    on = true;
  }
  if (
    !forced &&
    saved &&
    Array.isArray(saved.effects) &&
    on &&
    !media("(prefers-contrast: more)")
  ) {
    var reduced = media("(prefers-reduced-motion: reduce)");
    var fx = saved.effects.filter(function (e) {
      return /^[a-z]+$/.test(e) && !(reduced && e === "flicker");
    });
    if (fx.length > 0) root.setAttribute("data-mt-fx", fx.join(" "));
  }
})();
