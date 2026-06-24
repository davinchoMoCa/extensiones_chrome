const $tree = document.getElementById('tree');
const $content = document.getElementById('content');
const $breadcrumb = document.getElementById('breadcrumb');
const $toolbar = document.getElementById('toolbar');
const $search = document.getElementById('global-search');
const $scopeAll = document.getElementById('scope-all');
const $menuRoot = document.getElementById('menu-root');
const $modalRoot = document.getElementById('modal-root');

let rootNodes = [];
let allBookmarks = [];
let allFolders = [];
const nodeMap = new Map();
const parentMap = new Map();
const pathMap = new Map();
const expanded = new Set();
let selectedFolderId = null;
let revealBookmarkId = null;
let pendingReveal = null;

// ============================================================
// Indexing
// ============================================================

function indexTree(nodes, parentId = null, path = []) {
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    parentMap.set(node.id, parentId);
    pathMap.set(node.id, path);
    if (node.children) {
      allFolders.push({
        id: node.id,
        title: node.title || '(sin título)',
        folderPath: path.join(' › '),
        parentId,
        dateAdded: node.dateAdded || node.dateGroupModified || 0,
        childCount: node.children.length,
      });
    }
    if (node.url) {
      allBookmarks.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        folderPath: path.join(' › '),
        parentId,
        dateAdded: node.dateAdded || 0,
      });
    }
    if (node.children) {
      const newPath = node.title ? [...path, node.title] : path;
      indexTree(node.children, node.id, newPath);
    }
  }
}

function isRootFolder(id) {
  const pid = parentMap.get(id);
  return !pid || pid === '0';
}

function isDescendantOf(maybeDescId, ancestorId) {
  if (maybeDescId === ancestorId) return true;
  let cur = parentMap.get(maybeDescId);
  while (cur) {
    if (cur === ancestorId) return true;
    cur = parentMap.get(cur);
  }
  return false;
}

function countBookmarksDeep(folderId) {
  let n = 0;
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop();
    const node = nodeMap.get(id);
    if (!node?.children) continue;
    for (const c of node.children) {
      if (c.url) n++;
      else stack.push(c.id);
    }
  }
  return n;
}

function getDescendantBookmarks(folderId) {
  const out = [];
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop();
    const node = nodeMap.get(id);
    if (!node?.children) continue;
    for (const c of node.children) {
      if (c.url) {
        out.push({
          id: c.id,
          title: c.title || c.url,
          url: c.url,
          folderPath: pathMap.get(c.id)?.join(' › ') || '',
          parentId: id,
          dateAdded: c.dateAdded || 0,
        });
      } else {
        stack.push(c.id);
      }
    }
  }
  return out;
}

function getDescendantFolders(folderId) {
  const out = [];
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop();
    const node = nodeMap.get(id);
    if (!node?.children) continue;
    for (const c of node.children) {
      if (c.url) continue;
      out.push({
        id: c.id,
        title: c.title || '(sin título)',
        folderPath: pathMap.get(c.id)?.join(' › ') || '',
        parentId: id,
        dateAdded: c.dateAdded || c.dateGroupModified || 0,
        childCount: (c.children || []).length,
      });
      stack.push(c.id);
    }
  }
  return out;
}

// ============================================================
// Helpers
// ============================================================

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function highlight(text, tokens) {
  if (!tokens.length) return escapeHtml(text);
  const lower = text.toLowerCase();
  const ranges = [];
  for (const t of tokens) {
    let i = 0;
    while ((i = lower.indexOf(t, i)) !== -1) {
      ranges.push([i, i + t.length]);
      i += t.length;
    }
  }
  if (!ranges.length) return escapeHtml(text);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0].slice()];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
    else merged.push(ranges[i].slice());
  }
  let html = '', pos = 0;
  for (const [a, b] of merged) {
    html += escapeHtml(text.slice(pos, a));
    html += '<mark>' + escapeHtml(text.slice(a, b)) + '</mark>';
    pos = b;
  }
  html += escapeHtml(text.slice(pos));
  return html;
}

function faviconUrl(pageUrl) {
  try {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '16');
    return url.toString();
  } catch { return ''; }
}

// ============================================================
// Tree rendering
// ============================================================

function renderTree() {
  $tree.innerHTML = '';
  for (const node of rootNodes) $tree.appendChild(renderTreeNode(node, 0));
}

