(() => {
  if (window.__divInspectorLoaded) {
    return;
  }
  window.__divInspectorLoaded = true;

  let active = false;
  let tooltip = null;
  let labelEl = null;
  let copyBtn = null;
  let pinnedEl = null;

  const HIGHLIGHT_CLASS = "__div-inspector-highlight";
  const HOVER_CLASS = "__div-inspector-hover";
  const PINNED_CLASS = "__div-inspector-pinned";
  const INTERNAL_CLASSES = [HIGHLIGHT_CLASS, HOVER_CLASS, PINNED_CLASS];

  const SKIP_TAGS = new Set([
    "html", "head", "body", "script", "style", "meta", "link", "title",
    "noscript", "br", "hr", "path", "svg", "g", "defs", "use", "circle",
    "rect", "line", "polygon", "polyline", "ellipse", "text", "tspan",
  ]);

  function shouldHighlight(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return false;
    if (isInsideTooltip(el)) return false;
    return true;
  }

  function isInsideTooltip(el) {
    if (!tooltip || !el) return false;
    return tooltip === el || tooltip.contains(el);
  }

  function cleanClassList(el) {
    if (!el.className || typeof el.className !== "string") return [];
    return el.className
      .trim()
      .split(/\s+/)
      .filter((c) => c && !INTERNAL_CLASSES.includes(c));
  }

  function getLabel(el) {
    if (!el) return "";
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const classes = cleanClassList(el);
    const cls = classes.length ? "." + classes.join(".") : "";
    const size = `${Math.round(el.offsetWidth)}×${Math.round(el.offsetHeight)}`;
    return `${tag}${id}${cls}  ·  ${size}`;
  }

  function buildSelectorPath(el) {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && depth < 8) {
      const tag = cur.tagName.toLowerCase();
      const id = cur.id ? `#${cur.id}` : "";
      const classes = cleanClassList(cur).slice(0, 3);
      const cls = classes.length ? "." + classes.join(".") : "";
      parts.unshift(`${tag}${id}${cls}`);
      if (id) break; // id es suficientemente único
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  function getCleanOuterHTML(el, maxLen = 800) {
    const clone = el.cloneNode(true);
    // Remueve clases internas de la extensión en el clon.
    clone.querySelectorAll("*").forEach((n) => {
      INTERNAL_CLASSES.forEach((c) => n.classList && n.classList.remove(c));
      if (n.classList && n.classList.length === 0) n.removeAttribute("class");
    });
    INTERNAL_CLASSES.forEach((c) => clone.classList && clone.classList.remove(c));
    if (clone.classList && clone.classList.length === 0) clone.removeAttribute("class");

    let html = clone.outerHTML || "";
    if (html.length > maxLen) html = html.slice(0, maxLen) + "…";
    return html;
  }

  function getKeyStyles(el) {
    const s = window.getComputedStyle(el);
    const keys = [
      "display", "position", "top", "right", "bottom", "left",
      "width", "height", "margin", "padding",
      "flex-direction", "justify-content", "align-items", "gap",
      "grid-template-columns", "grid-template-rows",
      "background-color", "color", "font-size", "font-family",
      "border", "border-radius", "z-index", "overflow",
    ];
    const out = [];
    for (const k of keys) {
      const v = s.getPropertyValue(k);
      if (v && v !== "" && v !== "auto" && v !== "normal" && v !== "none" && v !== "0px") {
        out.push(`  ${k}: ${v};`);
      }
    }
    return out.join("\n");
  }

  function buildCopyPayload(el) {
    return getCleanOuterHTML(el, 5000);
  }

  function createTooltip() {
    const t = document.createElement("div");
    t.id = "__div-inspector-tooltip";

    const label = document.createElement("div");
    label.className = "__di-label";
    t.appendChild(label);

    const actions = document.createElement("div");
    actions.className = "__di-actions";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "__di-copy-btn";
    btn.textContent = "📋 Copiar elemento";
    btn.addEventListener("click", onCopyClick, true);
    btn.addEventListener("mousedown", swallow, true);
    btn.addEventListener("mouseup", swallow, true);
    actions.appendChild(btn);

    t.appendChild(actions);
    document.body.appendChild(t);

    labelEl = label;
    copyBtn = btn;
    return t;
  }

  function swallow(e) {
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  async function onCopyClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!pinnedEl) return;

    const payload = buildCopyPayload(pinnedEl);
    try {
      await navigator.clipboard.writeText(payload);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = payload;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (__) {}
      document.body.removeChild(ta);
    }

    const prev = copyBtn.textContent;
    copyBtn.textContent = "✓ Copiado";
    copyBtn.classList.add("__di-copied");
    setTimeout(() => {
      copyBtn.textContent = prev;
      copyBtn.classList.remove("__di-copied");
    }, 1400);
  }

  function setTooltipLabel(text) {
    if (labelEl) labelEl.textContent = text;
  }

  function showCopyButton(show) {
    if (copyBtn) copyBtn.style.display = show ? "inline-block" : "none";
  }

  function highlightAll() {
    document.querySelectorAll("*").forEach((el) => {
      if (shouldHighlight(el)) el.classList.add(HIGHLIGHT_CLASS);
    });
  }

  function positionTooltipAt(el) {
    if (!tooltip || !el) return;
    tooltip.style.display = "block";
    const rect = el.getBoundingClientRect();
    const tRect = tooltip.getBoundingClientRect();
    let x = rect.left;
    let y = rect.top - tRect.height - 6;
    if (y < 0) y = rect.bottom + 6;
    if (x + tRect.width > window.innerWidth) x = window.innerWidth - tRect.width - 4;
    if (x < 0) x = 4;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }

  function positionTooltipAtCursor(e) {
    if (!tooltip) return;
    const offset = 14;
    let x = e.clientX + offset;
    let y = e.clientY + offset;
    const rect = tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
    if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - offset;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }

  function enable() {
    highlightAll();
    tooltip = createTooltip();

    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", blockEvent, true);
    document.addEventListener("mouseup", blockEvent, true);
    document.addEventListener("keydown", onKeyDown, true);
  }

  function disable() {
    unpin();
    document.querySelectorAll("." + HIGHLIGHT_CLASS).forEach((el) => {
      el.classList.remove(HIGHLIGHT_CLASS);
    });
    document.querySelectorAll("." + HOVER_CLASS).forEach((el) => {
      el.classList.remove(HOVER_CLASS);
    });

    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
    }
    tooltip = null;
    labelEl = null;
    copyBtn = null;

    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", blockEvent, true);
    document.removeEventListener("mouseup", blockEvent, true);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function unpin() {
    if (pinnedEl) {
      pinnedEl.classList.remove(PINNED_CLASS);
      pinnedEl = null;
    }
    showCopyButton(false);
  }

  function pin(el) {
    unpin();
    pinnedEl = el;
    el.classList.add(PINNED_CLASS);
    setTooltipLabel(getLabel(el));
    showCopyButton(true);
    positionTooltipAt(el);
  }

  function onMouseOver(e) {
    if (pinnedEl) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (isInsideTooltip(target)) return;
    if (!shouldHighlight(target)) return;

    document.querySelectorAll("." + HOVER_CLASS).forEach((el) => {
      el.classList.remove(HOVER_CLASS);
    });
    target.classList.add(HOVER_CLASS);

    setTooltipLabel(getLabel(target));
    showCopyButton(false);
    if (tooltip) tooltip.style.display = "block";
  }

  function onMouseOut(e) {
    if (pinnedEl) return;
    if (e.relatedTarget === null && tooltip) {
      tooltip.style.display = "none";
    }
  }

  function onMouseMove(e) {
    if (pinnedEl) return;
    if (!tooltip || tooltip.style.display === "none") return;
    positionTooltipAtCursor(e);
  }

  function blockEvent(e) {
    if (isInsideTooltip(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    const target = e.target;
    if (isInsideTooltip(target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!(target instanceof HTMLElement)) return;
    if (!shouldHighlight(target)) return;

    if (pinnedEl === target) {
      unpin();
      if (tooltip) tooltip.style.display = "none";
      return;
    }

    document.querySelectorAll("." + HOVER_CLASS).forEach((el) => {
      el.classList.remove(HOVER_CLASS);
    });
    pin(target);
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && pinnedEl) {
      unpin();
      if (tooltip) tooltip.style.display = "none";
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!active) return;
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (shouldHighlight(node)) node.classList.add(HIGHLIGHT_CLASS);
        node.querySelectorAll && node.querySelectorAll("*").forEach((el) => {
          if (shouldHighlight(el)) el.classList.add(HIGHLIGHT_CLASS);
        });
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "TOGGLE_DIV_INSPECTOR") {
      active = !active;
      if (active) enable();
      else disable();
    }
  });
})();
