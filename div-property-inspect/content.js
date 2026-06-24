(() => {
  if (window.__divPropertyInspectorLoaded) {
    return;
  }
  window.__divPropertyInspectorLoaded = true;

  let active = false;
  let panel = null;
  let labelEl = null;
  let fieldsEl = null;
  let statusEl = null;
  let pinnedEl = null;
  let originalState = null;

  const HIGHLIGHT_CLASS = "__dpi-highlight";
  const HOVER_CLASS = "__dpi-hover";
  const PINNED_CLASS = "__dpi-pinned";
  const INTERNAL_CLASSES = [HIGHLIGHT_CLASS, HOVER_CLASS, PINNED_CLASS];

  const SKIP_TAGS = new Set([
    "html", "head", "body", "script", "style", "meta", "link", "title",
    "noscript", "br", "hr", "path", "svg", "g", "defs", "use", "circle",
    "rect", "line", "polygon", "polyline", "ellipse", "text", "tspan",
  ]);

  const INPUT_TYPES = [
    "text", "password", "email", "number", "tel", "url", "search", "date",
    "datetime-local", "time", "month", "week", "color", "checkbox", "radio",
    "file", "hidden", "range", "submit", "button", "reset",
  ];

  function isElementNode(node) {
    return Boolean(node && node.nodeType === 1 && node.tagName);
  }

  function getEventElement(e) {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const fromPath = path.find((node) => isElementNode(node));
    if (fromPath) return fromPath;
    return isElementNode(e.target) ? e.target : null;
  }

  function isInspectorNode(el) {
    if (!el || !el.classList) return false;
    if (typeof el.id === "string" && el.id.startsWith("__div-property-inspector")) return true;
    return Array.from(el.classList).some((c) => c.startsWith("__dpi-"));
  }

  function isInsidePanel(el) {
    if (!panel || !el) return false;
    return panel === el || panel.contains(el);
  }

  function shouldHighlight(el) {
    if (!isElementNode(el)) return false;
    if (isInspectorNode(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return false;
    if (isInsidePanel(el)) return false;
    return true;
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
    const cls = classes.length ? "." + classes.slice(0, 4).join(".") : "";
    const size = `${Math.round(el.offsetWidth)}x${Math.round(el.offsetHeight)}`;
    return `${tag}${id}${cls} · ${size}`;
  }

  function getAttr(el, name) {
    return el.hasAttribute(name) ? el.getAttribute(name) || "" : "";
  }

  function setAttr(el, name, value) {
    if (value === "") el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  function setBoolAttr(el, name, enabled) {
    if (enabled) el.setAttribute(name, "");
    else el.removeAttribute(name);
  }

  function getOriginalState(el) {
    const attrs = {};
    Array.from(el.attributes || []).forEach((attr) => {
      attrs[attr.name] = attr.value;
    });
    return {
      attrs,
      value: "value" in el ? el.value : null,
      checked: "checked" in el ? el.checked : null,
      textContent: el.textContent,
      contentEditable: el.getAttribute("contenteditable"),
    };
  }

  function restoreOriginalState() {
    if (!pinnedEl || !originalState) return;
    Array.from(pinnedEl.attributes || []).forEach((attr) => {
      pinnedEl.removeAttribute(attr.name);
    });
    Object.entries(originalState.attrs).forEach(([name, value]) => {
      pinnedEl.setAttribute(name, value);
    });
    if (originalState.value !== null && "value" in pinnedEl) pinnedEl.value = originalState.value;
    if (originalState.checked !== null && "checked" in pinnedEl) pinnedEl.checked = originalState.checked;
    if (!pinnedEl.matches("input,textarea,select,img")) {
      pinnedEl.textContent = originalState.textContent;
    }
    rebuildFields();
    showStatus("Restaurado");
  }

  function createPanel() {
    const p = document.createElement("div");
    p.id = "__div-property-inspector-panel";
    p.style.display = "block";
    p.style.right = "12px";
    p.style.top = "12px";

    labelEl = document.createElement("div");
    labelEl.className = "__dpi-label";
    labelEl.textContent = "Selecciona un elemento";
    p.appendChild(labelEl);

    fieldsEl = document.createElement("div");
    fieldsEl.className = "__dpi-fields";
    fieldsEl.textContent = "Haz clic sobre un input, enlace, imagen, boton o cualquier elemento para editar sus propiedades.";
    p.appendChild(fieldsEl);

    const actions = document.createElement("div");
    actions.className = "__dpi-actions";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "__dpi-button __dpi-reset";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", (e) => {
      swallow(e);
      restoreOriginalState();
    }, true);
    resetBtn.addEventListener("mousedown", swallow, true);
    actions.appendChild(resetBtn);

    statusEl = document.createElement("span");
    statusEl.className = "__dpi-status";
    actions.appendChild(statusEl);

    p.appendChild(actions);
    document.body.appendChild(p);
    return p;
  }

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function showStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => {
      if (statusEl) statusEl.textContent = "";
    }, 1200);
  }

  function makeTextField(label, value, onInput, placeholder = "") {
    const wrap = document.createElement("label");
    wrap.className = "__dpi-field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder;
    input.addEventListener("input", () => {
      onInput(input.value);
      refreshPinnedLabel();
      showStatus("Aplicado");
    });
    wrap.append(span, input);
    return wrap;
  }

  function makeSelectField(label, value, options, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "__dpi-field";
    const span = document.createElement("span");
    span.textContent = label;
    const select = document.createElement("select");
    options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt;
      select.appendChild(option);
    });
    select.value = value || options[0] || "";
    select.addEventListener("change", () => {
      onChange(select.value);
      refreshPinnedLabel();
      showStatus("Aplicado");
    });
    wrap.append(span, select);
    return wrap;
  }

  function makeCheckboxField(label, checked, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "__dpi-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(checked);
    input.addEventListener("change", () => {
      onChange(input.checked);
      refreshPinnedLabel();
      showStatus("Aplicado");
    });
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(input, span);
    return wrap;
  }

  function addCommonFields(el, out) {
    out.push(makeTextField("id", el.id, (value) => { el.id = value; }));
    out.push(makeTextField("class", cleanClassList(el).join(" "), (value) => { el.className = value; }));
    out.push(makeTextField("title", getAttr(el, "title"), (value) => setAttr(el, "title", value)));
    out.push(makeCheckboxField("hidden", el.hidden, (value) => { el.hidden = value; }));
    out.push(makeCheckboxField("contenteditable", el.isContentEditable, (value) => {
      setBoolAttr(el, "contenteditable", value);
    }));
  }

  function addInputFields(el, out) {
    out.push(makeSelectField("type", el.type || "text", INPUT_TYPES, (value) => {
      try {
        el.type = value;
      } catch (_) {
        setAttr(el, "type", value);
      }
    }));
    out.push(makeTextField("name", getAttr(el, "name"), (value) => setAttr(el, "name", value)));
    out.push(makeTextField("placeholder", getAttr(el, "placeholder"), (value) => setAttr(el, "placeholder", value)));
    out.push(makeTextField("value", el.value || "", (value) => {
      el.value = value;
      setAttr(el, "value", value);
    }));
    out.push(makeCheckboxField("disabled", el.disabled, (value) => { el.disabled = value; }));
    out.push(makeCheckboxField("required", el.required, (value) => { el.required = value; }));
    out.push(makeCheckboxField("readonly", el.readOnly, (value) => { el.readOnly = value; }));
    if ("checked" in el) {
      out.push(makeCheckboxField("checked", el.checked, (value) => {
        el.checked = value;
        setBoolAttr(el, "checked", value);
      }));
    }
  }

  function addTextareaFields(el, out) {
    out.push(makeTextField("name", getAttr(el, "name"), (value) => setAttr(el, "name", value)));
    out.push(makeTextField("placeholder", getAttr(el, "placeholder"), (value) => setAttr(el, "placeholder", value)));
    out.push(makeTextField("value", el.value || "", (value) => { el.value = value; }));
    out.push(makeCheckboxField("disabled", el.disabled, (value) => { el.disabled = value; }));
    out.push(makeCheckboxField("required", el.required, (value) => { el.required = value; }));
    out.push(makeCheckboxField("readonly", el.readOnly, (value) => { el.readOnly = value; }));
  }

  function addSelectFields(el, out) {
    out.push(makeTextField("name", getAttr(el, "name"), (value) => setAttr(el, "name", value)));
    out.push(makeCheckboxField("disabled", el.disabled, (value) => { el.disabled = value; }));
    out.push(makeCheckboxField("required", el.required, (value) => { el.required = value; }));
    out.push(makeCheckboxField("multiple", el.multiple, (value) => { el.multiple = value; }));
  }

  function addButtonFields(el, out) {
    out.push(makeSelectField("type", getAttr(el, "type") || "button", ["button", "submit", "reset"], (value) => setAttr(el, "type", value)));
    out.push(makeTextField("text", el.textContent || "", (value) => { el.textContent = value; }));
    out.push(makeCheckboxField("disabled", el.disabled, (value) => { el.disabled = value; }));
  }

  function addLinkFields(el, out) {
    out.push(makeTextField("href", getAttr(el, "href"), (value) => setAttr(el, "href", value), "https://"));
    out.push(makeTextField("target", getAttr(el, "target"), (value) => setAttr(el, "target", value), "_blank"));
    out.push(makeTextField("text", el.textContent || "", (value) => { el.textContent = value; }));
  }

  function addImageFields(el, out) {
    out.push(makeTextField("src", getAttr(el, "src"), (value) => setAttr(el, "src", value)));
    out.push(makeTextField("alt", getAttr(el, "alt"), (value) => setAttr(el, "alt", value)));
    out.push(makeTextField("width", getAttr(el, "width"), (value) => setAttr(el, "width", value)));
    out.push(makeTextField("height", getAttr(el, "height"), (value) => setAttr(el, "height", value)));
  }

  function buildFields(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    if (tag === "input") addInputFields(el, out);
    else if (tag === "textarea") addTextareaFields(el, out);
    else if (tag === "select") addSelectFields(el, out);
    else if (tag === "button") addButtonFields(el, out);
    else if (tag === "a") addLinkFields(el, out);
    else if (tag === "img") addImageFields(el, out);
    else {
      out.push(makeTextField("text", el.textContent || "", (value) => { el.textContent = value; }));
    }
    addCommonFields(el, out);
    return out;
  }

  function rebuildFields() {
    if (!fieldsEl || !pinnedEl) return;
    fieldsEl.replaceChildren(...buildFields(pinnedEl));
  }

  function refreshPinnedLabel() {
    if (pinnedEl && labelEl) labelEl.textContent = getLabel(pinnedEl);
  }

  function highlightAll() {
    document.querySelectorAll("*").forEach((el) => {
      if (shouldHighlight(el)) el.classList.add(HIGHLIGHT_CLASS);
    });
  }

  function clampNumber(value, min, max) {
    if (min > max) return min;
    return Math.min(Math.max(value, min), max);
  }

  function positionPanelDocked() {
    if (!panel) return;
    panel.style.display = "block";
    panel.style.right = "12px";
    panel.style.top = "12px";
    panel.style.left = "";
  }

  function positionPanelAt(el) {
    if (!panel || !el) return;
    positionPanelDocked();
  }

  function positionPanelAtCursor(e) {
    if (!panel) return;
    if (!pinnedEl) {
      positionPanelDocked();
      return;
    }
    const offset = 14;
    let x = e.clientX + offset;
    let y = e.clientY + offset;
    const pRect = panel.getBoundingClientRect();
    x = clampNumber(x, 6, window.innerWidth - pRect.width - 6);
    if (y + pRect.height > window.innerHeight) y = e.clientY - pRect.height - offset;
    y = clampNumber(y, 6, window.innerHeight - pRect.height - 6);
    panel.style.left = x + "px";
    panel.style.right = "";
    panel.style.top = y + "px";
  }

  function enable() {
    highlightAll();
    panel = createPanel();
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mousedown", onInspectMouseDown, true);
    document.addEventListener("click", blockEvent, true);
    document.addEventListener("mouseup", blockEvent, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onWindowMove, true);
    window.addEventListener("resize", onWindowMove, true);
  }

  function disable() {
    unpin();
    document.querySelectorAll("." + HIGHLIGHT_CLASS).forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
    document.querySelectorAll("." + HOVER_CLASS).forEach((el) => el.classList.remove(HOVER_CLASS));
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    labelEl = null;
    fieldsEl = null;
    statusEl = null;
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mousedown", onInspectMouseDown, true);
    document.removeEventListener("click", blockEvent, true);
    document.removeEventListener("mouseup", blockEvent, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onWindowMove, true);
    window.removeEventListener("resize", onWindowMove, true);
  }

  function unpin() {
    if (pinnedEl) {
      pinnedEl.classList.remove(PINNED_CLASS);
      pinnedEl = null;
    }
    originalState = null;
    if (fieldsEl) fieldsEl.textContent = "Haz clic sobre un input, enlace, imagen, boton o cualquier elemento para editar sus propiedades.";
    if (labelEl) labelEl.textContent = "Selecciona un elemento";
    positionPanelDocked();
  }

  function pin(el) {
    unpin();
    pinnedEl = el;
    originalState = getOriginalState(el);
    el.classList.add(PINNED_CLASS);
    if (labelEl) labelEl.textContent = getLabel(el);
    rebuildFields();
    positionPanelAt(el);
  }

  function onMouseOver(e) {
    if (pinnedEl) return;
    const target = getEventElement(e);
    if (!target) return;
    if (!shouldHighlight(target)) return;
    document.querySelectorAll("." + HOVER_CLASS).forEach((el) => el.classList.remove(HOVER_CLASS));
    target.classList.add(HOVER_CLASS);
    if (labelEl) labelEl.textContent = `Hover: ${getLabel(target)}`;
    if (panel) panel.style.display = "block";
  }

  function onMouseOut(e) {
    if (pinnedEl) return;
    if (e.relatedTarget === null && labelEl) labelEl.textContent = "Selecciona un elemento";
  }

  function onMouseMove(e) {
    if (pinnedEl) return;
  }

  function onWindowMove() {
    if (pinnedEl) positionPanelAt(pinnedEl);
  }

  function blockEvent(e) {
    if (isInsidePanel(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function selectTarget(target) {
    if (!isElementNode(target)) return;
    if (!shouldHighlight(target)) return;
    document.querySelectorAll("." + HOVER_CLASS).forEach((el) => el.classList.remove(HOVER_CLASS));
    if (pinnedEl !== target) pin(target);
    else refreshPinnedLabel();
  }

  function onInspectMouseDown(e) {
    const target = getEventElement(e);
    if (isInsidePanel(target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    selectTarget(target);
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && pinnedEl) {
      unpin();
      if (panel) panel.style.display = "none";
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!active) return;
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
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