function renderTreeNode(node, depth) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'tree-row' + (selectedFolderId === node.id ? ' selected' : '');
  row.style.paddingLeft = (6 + depth * 10) + 'px';

  const childFolders = (node.children || []).filter(c => !c.url);
  const isExpanded = expanded.has(node.id);

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  if (childFolders.length > 0) {
    toggle.textContent = isExpanded ? '▾' : '▸';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isExpanded) expanded.delete(node.id); else expanded.add(node.id);
      renderTree();
    });
  }
  row.appendChild(toggle);

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = '📁';
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'tree-label';
  const titleText = (node.title || '').trim();
  if (titleText) {
    label.textContent = titleText;
  } else {
    label.textContent = '(sin título)';
    label.style.fontStyle = 'italic';
    label.style.opacity = '0.6';
  }
  row.appendChild(label);

  const bmCount = (node.children || []).filter(c => c.url).length;
  if (bmCount > 0) {
    const count = document.createElement('span');
    count.className = 'tree-count';
    count.textContent = bmCount;
    row.appendChild(count);
  }

  const actionsBtn = document.createElement('button');
  actionsBtn.className = 'actions-btn';
  actionsBtn.textContent = '⋯';
  actionsBtn.title = 'Acciones';
  actionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openFolderMenu(node, actionsBtn);
  });
  row.appendChild(actionsBtn);

  row.addEventListener('click', () => selectFolder(node.id));
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openFolderMenu(node, null, { x: e.clientX, y: e.clientY });
  });

  wrap.appendChild(row);
  if (isExpanded && childFolders.length > 0) {
    for (const c of childFolders) wrap.appendChild(renderTreeNode(c, depth + 1));
  }
  return wrap;
}

// ============================================================
// Main pane rendering
// ============================================================

