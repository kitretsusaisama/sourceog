(() => {
  const overlayId = "__sourceog-dev-overlay";
  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.style.position = "fixed";
    overlay.style.right = "16px";
    overlay.style.bottom = "16px";
    overlay.style.maxWidth = "420px";
    overlay.style.maxHeight = "50vh";
    overlay.style.overflow = "auto";
    overlay.style.padding = "12px 14px";
    overlay.style.borderRadius = "14px";
    overlay.style.background = "rgba(15,23,42,0.96)";
    overlay.style.color = "#e5eefb";
    overlay.style.fontFamily = "ui-monospace, SFMono-Regular, Consolas, monospace";
    overlay.style.fontSize = "12px";
    overlay.style.lineHeight = "1.5";
    overlay.style.boxShadow = "0 20px 40px rgba(0,0,0,0.35)";
    overlay.style.zIndex = "2147483647";
    overlay.style.display = "none";
    document.body.appendChild(overlay);
    return overlay;
  }

  function renderDiagnostics(diagnostics) {
    const host = ensureOverlay();
    const issues = diagnostics?.issues ?? [];
    if (!issues.length) {
      host.style.display = "none";
      host.innerHTML = "";
      return;
    }

    host.style.display = "block";
    host.innerHTML = [
      "<div style=\"font-weight:700;margin-bottom:8px\">SourceOG Diagnostics</div>",
      ...issues.map((issue) => {
        return "<div style=\"margin-bottom:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.06)\">" +
          "<div style=\"font-weight:600;color:" + (issue.level === "error" ? "#fca5a5" : issue.level === "warn" ? "#fde68a" : "#93c5fd") + "\">" + issue.code + "</div>" +
          "<div>" + issue.message + "</div>" +
          (issue.recoveryHint ? "<div style=\"margin-top:6px;color:#cbd5e1\">Hint: " + issue.recoveryHint + "</div>" : "") +
          "</div>";
      })
    ].join("");
  }

  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${wsProtocol}://${location.host}/__sourceog/ws`);
  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "diagnostics") {
      renderDiagnostics(payload.diagnostics);
      return;
    }

    if (payload.type === "sync") {
      renderDiagnostics(payload.diagnostics);
      if (payload.fullReload) {
        console.info("[SourceOG] Reloading after change:", payload.changedFile);
        location.reload();
      }
      return;
    }

    if (payload.type === "reload") {
      location.reload();
    }
  });

  async function navigate(url) {
    const response = await fetch(url, { headers: { "x-sourceog-navigate": "1" } });
    const html = await response.text();
    const nextDocument = new DOMParser().parseFromString(html, "text/html");
    document.title = nextDocument.title;
    document.body.innerHTML = nextDocument.body.innerHTML;
    history.pushState({}, "", url);
  }

  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("#") || anchor.target === "_blank") return;
    event.preventDefault();
    void navigate(href);
  });

  window.addEventListener("popstate", () => {
    location.reload();
  });
})();