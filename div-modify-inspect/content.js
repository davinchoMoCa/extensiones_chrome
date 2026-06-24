(() => {
  if (window.__divInspectorLoaded) {
    return;
  }
  window.__divInspectorLoaded = true;

  let active = false;
  let tooltip = null;
  let labelEl = null;
  let copyBtn = null;
  let resetBtn = null;
  let modeBtn = null;
  let pinnedEl = null;
  let resizeBox = null;
  let constraintBox = null;
  let sizeBadge = null;
  let resizeState = null;
  let moveState = null;
  let originalSizeStyle = null;
  let freeMode = false;

  const HIGHLIGHT_CLASS = "__div-inspector-highlight";
  const HOVER_CLASS = "__div-inspector-hover";
  const PINNED_CLASS = "__div-inspector-pinned";
  const INTERNAL_CLASSES = [HIGHLIGHT_CLASS, HOVER_CLASS, PINNED_CLASS];
  const RESIZE_DIRECTIONS = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];

  const SKIP_TAGS = new Set([
    "html", "head", "body", "script", "style", "meta", "link", "title",
    "noscript", "br", "hr", "path", "svg", "g", "defs", "use", "circle",
    "rect", "line", "polygon", "polyline", "ellipse", "text", "tspan",
  ]);

  function shouldHighlight(el) {
    if (!el || !el.tagName) return false;
    if (isInspectorNode(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return false;
    if (isInsideInspectorUi(el)) return false;
    return true;
  }

  function isInspectorNode(el) {
    if (!el || !el.classList) return false;
    if (typeof el.id === "string" && el.id.startsWith("__div-inspector")) return true;
    return Array.from(el.classList).some((c) => c.startsWith("__di-"));
  }

  function isInsideInspectorUi(el) {
    return isInsideTooltip(el) || isInsideResizeBox(el);
  }

  function isInsideTooltip(el) {
    if (!tooltip || !el) return false;
    return tooltip === el || tooltip.contains(el);
  }

  function isInsideResizeBox(el) {
    if (!resizeBox || !el) return false;
    return resizeBox === el || resizeBox.contains(el);
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

  function getElementSelector(el) {
    return buildSelectorPath(el) || (el && el.tagName ? el.tagName.toLowerCase() : "");
  }

  function getAppliedCss(el) {
    const rect = el.getBoundingClientRect();
    const lines = [
      `  width: ${Math.round(rect.width)}px;`,
      `  height: ${Math.round(rect.height)}px;`,
    ];

    if (originalSizeStyle && el.style.marginLeft !== originalSizeStyle.marginLeft) {
      lines.push(`  margin-left: ${el.style.marginLeft || "0px"};`);
    }
    if (originalSizeStyle && el.style.marginTop !== originalSizeStyle.marginTop) {
      lines.push(`  margin-top: ${el.style.marginTop || "0px"};`);
    }

    return lines.join("\n");
  }

  function buildCopyPayload(el) {
    const parent = freeMode ? document.body : getConstraintParent(el) || el.parentElement;
    const parentSelector = parent ? getElementSelector(parent) : "(sin padre)";
    const elementSelector = getElementSelector(el);
    const appliedCss = getAppliedCss(el);
    const computedCss = getKeyStyles(el);

    return [
      `Padre: ${parentSelector}`,
      `Elemento: ${elementSelector}`,
      `Modo: ${freeMode ? "Libre" : "Padre"}`,
      "",
      "CSS aplicado:",
      `${elementSelector} {`,
      appliedCss,
      "}",
      "",
      "CSS computado relevante:",
      computedCss ? `${elementSelector} {\n${computedCss}\n}` : "(sin estilos relevantes)",
    ].join("\n");
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
    btn.textContent = "📋 Copiar CSS";
    btn.addEventListener("click", onCopyClick, true);
    btn.addEventListener("mousedown", swallow, true);
    btn.addEventListener("mouseup", swallow, true);
    actions.appendChild(btn);

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "__di-reset-btn";
    reset.textContent = "↺ Reset cambios";
    reset.addEventListener("click", onResetSizeClick, true);
    reset.addEventListener("mousedown", swallow, true);
    reset.addEventListener("mouseup", swallow, true);
    actions.appendChild(reset);

    const mode = document.createElement("button");
    mode.type = "button";
    mode.className = "__di-mode-btn";
    mode.textContent = "🔒 Padre";
    mode.addEventListener("click", onModeClick, true);
    mode.addEventListener("mousedown", swallow, true);
    mode.addEventListener("mouseup", swallow, true);
    actions.appendChild(mode);

    t.appendChild(actions);
    document.body.appendChild(t);

    labelEl = label;
    copyBtn = btn;
    resetBtn = reset;
    modeBtn = mode;
    return t;
  }

  function swallow(e) {
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function createResizeBox() {
    const box = document.createElement("div");
    box.id = "__div-inspector-resize-box";

    const moveSurface = document.createElement("div");
    moveSurface.className = "__di-move-surface";
    moveSurface.title = "Arrastrar para mover";
    box.appendChild(moveSurface);

    const badge = document.createElement("div");
    badge.className = "__di-size-badge";
    box.appendChild(badge);

    RESIZE_DIRECTIONS.forEach((dir) => {
      const handle = document.createElement("div");
      handle.className = `__di-resize-handle __di-resize-${dir}`;
      handle.dataset.direction = dir;
      handle.title = `Redimensionar ${dir}`;
      box.appendChild(handle);
    });

    document.body.appendChild(box);
    sizeBadge = badge;
    return box;
  }

  function removeResizeBox() {
    if (resizeBox && resizeBox.parentNode) {
      resizeBox.parentNode.removeChild(resizeBox);
    }
    resizeBox = null;
    sizeBadge = null;
  }

  function createConstraintBox() {
    const box = document.createElement("div");
    box.id = "__div-inspector-constraint-box";
    const label = document.createElement("div");
    label.className = "__di-constraint-label";
    box.appendChild(label);
    document.body.appendChild(box);
    return box;
  }

  function removeConstraintBox() {
    if (constraintBox && constraintBox.parentNode) {
      constraintBox.parentNode.removeChild(constraintBox);
    }
    constraintBox = null;
  }

  function updateConstraintBox() {
    if (!constraintBox || !pinnedEl) return;
    const rect = getActiveContentRect(pinnedEl);
    const label = constraintBox.querySelector(".__di-constraint-label");
    if (label) label.textContent = freeMode ? "modo libre / ventana" : "padre / limite";
    constraintBox.style.display = "block";
    constraintBox.style.left = rect.left + "px";
    constraintBox.style.top = rect.top + "px";
    constraintBox.style.width = Math.max(0, rect.right - rect.left) + "px";
    constraintBox.style.height = Math.max(0, rect.bottom - rect.top) + "px";
  }

  function updateResizeBox() {
    if (!resizeBox || !pinnedEl) return;
    updateConstraintBox();
    const rect = pinnedEl.getBoundingClientRect();
    resizeBox.style.display = "block";
    resizeBox.style.left = rect.left + "px";
    resizeBox.style.top = rect.top + "px";
    resizeBox.style.width = rect.width + "px";
    resizeBox.style.height = rect.height + "px";
    if (sizeBadge) {
      sizeBadge.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    }
  }

  function containsRect(outer, inner) {
    return (
      outer.left <= inner.left + 1 &&
      outer.top <= inner.top + 1 &&
      outer.right >= inner.right - 1 &&
      outer.bottom >= inner.bottom - 1
    );
  }

  function getConstraintParent(el) {
    if (!el) return null;
    const elementRect = el.getBoundingClientRect();
    let current = el.parentElement;
    let firstMatch = null;
    let firstWithVerticalRoom = null;
    let firstWithBothRoom = null;

    while (current && current !== document.body && current !== document.documentElement) {
      if (!isInspectorNode(current)) {
        const rect = current.getBoundingClientRect();
        const hasSize = rect.width > 0 && rect.height > 0;
        const isDifferentBox = Math.abs(rect.width - elementRect.width) > 2 || Math.abs(rect.height - elementRect.height) > 2;
        if (hasSize && isDifferentBox && containsRect(rect, elementRect)) {
          firstMatch = firstMatch || current;
          const hasHorizontalRoom = rect.width > elementRect.width + 8;
          const hasVerticalRoom = rect.height > elementRect.height + 8;
          if (hasVerticalRoom && !firstWithVerticalRoom) firstWithVerticalRoom = current;
          if (hasHorizontalRoom && hasVerticalRoom) {
            firstWithBothRoom = current;
            break;
          }
        }
      }
      current = current.parentElement;
    }

    return firstWithBothRoom || firstWithVerticalRoom || firstMatch || el.parentElement;
  }

  function getParentContentRect(el) {
    const parent = getConstraintParent(el);
    if (!parent) {
      return {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };
    }

    const rect = parent.getBoundingClientRect();
    const styles = window.getComputedStyle(parent);
    return {
      left: rect.left + (parseFloat(styles.paddingLeft) || 0),
      top: rect.top + (parseFloat(styles.paddingTop) || 0),
      right: rect.right - (parseFloat(styles.paddingRight) || 0),
      bottom: rect.bottom - (parseFloat(styles.paddingBottom) || 0),
    };
  }

  function getViewportContentRect() {
    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
  }

  function getActiveContentRect(el) {
    return freeMode ? getViewportContentRect() : getParentContentRect(el);
  }

  function clamp(value, min, max) {
    if (min > max) return min;
    return Math.min(Math.max(value, min), max);
  }

  function getMinimumMargin(value) {
    return value < 0 ? value : 0;
  }

  function getMoveBounds(el, parentRect, startRect) {
    return {
      left: parentRect.left,
      right: parentRect.right,
      top: parentRect.top,
      bottom: parentRect.bottom,
    };
  }

  function onResizeMouseDown(e) {
    const handle = e.target && e.target.closest && e.target.closest(".__di-resize-handle");
    if (!handle || !pinnedEl) return;

    const rect = pinnedEl.getBoundingClientRect();
    const computed = window.getComputedStyle(pinnedEl);
    resizeState = {
      direction: handle.dataset.direction || "se",
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      parentRect: getActiveContentRect(pinnedEl),
      startRect: rect,
      boxSizing: computed.boxSizing,
    };

    document.documentElement.classList.add("__di-resizing");
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onMoveMouseDown(e) {
    const surface = e.target && e.target.closest && e.target.closest(".__di-move-surface");
    if (!surface || !pinnedEl) return;

    const computed = window.getComputedStyle(pinnedEl);
    const parentRect = getActiveContentRect(pinnedEl);
    const startRect = pinnedEl.getBoundingClientRect();
    moveState = {
      startX: e.clientX,
      startY: e.clientY,
      startMarginLeft: parseFloat(computed.marginLeft) || 0,
      startMarginTop: parseFloat(computed.marginTop) || 0,
      minMarginLeft: Number.NEGATIVE_INFINITY,
      minMarginTop: freeMode ? Number.NEGATIVE_INFINITY : getMinimumMargin(parseFloat(computed.marginTop) || 0),
      parentRect,
      moveBounds: getMoveBounds(pinnedEl, parentRect, startRect),
      startRect,
    };

    document.documentElement.classList.add("__di-moving");
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onResizeMouseMove(e) {
    if (!resizeState || !pinnedEl) return;

    const dx = e.clientX - resizeState.startX;
    const dy = e.clientY - resizeState.startY;
    const dir = resizeState.direction;
    let nextWidth = resizeState.startWidth;
    let nextHeight = resizeState.startHeight;

    if (dir.includes("e")) nextWidth = resizeState.startWidth + dx;
    if (dir.includes("w")) nextWidth = resizeState.startWidth - dx;
    if (dir.includes("s")) nextHeight = resizeState.startHeight + dy;
    if (dir.includes("n")) nextHeight = resizeState.startHeight - dy;

    if (dir.includes("e")) {
      nextWidth = Math.min(nextWidth, resizeState.parentRect.right - resizeState.startRect.left);
    }
    if (dir.includes("w")) {
      nextWidth = Math.min(nextWidth, resizeState.startRect.right - resizeState.parentRect.left);
    }
    if (dir.includes("s")) {
      nextHeight = Math.min(nextHeight, resizeState.parentRect.bottom - resizeState.startRect.top);
    }
    if (dir.includes("n")) {
      nextHeight = Math.min(nextHeight, resizeState.startRect.bottom - resizeState.parentRect.top);
    }

    nextWidth = Math.max(8, Math.round(nextWidth));
    nextHeight = Math.max(8, Math.round(nextHeight));

    pinnedEl.style.width = nextWidth + "px";
    pinnedEl.style.height = nextHeight + "px";

    setTooltipLabel(getLabel(pinnedEl));
    updateResizeBox();
    positionTooltipAt(pinnedEl);

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onMoveMouseMove(e) {
    if (!moveState || !pinnedEl) return;

    const minDx = moveState.moveBounds.left - moveState.startRect.left;
    const maxDx = moveState.moveBounds.right - moveState.startRect.right;
    const minDy = moveState.moveBounds.top - moveState.startRect.top;
    const maxDy = moveState.moveBounds.bottom - moveState.startRect.bottom;
    const rawDx = clamp(e.clientX - moveState.startX, minDx, maxDx);
    const rawDy = clamp(e.clientY - moveState.startY, minDy, maxDy);
    let nextMarginLeft = Math.round(Math.max(
      moveState.minMarginLeft,
      moveState.startMarginLeft + rawDx
    ));
    let nextMarginTop = Math.round(Math.max(
      moveState.minMarginTop,
      moveState.startMarginTop + rawDy
    ));

    pinnedEl.style.marginLeft = nextMarginLeft + "px";
    pinnedEl.style.marginTop = nextMarginTop + "px";

    const actualRect = pinnedEl.getBoundingClientRect();
    const bounds = moveState.moveBounds;
    if (actualRect.width <= bounds.right - bounds.left) {
      if (actualRect.left < bounds.left) nextMarginLeft += bounds.left - actualRect.left;
      if (actualRect.right > bounds.right) nextMarginLeft -= actualRect.right - bounds.right;
    }
    if (actualRect.height <= bounds.bottom - bounds.top) {
      if (actualRect.top < bounds.top) nextMarginTop += bounds.top - actualRect.top;
      if (actualRect.bottom > bounds.bottom) nextMarginTop -= actualRect.bottom - bounds.bottom;
    }

    nextMarginLeft = Math.round(Math.max(moveState.minMarginLeft, nextMarginLeft));
    nextMarginTop = Math.round(Math.max(moveState.minMarginTop, nextMarginTop));
    pinnedEl.style.marginLeft = nextMarginLeft + "px";
    pinnedEl.style.marginTop = nextMarginTop + "px";

    setTooltipLabel(getLabel(pinnedEl));
    updateResizeBox();
    positionTooltipAt(pinnedEl);

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onResizeMouseUp(e) {
    if (!resizeState) return;
    resizeState = null;
    document.documentElement.classList.remove("__di-resizing");
    updateResizeBox();
    if (pinnedEl) positionTooltipAt(pinnedEl);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onMoveMouseUp(e) {
    if (!moveState) return;
    moveState = null;
    document.documentElement.classList.remove("__di-moving");
    updateResizeBox();
    if (pinnedEl) positionTooltipAt(pinnedEl);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onResetSizeClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!pinnedEl) return;
    pinnedEl.style.width = originalSizeStyle ? originalSizeStyle.width : "";
    pinnedEl.style.height = originalSizeStyle ? originalSizeStyle.height : "";
    pinnedEl.style.marginLeft = originalSizeStyle ? originalSizeStyle.marginLeft : "";
    pinnedEl.style.marginTop = originalSizeStyle ? originalSizeStyle.marginTop : "";
    setTooltipLabel(getLabel(pinnedEl));
    updateResizeBox();
    positionTooltipAt(pinnedEl);
  }

  function onModeClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    freeMode = !freeMode;
    updateModeButton();
    updateResizeBox();
    if (pinnedEl) positionTooltipAt(pinnedEl);
  }

  function updateModeButton() {
    if (!modeBtn) return;
    modeBtn.textContent = freeMode ? "🔓 Libre" : "🔒 Padre";
    modeBtn.classList.toggle("__di-mode-free", freeMode);
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
    if (resetBtn) resetBtn.style.display = show ? "inline-block" : "none";
    if (modeBtn) modeBtn.style.display = show ? "inline-block" : "none";
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
    document.addEventListener("mousedown", onMoveMouseDown, true);
    document.addEventListener("mousemove", onMoveMouseMove, true);
    document.addEventListener("mouseup", onMoveMouseUp, true);
    document.addEventListener("mousedown", onResizeMouseDown, true);
    document.addEventListener("mousemove", onResizeMouseMove, true);
    document.addEventListener("mouseup", onResizeMouseUp, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", blockEvent, true);
    document.addEventListener("mouseup", blockEvent, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", updateResizeBox, true);
    window.addEventListener("resize", updateResizeBox, true);
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
    resetBtn = null;
    modeBtn = null;

    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("mousedown", onMoveMouseDown, true);
    document.removeEventListener("mousemove", onMoveMouseMove, true);
    document.removeEventListener("mouseup", onMoveMouseUp, true);
    document.removeEventListener("mousedown", onResizeMouseDown, true);
    document.removeEventListener("mousemove", onResizeMouseMove, true);
    document.removeEventListener("mouseup", onResizeMouseUp, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", blockEvent, true);
    document.removeEventListener("mouseup", blockEvent, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", updateResizeBox, true);
    window.removeEventListener("resize", updateResizeBox, true);
    document.documentElement.classList.remove("__di-resizing");
    document.documentElement.classList.remove("__di-moving");
    resizeState = null;
    moveState = null;
    removeResizeBox();
    removeConstraintBox();
  }

  function unpin() {
    if (pinnedEl) {
      pinnedEl.classList.remove(PINNED_CLASS);
      pinnedEl = null;
    }
    originalSizeStyle = null;
    moveState = null;
    removeResizeBox();
    removeConstraintBox();
    showCopyButton(false);
  }

  function pin(el) {
    unpin();
    pinnedEl = el;
    originalSizeStyle = {
      width: el.style.width,
      height: el.style.height,
      marginLeft: el.style.marginLeft,
      marginTop: el.style.marginTop,
    };
    el.classList.add(PINNED_CLASS);
    setTooltipLabel(getLabel(el));
    showCopyButton(true);
    updateModeButton();
    constraintBox = createConstraintBox();
    resizeBox = createResizeBox();
    updateResizeBox();
    positionTooltipAt(el);
  }

  function onMouseOver(e) {
    if (pinnedEl) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (isInsideInspectorUi(target)) return;
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
    if (isInsideInspectorUi(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    const target = e.target;
    if (isInsideInspectorUi(target)) return;

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