function selectFolder(folderId, options = {}) {
  selectedFolderId = folderId;
  let cur = parentMap.get(folderId);
  while (cur) { expanded.add(cur); cur = parentMap.get(cur); }
  if (!options.fromHash) history.replaceState(null, '', '#f=' + folderId);
  renderTree();
  renderContent();
  setTimeout(() => {
    const sel = $tree.querySelector('.tree-row.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }, 0);
}

function renderBreadcrumb() {
  if (!selectedFolderId) { $breadcrumb.innerHTML = ''; return; }
  const chain = [];
  let cur = selectedFolderId;
  while (cur) {
    const node = nodeMap.get(cur);
    if (node) chain.unshift(node);
    cur = parentMap.get(cur);
  }
  $breadcrumb.innerHTML = chain.map((n, i) => {
    const last = i === chain.length - 1;
    const title = escapeHtml(n.title || '(raíz)');
    if (last) return `<span class="current">${title}</span>`;
    return `<a data-id="${escapeHtml(n.id)}">${title}</a><span class="sep">›</span>`;
  }).join('');
  $breadcrumb.querySelectorAll('a[data-id]').forEach(a => {
    a.addEventListener('click', () => selectFolder(a.dataset.id));
  });
}

function renderToolbar() {
  $toolbar.innerHTML = '';
  if ($search.value.trim()) return;
  if (!selectedFolderId) return;
  const addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.textContent = '+ Agregar...';
  addBtn.addEventListener('click', () => {
    showMenu([
      { label: 'Nuevo favorito...', icon: '🔖', onClick: () => newBookmarkDialog(selectedFolderId) },
      { label: 'Nueva subcarpeta...', icon: '📁', onClick: () => newFolderDialog(selectedFolderId) },
    ], { anchor: addBtn });
  });
  $toolbar.appendChild(addBtn);

  const sortBtn = document.createElement('button');
  sortBtn.className = 'btn';
  sortBtn.textContent = 'Ordenar...';
  sortBtn.addEventListener('click', () => showSortMenu(selectedFolderId, sortBtn));
  $toolbar.appendChild(sortBtn);
}

function renderContent() {
  renderBreadcrumb();
  renderToolbar();
  const query = $search.value.trim();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (tokens.length) {
    renderSearchResults(tokens);
  } else if (selectedFolderId) {
    renderFolder(selectedFolderId);
  } else {
    $content.innerHTML = '<div class="empty">Selecciona una carpeta a la izquierda</div>';
  }
}

function renderFolder(folderId) {
  const node = nodeMap.get(folderId);
  const children = node?.children || [];
  if (children.length === 0) {
    $content.innerHTML = '<div class="empty">Carpeta vacía</div>';
    return;
  }
  const folders = children.filter(c => !c.url);
  const links = children.filter(c => c.url);

  let html = '';
  if (folders.length) {
    html += '<div class="section-title">Carpetas</div><div class="bm-list">';
    for (const f of folders) {
      const childCount = (f.children || []).length;
      html += `
        <div class="bm is-folder" data-folder-id="${escapeHtml(f.id)}">
          <div class="bm-fav"></div>
          <div class="bm-info">
            <div class="bm-title">${escapeHtml(f.title || '(sin título)')}</div>
            <div class="bm-url">${childCount} ${childCount === 1 ? 'elemento' : 'elementos'}</div>
          </div>
          <button class="actions-btn" data-action-id="${escapeHtml(f.id)}" data-action-kind="folder">⋯</button>
        </div>`;
    }
    html += '</div>';
  }
  if (links.length) {
    html += `<div class="section-title">Favoritos (${links.length})</div><div class="bm-list">`;
    for (const c of links) {
      const b = { id: c.id, title: c.title || c.url, url: c.url, folderPath: '', parentId: folderId };
      html += renderBookmarkRow(b, [], { hidePath: true });
    }
    html += '</div>';
  }
  $content.innerHTML = html;
  attachContentHandlers();
  if (revealBookmarkId) doReveal();
}

function renderSearchResults(tokens) {
  const searchEverywhere = $scopeAll.checked || !selectedFolderId;
  const bookmarkScope = searchEverywhere ? allBookmarks : getDescendantBookmarks(selectedFolderId);
  const folderScope = searchEverywhere ? allFolders : getDescendantFolders(selectedFolderId);
  const results = [];
  function scoreItem(item, kind) {
    const titleL = item.title.toLowerCase();
    const urlL = kind === 'bookmark' ? item.url.toLowerCase() : '';
    const pathL = item.folderPath.toLowerCase();
    let score = 0, allMatch = true;
    for (const t of tokens) {
      const inTitle = titleL.indexOf(t);
      const inPath = pathL.indexOf(t);
      const inUrl = urlL.indexOf(t);
      if (inTitle === -1 && inPath === -1 && inUrl === -1) { allMatch = false; break; }
      if (inTitle !== -1) {
        score += 30;
        if (inTitle === 0) score += 80;
        else if (/[\s\W_]/.test(titleL[inTitle - 1])) score += 30;
      } else if (inPath !== -1) score += 15;
      else if (inUrl !== -1) score += 8;
    }
    if (!allMatch) return null;
    score -= titleL.length * 0.05;
    if (kind === 'folder') score += 12;
    return score;
  }
  for (const b of bookmarkScope) {
    const score = scoreItem(b, 'bookmark');
    if (score !== null) results.push({ kind: 'bookmark', item: b, score });
  }
  for (const f of folderScope) {
    const score = scoreItem(f, 'folder');
    if (score !== null) results.push({ kind: 'folder', item: f, score });
  }
  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, 200);

  if (top.length === 0) {
    $content.innerHTML = '<div class="empty">Sin resultados</div>';
    return;
  }
  let html = `<div class="section-title">${top.length} resultado${top.length === 1 ? '' : 's'}</div><div class="bm-list">`;
  for (const result of top) {
    html += result.kind === 'folder'
      ? renderFolderSearchRow(result.item, tokens)
      : renderBookmarkRow(result.item, tokens);
  }
  html += '</div>';
  $content.innerHTML = html;
  attachContentHandlers();
}

function renderFolderSearchRow(folder, tokens) {
  const countLabel = `${folder.childCount} ${folder.childCount === 1 ? 'elemento' : 'elementos'}`;
  return `
    <div class="bm is-folder" data-folder-id="${escapeHtml(folder.id)}">
      <div class="bm-fav"></div>
      <div class="bm-info">
        <div class="bm-title">${highlight(folder.title, tokens)}</div>
        <div class="bm-url">
          ${folder.folderPath ? `<span class="bm-path" data-folder-id="${escapeHtml(folder.parentId || '')}" title="Ir a carpeta padre">${highlight(folder.folderPath, tokens)}</span> · ` : ''}
          ${escapeHtml(countLabel)}
        </div>
      </div>
      <button class="actions-btn" data-action-id="${escapeHtml(folder.id)}" data-action-kind="folder">⋯</button>
    </div>`;
}

function renderBookmarkRow(b, tokens, opts = {}) {
  const showPath = !opts.hidePath && b.folderPath;
  return `
    <div class="bm" data-bm-id="${escapeHtml(b.id)}" data-bm-url="${escapeHtml(b.url)}">
      <img class="bm-fav" src="${escapeHtml(faviconUrl(b.url))}" alt="">
      <div class="bm-info">
        <div class="bm-title">${highlight(b.title, tokens)}</div>
        <div class="bm-url">
          ${showPath ? `<span class="bm-path" data-folder-id="${escapeHtml(b.parentId || '')}" title="Ir a esta carpeta">${highlight(b.folderPath, tokens)}</span> · ` : ''}
          ${highlight(b.url, tokens)}
        </div>
      </div>
      <button class="actions-btn" data-action-id="${escapeHtml(b.id)}" data-action-kind="bookmark">⋯</button>
    </div>`;
}

function attachContentHandlers() {
  $content.querySelectorAll('.bm.is-folder').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.actions-btn')) return;
      selectFolder(el.dataset.folderId);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const node = nodeMap.get(el.dataset.folderId);
      if (node) openFolderMenu(node, null, { x: e.clientX, y: e.clientY });
    });
  });
  $content.querySelectorAll('.bm[data-bm-url]').forEach(el => {
    const open = (e) => {
      if (e.target.closest('.actions-btn') || e.target.closest('.bm-path')) return;
      const url = el.dataset.bmUrl;
      const newTab = !(e.metaKey || e.ctrlKey || e.button === 1);
      chrome.tabs.create({ url, active: newTab && !e.shiftKey });
    };
    el.addEventListener('click', open);
    el.addEventListener('auxclick', (e) => { if (e.button === 1) open(e); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const node = nodeMap.get(el.dataset.bmId);
      if (node) openBookmarkMenu(node, null, { x: e.clientX, y: e.clientY });
    });
  });
  $content.querySelectorAll('.bm-path').forEach(span => {
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      $search.value = '';
      selectFolder(span.dataset.folderId);
    });
  });
  $content.querySelectorAll('.bm-fav').forEach(img => {
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  });
  $content.querySelectorAll('.actions-btn[data-action-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.actionId;
      const kind = btn.dataset.actionKind;
      const node = nodeMap.get(id);
      if (!node) return;
      if (kind === 'folder') openFolderMenu(node, btn);
      else openBookmarkMenu(node, btn);
    });
  });
}

