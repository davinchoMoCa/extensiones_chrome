const $q = document.getElementById('q');
const $results = document.getElementById('results');

let bookmarks = [];
let filtered = [];
let selectedIndex = 0;

function flattenBookmarks(nodes, path = [], parentId = null) {
  const out = [];
  for (const node of nodes) {
    if (node.url) {
      out.push({
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
      out.push(...flattenBookmarks(node.children, newPath, node.id));
    }
  }
  return out;
}

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
    if (ranges[i][0] <= last[1]) {
      last[1] = Math.max(last[1], ranges[i][1]);
    } else {
      merged.push(ranges[i].slice());
    }
  }
  let html = '';
  let pos = 0;
  for (const [a, b] of merged) {
    html += escapeHtml(text.slice(pos, a));
    html += '<mark>' + escapeHtml(text.slice(a, b)) + '</mark>';
    pos = b;
  }
  html += escapeHtml(text.slice(pos));
  return html;
}

function search(query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return [...bookmarks]
      .sort((a, b) => b.dateAdded - a.dateAdded)
      .slice(0, 20);
  }

  const results = [];
  for (const b of bookmarks) {
    const titleL = b.title.toLowerCase();
    const urlL = b.url.toLowerCase();
    const pathL = b.folderPath.toLowerCase();

    let score = 0;
    let allMatch = true;

    for (const t of tokens) {
      const inTitle = titleL.indexOf(t);
      const inPath = pathL.indexOf(t);
      const inUrl = urlL.indexOf(t);

      if (inTitle === -1 && inPath === -1 && inUrl === -1) {
        allMatch = false;
        break;
      }

      if (inTitle !== -1) {
        score += 30;
        if (inTitle === 0) score += 80;
        else if (/[\s\W_]/.test(titleL[inTitle - 1])) score += 30;
      } else if (inPath !== -1) {
        score += 15;
      } else if (inUrl !== -1) {
        score += 8;
      }
    }

    if (!allMatch) continue;
    score -= titleL.length * 0.05;
    results.push({ b, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 30).map(r => r.b);
}

function faviconUrl(pageUrl) {
  try {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '16');
    return url.toString();
  } catch {
    return '';
  }
}

function render() {
  const tokens = $q.value.toLowerCase().split(/\s+/).filter(Boolean);

  if (!filtered.length) {
    $results.innerHTML = '<div class="empty">Sin resultados</div>';
    return;
  }

  $results.innerHTML = filtered.map((b, i) => `
    <div class="result${i === selectedIndex ? ' selected' : ''}" data-index="${i}">
      <img class="favicon" src="${escapeHtml(faviconUrl(b.url))}" alt="">
      <div class="info">
        <div class="title">${highlight(b.title, tokens)}</div>
        <div class="meta">
          ${b.folderPath ? `<span class="path" data-parent-id="${escapeHtml(b.parentId || '')}" data-bm-id="${escapeHtml(b.id)}" title="Ir a esta carpeta">${highlight(b.folderPath, tokens)}</span>` : ''}
          ${highlight(b.url, tokens)}
        </div>
      </div>
    </div>
  `).join('');

  $results.querySelectorAll('.result').forEach(el => {
    const idx = parseInt(el.dataset.index, 10);
    el.addEventListener('click', (e) => {
      if (e.target.closest('.path')) return;
      openBookmark(filtered[idx], e.metaKey || e.ctrlKey);
    });
    el.addEventListener('mousemove', () => {
      if (selectedIndex !== idx) {
        selectedIndex = idx;
        updateSelectionClasses();
      }
    });
  });

  $results.querySelectorAll('.path[data-parent-id]').forEach(span => {
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = span.dataset.parentId;
      const bid = span.dataset.bmId;
      if (!pid) return;
      const hash = bid ? `#b=${bid}` : `#f=${pid}`;
      chrome.tabs.create({ url: chrome.runtime.getURL('manager.html' + hash) });
      window.close();
    });
  });

  $results.querySelectorAll('.favicon').forEach(img => {
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  });

  scrollSelectedIntoView();
}

function updateSelectionClasses() {
  $results.querySelectorAll('.result').forEach(el => {
    const idx = parseInt(el.dataset.index, 10);
    el.classList.toggle('selected', idx === selectedIndex);
  });
}

function scrollSelectedIntoView() {
  const sel = $results.querySelector('.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function openBookmark(b, newTab = false) {
  if (!b) return;
  if (newTab) {
    chrome.tabs.create({ url: b.url, active: false });
  } else {
    chrome.tabs.update({ url: b.url });
    window.close();
  }
}

$q.addEventListener('input', () => {
  filtered = search($q.value);
  selectedIndex = 0;
  render();
});

$q.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filtered.length) {
      selectedIndex = (selectedIndex + 1) % filtered.length;
      updateSelectionClasses();
      scrollSelectedIntoView();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filtered.length) {
      selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
      updateSelectionClasses();
      scrollSelectedIntoView();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    openBookmark(filtered[selectedIndex], e.metaKey || e.ctrlKey);
  } else if (e.key === 'Escape') {
    window.close();
  }
});

document.getElementById('open-manager').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
  window.close();
});

chrome.bookmarks.getTree().then(tree => {
  bookmarks = flattenBookmarks(tree);
  filtered = search('');
  render();
});