function doReveal() {
  const id = revealBookmarkId;
  revealBookmarkId = null;
  setTimeout(() => {
    const el = $content.querySelector(`.bm[data-bm-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
  }, 60);
}

// ============================================================
// Menu system
// ============================================================

function hideMenu() {
  $menuRoot.innerHTML = '';
  document.querySelectorAll('.actions-btn.active').forEach(b => b.classList.remove('active'));
  document.removeEventListener('mousedown', onDocDownForMenu, true);
  document.removeEventListener('keydown', onKeyForMenu, true);
}

function onDocDownForMenu(e) {
  if (!e.target.closest('.menu')) hideMenu();
}
function onKeyForMenu(e) {
  if (e.key === 'Escape') { e.stopPropagation(); hideMenu(); }
}

function showMenu(items, opts) {
  hideMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'menu-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '');
    el.innerHTML = `<span class="menu-icon">${escapeHtml(item.icon || '')}</span><span class="menu-label">${escapeHtml(item.label)}</span>`;
    if (!item.disabled) {
      el.addEventListener('click', () => {
        hideMenu();
        item.onClick?.();
      });
    }
    menu.appendChild(el);
  }
  $menuRoot.appendChild(menu);

  let top, left;
  if (opts.anchor) {
    const r = opts.anchor.getBoundingClientRect();
    top = r.bottom + 4;
    left = r.right;
    opts.anchor.classList.add('active');
  } else {
    top = opts.y;
    left = opts.x;
  }
  menu.style.top = '0px';
  menu.style.left = '0px';
  const m = menu.getBoundingClientRect();
  if (opts.anchor) left = Math.max(8, opts.anchor.getBoundingClientRect().right - m.width);
  if (left + m.width > window.innerWidth - 8) left = window.innerWidth - m.width - 8;
  if (left < 8) left = 8;
  if (top + m.height > window.innerHeight - 8) {
    if (opts.anchor) top = opts.anchor.getBoundingClientRect().top - m.height - 4;
    else top = window.innerHeight - m.height - 8;
  }
  if (top < 8) top = 8;
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', onDocDownForMenu, true);
    document.addEventListener('keydown', onKeyForMenu, true);
  }, 0);
}

function openBookmarkMenu(node, anchor, pos) {
  const siblings = nodeMap.get(node.parentId)?.children || [];
  const isFirst = node.index === 0 || siblings[0]?.id === node.id;
  const isLast = node.index === siblings.length - 1 || siblings[siblings.length - 1]?.id === node.id;
  const items = [
    { label: 'Abrir en pestaña nueva', icon: '↗', onClick: () => chrome.tabs.create({ url: node.url }) },
    { label: 'Copiar URL', icon: '⧉', onClick: () => copyToClipboard(node.url) },
    { separator: true },
    { label: 'Editar...', icon: '✎', onClick: () => editDialog(node) },
    { label: 'Mover a carpeta...', icon: '→', onClick: () => moveToFolderDialog(node.id) },
    { separator: true },
    { label: 'Mover al inicio', icon: '⤒', disabled: isFirst, onClick: () => moveToTop(node.id) },
    { label: 'Mover al final', icon: '⤓', disabled: isLast, onClick: () => moveToBottom(node.id) },
    { label: 'Subir', icon: '↑', disabled: isFirst, onClick: () => moveUp(node.id) },
    { label: 'Bajar', icon: '↓', disabled: isLast, onClick: () => moveDown(node.id) },
    { separator: true },
    { label: 'Eliminar', icon: '🗑', danger: true, onClick: () => deleteBookmarkConfirm(node) },
  ];
  showMenu(items, anchor ? { anchor } : pos);
}

function openFolderMenu(node, anchor, pos) {
  const isRoot = isRootFolder(node.id);
  if (isRoot) {
    const items = [
      { label: 'Nuevo favorito aquí...', icon: '🔖', onClick: () => newBookmarkDialog(node.id) },
      { label: 'Nueva subcarpeta...', icon: '📁', onClick: () => newFolderDialog(node.id) },
      { separator: true },
      { label: 'Ordenar carpeta...', icon: '↕', onClick: () => showSortMenu(node.id, anchor) },
      { separator: true },
      { label: 'Abrir esta carpeta', icon: '→', onClick: () => selectFolder(node.id) },
    ];
    showMenu(items, anchor ? { anchor } : pos);
    return;
  }
  const siblings = nodeMap.get(node.parentId)?.children || [];
  const isFirst = node.index === 0 || siblings[0]?.id === node.id;
  const isLast = node.index === siblings.length - 1 || siblings[siblings.length - 1]?.id === node.id;
  const items = [
    { label: 'Abrir esta carpeta', icon: '→', onClick: () => selectFolder(node.id) },
    { separator: true },
    { label: 'Renombrar...', icon: '✎', onClick: () => editDialog(node) },
    { label: 'Nueva subcarpeta...', icon: '📁', onClick: () => newFolderDialog(node.id) },
    { label: 'Nuevo favorito aquí...', icon: '🔖', onClick: () => newBookmarkDialog(node.id) },
    { separator: true },
    { label: 'Ordenar carpeta...', icon: '↕', onClick: () => showSortMenu(node.id, anchor) },
    { separator: true },
    { label: 'Mover a carpeta...', icon: '→', onClick: () => moveToFolderDialog(node.id) },
    { label: 'Mover al inicio', icon: '⤒', disabled: isFirst, onClick: () => moveToTop(node.id) },
    { label: 'Mover al final', icon: '⤓', disabled: isLast, onClick: () => moveToBottom(node.id) },
    { label: 'Subir', icon: '↑', disabled: isFirst, onClick: () => moveUp(node.id) },
    { label: 'Bajar', icon: '↓', disabled: isLast, onClick: () => moveDown(node.id) },
    { separator: true },
    { label: 'Eliminar', icon: '🗑', danger: true, onClick: () => deleteFolderConfirm(node) },
  ];
  showMenu(items, anchor ? { anchor } : pos);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function showSortMenu(folderId, anchor) {
  const folder = nodeMap.get(folderId);
  if (!folder?.children) return;
  const menuPos = anchor ? { anchor } : { x: Math.round(window.innerWidth / 2), y: 72 };
  showMenu([
    { label: 'Carpetas primero A-Z', icon: 'A', onClick: () => sortFolderChildren(folderId, 'folders-first-asc') },
    { label: 'Todo A-Z', icon: 'A', onClick: () => sortFolderChildren(folderId, 'title-asc') },
    { label: 'Todo Z-A', icon: 'Z', onClick: () => sortFolderChildren(folderId, 'title-desc') },
    { label: 'Más recientes primero', icon: '↓', onClick: () => sortFolderChildren(folderId, 'recent-first') },
  ], menuPos);
}

// ============================================================
// Modal system
// ============================================================

let activeModalKeyHandler = null;

function hideModal() {
  $modalRoot.innerHTML = '';
  if (activeModalKeyHandler) {
    document.removeEventListener('keydown', activeModalKeyHandler, true);
    activeModalKeyHandler = null;
  }
}

function showModal({ title, body, buttons = [], onClose, focusSelector = 'input' }) {
  hideModal();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-header"></div><div class="modal-body"></div><div class="modal-footer"></div>`;
  modal.querySelector('.modal-header').textContent = title;
  const bodyEl = modal.querySelector('.modal-body');
  const footerEl = modal.querySelector('.modal-footer');

  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  let defaultBtn = null;
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : '');
    btn.textContent = b.label;
    btn.addEventListener('click', () => b.onClick?.(modal));
    footerEl.appendChild(btn);
    if (b.isDefault || (b.primary && !defaultBtn) || (b.danger && !defaultBtn)) defaultBtn = btn;
  }

  $modalRoot.innerHTML = '';
  $modalRoot.appendChild(modal);

  $modalRoot.addEventListener('mousedown', (e) => {
    if (e.target === $modalRoot) { hideModal(); onClose?.(); }
  }, { once: true });

  activeModalKeyHandler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      hideModal(); onClose?.();
    } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      if (defaultBtn) {
        e.preventDefault();
        defaultBtn.click();
      }
    }
  };
  document.addEventListener('keydown', activeModalKeyHandler, true);

  setTimeout(() => {
    const el = bodyEl.querySelector(focusSelector);
    if (el) { el.focus(); if (el.select) el.select(); }
  }, 0);

  return { modal, body: bodyEl, footer: footerEl };
}

function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Aceptar', danger = false }) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.textContent = message;
    showModal({
      title,
      body,
      onClose: () => resolve(false),
      buttons: [
        { label: 'Cancelar', onClick: () => { hideModal(); resolve(false); } },
        { label: confirmLabel, primary: !danger, danger, isDefault: true, onClick: () => { hideModal(); resolve(true); } },
      ],
    });
  });
}

// ============================================================
// Dialogs
// ============================================================

function editDialog(node) {
  const isFolder = !node.url;
  const body = document.createElement('div');
  body.innerHTML = `
    <label for="edit-title">Título</label>
    <input type="text" id="edit-title">
    ${isFolder ? '' : `
      <label for="edit-url">URL</label>
      <input type="url" id="edit-url">
    `}
  `;
  body.querySelector('#edit-title').value = node.title || '';
  if (!isFolder) body.querySelector('#edit-url').value = node.url || '';

  showModal({
    title: isFolder ? 'Renombrar carpeta' : 'Editar favorito',
    body,
    focusSelector: '#edit-title',
    buttons: [
      { label: 'Cancelar', onClick: hideModal },
      {
        label: 'Guardar', primary: true, isDefault: true,
        onClick: async () => {
          const title = body.querySelector('#edit-title').value.trim();
          const update = { title };
          if (!isFolder) {
            const url = body.querySelector('#edit-url').value.trim();
            if (url) update.url = url;
          }
          try {
            await chrome.bookmarks.update(node.id, update);
            pendingReveal = node.id;
            hideModal();
          } catch (err) {
            alert('Error: ' + err.message);
          }
        }
      },
    ],
  });
}

function newBookmarkDialog(parentId) {
  const body = document.createElement('div');
  body.innerHTML = `
    <label for="new-title">Título</label>
    <input type="text" id="new-title" placeholder="Nombre del favorito">
    <label for="new-url">URL</label>
    <input type="url" id="new-url" placeholder="https://...">
  `;
  showModal({
    title: 'Nuevo favorito',
    body,
    focusSelector: '#new-title',
    buttons: [
      { label: 'Cancelar', onClick: hideModal },
      {
        label: 'Crear', primary: true, isDefault: true,
        onClick: async () => {
          const title = body.querySelector('#new-title').value.trim();
          const url = body.querySelector('#new-url').value.trim();
          if (!url) { alert('Falta la URL'); return; }
          try {
            const created = await chrome.bookmarks.create({ parentId, title: title || url, url });
            pendingReveal = created.id;
            hideModal();
          } catch (err) {
            alert('Error: ' + err.message);
          }
        }
      },
    ],
  });
}

function newFolderDialog(parentId) {
  const body = document.createElement('div');
  body.innerHTML = `
    <label for="new-folder">Nombre</label>
    <input type="text" id="new-folder" placeholder="Nombre de la carpeta">
  `;
  showModal({
    title: 'Nueva subcarpeta',
    body,
    focusSelector: '#new-folder',
    buttons: [
      { label: 'Cancelar', onClick: hideModal },
      {
        label: 'Crear', primary: true, isDefault: true,
        onClick: async () => {
          const title = body.querySelector('#new-folder').value.trim();
          if (!title) return;
          try {
            const created = await chrome.bookmarks.create({ parentId, title });
            pendingReveal = created.id;
            hideModal();
          } catch (err) {
            alert('Error: ' + err.message);
          }
        }
      },
    ],
  });
}

function moveToFolderDialog(itemId) {
  const itemNode = nodeMap.get(itemId);
  if (!itemNode) return;
  const isFolder = !itemNode.url;

  // Build flat list of valid target folders
  const folders = [];
  function collect(nodes) {
    for (const n of nodes) {
      if (n.url) continue;
      if (isFolder && isDescendantOf(n.id, itemId)) continue;
      if (n.id === itemNode.parentId) {
        // skip current parent (no-op move)
      } else {
        folders.push({
          id: n.id,
          title: n.title || '(sin título)',
          path: pathMap.get(n.id)?.join(' › ') || '',
        });
      }
      if (n.children) collect(n.children);
    }
  }
  collect(rootNodes);

  const body = document.createElement('div');
  body.className = 'fp-wrap';
  body.innerHTML = `
    <input class="fp-search" type="text" placeholder="Buscar carpeta..." autocomplete="off" spellcheck="false">
    <div class="fp-list"></div>
  `;
  const $fpSearch = body.querySelector('.fp-search');
  const $fpList = body.querySelector('.fp-list');
  let selectedTargetId = folders[0]?.id || null;

  function renderList() {
    const q = $fpSearch.value.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    const matched = folders.filter(f => {
      if (!tokens.length) return true;
      const hay = (f.title + ' ' + f.path).toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
    if (!matched.length) {
      $fpList.innerHTML = '<div style="padding:14px;color:var(--muted);text-align:center">Sin coincidencias</div>';
      selectedTargetId = null;
      return;
    }
    if (!matched.find(f => f.id === selectedTargetId)) selectedTargetId = matched[0].id;
    $fpList.innerHTML = matched.map(f => `
      <div class="fp-item${f.id === selectedTargetId ? ' selected' : ''}" data-id="${escapeHtml(f.id)}">
        <span class="fp-icon">📁</span>
        <span class="fp-name">${highlight(f.title, tokens)}</span>
        ${f.path ? `<span class="fp-path">${highlight(f.path, tokens)}</span>` : ''}
      </div>
    `).join('');
    $fpList.querySelectorAll('.fp-item').forEach(el => {
      el.addEventListener('click', () => {
        selectedTargetId = el.dataset.id;
        $fpList.querySelectorAll('.fp-item').forEach(x => x.classList.toggle('selected', x.dataset.id === selectedTargetId));
      });
      el.addEventListener('dblclick', () => {
        selectedTargetId = el.dataset.id;
        confirm.click();
      });
    });
    const sel = $fpList.querySelector('.fp-item.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  $fpSearch.addEventListener('input', renderList);
  $fpSearch.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...$fpList.querySelectorAll('.fp-item')];
      const idx = items.findIndex(el => el.dataset.id === selectedTargetId);
      const next = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      if (items[next]) {
        selectedTargetId = items[next].dataset.id;
        items.forEach(x => x.classList.toggle('selected', x.dataset.id === selectedTargetId));
        items[next].scrollIntoView({ block: 'nearest' });
      }
    }
  });

  const { footer } = showModal({
    title: 'Mover "' + (itemNode.title || itemNode.url) + '" a...',
    body,
    focusSelector: '.fp-search',
    buttons: [
      { label: 'Cancelar', onClick: hideModal },
      {
        label: 'Mover aquí', primary: true, isDefault: true,
        onClick: async () => {
          if (!selectedTargetId) return;
          try {
            await chrome.bookmarks.move(itemId, { parentId: selectedTargetId });
            pendingReveal = itemId;
            hideModal();
          } catch (err) {
            alert('Error: ' + err.message);
          }
        }
      },
    ],
  });
  const confirm = footer.querySelector('.btn-primary');
  renderList();
}

async function deleteBookmarkConfirm(node) {
  const ok = await confirmDialog({
    title: 'Eliminar favorito',
    message: `¿Eliminar "${node.title || node.url}"?`,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  try { await chrome.bookmarks.remove(node.id); }
  catch (err) { alert('Error: ' + err.message); }
}

async function deleteFolderConfirm(node) {
  const count = countBookmarksDeep(node.id);
  let message = `¿Eliminar la carpeta "${node.title}"?`;
  if (count > 0) message += ` Contiene ${count} ${count === 1 ? 'favorito' : 'favoritos'} que también se eliminarán.`;
  const ok = await confirmDialog({
    title: 'Eliminar carpeta',
    message,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  try { await chrome.bookmarks.removeTree(node.id); }
  catch (err) { alert('Error: ' + err.message); }
}

// ============================================================
// Move actions
// ============================================================

async function moveToTop(id) {
  const [n] = await chrome.bookmarks.get(id);
  await chrome.bookmarks.move(id, { parentId: n.parentId, index: 0 });
  pendingReveal = id;
}

async function moveToBottom(id) {
  const [n] = await chrome.bookmarks.get(id);
  const sibs = await chrome.bookmarks.getChildren(n.parentId);
  await chrome.bookmarks.move(id, { parentId: n.parentId, index: sibs.length });
  pendingReveal = id;
}

async function moveUp(id) {
  const [n] = await chrome.bookmarks.get(id);
  if (n.index <= 0) return;
  await chrome.bookmarks.move(id, { parentId: n.parentId, index: n.index - 1 });
  pendingReveal = id;
}

async function moveDown(id) {
  const [n] = await chrome.bookmarks.get(id);
  const sibs = await chrome.bookmarks.getChildren(n.parentId);
  if (n.index >= sibs.length - 1) return;
  // Equivalent to moving down: pull the next sibling above us.
  const next = sibs[n.index + 1];
  await chrome.bookmarks.move(next.id, { parentId: n.parentId, index: n.index });
  pendingReveal = id;
}

function compareBookmarkNodes(a, b, mode) {
  const aIsFolder = !a.url;
  const bIsFolder = !b.url;
  const aTitle = a.title || a.url || '';
  const bTitle = b.title || b.url || '';

  if (mode === 'folders-first-asc' && aIsFolder !== bIsFolder) {
    return aIsFolder ? -1 : 1;
  }
  if (mode === 'recent-first') {
    const aDate = a.dateAdded || a.dateGroupModified || 0;
    const bDate = b.dateAdded || b.dateGroupModified || 0;
    if (bDate !== aDate) return bDate - aDate;
  }

  const byTitle = aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base', numeric: true });
  if (mode === 'title-desc') return -byTitle;
  return byTitle;
}

async function sortFolderChildren(folderId, mode) {
  const folder = nodeMap.get(folderId);
  const children = folder?.children || [];
  if (children.length < 2) return;

  const sorted = children
    .map((node, originalIndex) => ({ node, originalIndex }))
    .sort((a, b) => compareBookmarkNodes(a.node, b.node, mode) || a.originalIndex - b.originalIndex);

  const currentIds = children.map(n => n.id).join('\n');
  const sortedIds = sorted.map(item => item.node.id).join('\n');
  if (currentIds === sortedIds) return;

  const folderName = folder.title || '(sin título)';
  const ok = await confirmDialog({
    title: 'Ordenar carpeta',
    message: `¿Ordenar "${folderName}"? Esta acción cambiará el orden real de sus favoritos y subcarpetas.`,
    confirmLabel: 'Ordenar',
  });
  if (!ok) return;

  try {
    for (let index = 0; index < sorted.length; index++) {
      await chrome.bookmarks.move(sorted[index].node.id, { parentId: folderId, index });
    }
    pendingReveal = null;
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ============================================================
// Refresh on bookmark events
// ============================================================

function rebuildIndex() {
  nodeMap.clear();
  parentMap.clear();
  pathMap.clear();
  allBookmarks = [];
  allFolders = [];
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 50);
}

async function refresh() {
  const prevExpanded = new Set(expanded);
  const prevSelected = selectedFolderId;
  rebuildIndex();
  const tree = await chrome.bookmarks.getTree();
  rootNodes = tree[0]?.children || [];
  indexTree(rootNodes);
  expanded.clear();
  for (const id of prevExpanded) if (nodeMap.has(id)) expanded.add(id);
  for (const n of rootNodes) expanded.add(n.id);

  if (pendingReveal && nodeMap.has(pendingReveal)) {
    const id = pendingReveal;
    pendingReveal = null;
    const node = nodeMap.get(id);
    if (node.url) {
      const parent = parentMap.get(id);
      revealBookmarkId = id;
      selectedFolderId = parent || prevSelected;
    } else {
      selectedFolderId = id;
    }
  } else if (prevSelected && nodeMap.has(prevSelected)) {
    selectedFolderId = prevSelected;
  } else if (rootNodes[0]) {
    selectedFolderId = rootNodes[0].id;
  }

  let cur = parentMap.get(selectedFolderId);
  while (cur) { expanded.add(cur); cur = parentMap.get(cur); }

  renderTree();
  renderContent();
}

chrome.bookmarks.onCreated.addListener(scheduleRefresh);
chrome.bookmarks.onRemoved.addListener(scheduleRefresh);
chrome.bookmarks.onChanged.addListener(scheduleRefresh);
chrome.bookmarks.onMoved.addListener(scheduleRefresh);
chrome.bookmarks.onChildrenReordered.addListener(scheduleRefresh);

// ============================================================
// Hash routing
// ============================================================

function handleHash() {
  const hash = location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const f = params.get('f');
  const b = params.get('b');
  if (b && nodeMap.has(b)) {
    revealBookmarkId = b;
    const parent = parentMap.get(b);
    if (parent) selectFolder(parent, { fromHash: true });
  } else if (f && nodeMap.has(f)) {
    selectFolder(f, { fromHash: true });
  }
}

// ============================================================
// Top-level wiring
// ============================================================

$search.addEventListener('input', renderContent);
$scopeAll.addEventListener('change', renderContent);
window.addEventListener('hashchange', handleHash);

document.addEventListener('keydown', (e) => {
  if ($modalRoot.children.length > 0) return;
  if (e.key === '/' && document.activeElement !== $search) {
    e.preventDefault();
    $search.focus(); $search.select();
  } else if (e.key === 'Escape' && document.activeElement === $search && $search.value) {
    $search.value = ''; renderContent();
  }
});

chrome.bookmarks.getTree().then(tree => {
  rootNodes = tree[0]?.children || [];
  indexTree(rootNodes);
  for (const n of rootNodes) expanded.add(n.id);
  renderTree();
  if (location.hash) {
    handleHash();
  } else if (rootNodes[0]) {
    selectFolder(rootNodes[0].id, { fromHash: true });
    history.replaceState(null, '', location.pathname);
  }
});
