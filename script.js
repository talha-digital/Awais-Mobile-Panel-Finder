/* ==========================================================
   Awais Mobile Hub V2.1 — script.js
   IndexedDB Permanent Storage. Fully Offline.
   ========================================================== */
'use strict';

/* ──────────────────────────────────────────────────────────
   INDEXED_DB WRAPPER (Replaces LocalStorage)
   ────────────────────────────────────────────────────────── */
const IDB = {
    db: null,
    init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('AwaisMobileHubDB', 1);
            req.onupgradeneeded = e => {
                if (!e.target.result.objectStoreNames.contains('store')) {
                    e.target.result.createObjectStore('store');
                }
            };
            req.onsuccess = e => { this.db = e.target.result; resolve(); };
            req.onerror = e => reject(e);
        });
    },
    async get(key, fallback) {
        return new Promise(resolve => {
            const tx = this.db.transaction('store', 'readonly');
            const req = tx.objectStore('store').get(key);
            req.onsuccess = () => resolve(req.result !== undefined ? req.result : fallback);
            req.onerror = () => resolve(fallback);
        });
    },
    async set(key, val) {
        return new Promise(resolve => {
            const tx = this.db.transaction('store', 'readwrite');
            tx.objectStore('store').put(val, key);
            tx.oncomplete = () => resolve();
        });
    },
    async clear() {
        return new Promise(resolve => {
            const tx = this.db.transaction('store', 'readwrite');
            tx.objectStore('store').clear();
            tx.oncomplete = () => resolve();
        });
    },
    async getAll() {
        return new Promise(resolve => {
            const tx = this.db.transaction('store', 'readonly');
            const req = tx.objectStore('store').getAllKeys();
            req.onsuccess = async () => {
                const keys = req.result;
                const data = {};
                for (const k of keys) {
                    data[k] = await this.get(k);
                }
                resolve(data);
            };
        });
    }
};

/* ──────────────────────────────────────────────────────────
   CONSTANTS & CONFIG
   ────────────────────────────────────────────────────────── */
const LS = {
    PANELS: 'pfp2_panels',
    LISTS: 'pfp2_lists',
    TRASH: 'pfp2_trash',
    FAVS: 'pfp2_favs',
    SRCH_HIST: 'pfp2_srch_hist',
    IMP_HIST: 'pfp2_imp_hist',
    SETTINGS: 'pfp2_settings',
    RECENT: 'pfp2_recent',
};

const BRAND_PATTERNS = [
    { brand: 'Samsung', pat: /samsung|galaxy|s[0-9]+|a[0-9]+\s|a[0-9]{2,}|note[0-9]|m[0-9]{2}/i },
    { brand: 'Infinix', pat: /infinix|hot\s*[0-9]|smart\s*[0-9]|note\s*[0-9]|zero|x[0-9]{3}/i },
    { brand: 'Tecno', pat: /tecno|spark|camon|pop|pova|phantom|bg[0-9]/i },
    { brand: 'Vivo', pat: /vivo|y[0-9]{2}|v[0-9]{2}|iqoo/i },
    { brand: 'Oppo', pat: /oppo|reno|cph[0-9]|a[0-9]{2}[a-z]/i },
    { brand: 'Realme', pat: /realme|narzo|c[0-9]{2}/i },
    { brand: 'Xiaomi', pat: /xiaomi|redmi|poco|mi\s|mi\b/i },
    { brand: 'iPhone', pat: /iphone|ip[0-9]|apple/i },
    { brand: 'Huawei', pat: /huawei|honor|nova|mate|p[0-9]{2}/i },
    { brand: 'Nokia', pat: /nokia/i },
    { brand: 'Itel', pat: /itel/i },
    { brand: 'OnePlus', pat: /oneplus|one plus/i },
    { brand: 'Sparx', pat: /sparx/i },
];

const SERVICE_KEYWORDS = [
    'OLED', 'AMOLED', 'Incell', 'IC', 'LED', 'Full', 'HD', 'GX',
    'Original', 'Copy', 'Service Pack', 'Crown', 'Frame', 'Nil', 'Nill',
];

const EMOJI_RE = /[\u{1F300}-\u{1FAD6}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]/gu;
const PRICE_RE = /\b(\d{3,6}(?:\/\d{3,6})*)\b/;

/* ──────────────────────────────────────────────────────────
   APP STATE & PERSISTENCE
   ────────────────────────────────────────────────────────── */
const State = {
    panels: [],   // all active panels
    lists: [],   // list metadata objects
    trash: [],   // {type:'panel'|'list', data, deletedAt}
    favIds: new Set(),
    searchHist: [],
    importHist: [],
    recentSearch: [],
    settings: { theme: 'system', username: '', password: '', secQuestion: '', secAnswer: '' },

    // UI state
    view: 'search',   // 'search' | 'lists' | 'trash'
    query: '',
    activeFilter: { brand: 'All', list: 'All' },
    searchIndex: [],         // pre-computed for fast search
};

const Store = {
    savePanels() { IDB.set(LS.PANELS, State.panels); },
    saveLists() { IDB.set(LS.LISTS, State.lists); },
    saveTrash() { IDB.set(LS.TRASH, State.trash); },
    saveFavs() { IDB.set(LS.FAVS, [...State.favIds]); },
    saveSrchHist() { IDB.set(LS.SRCH_HIST, State.searchHist); },
    saveImpHist() { IDB.set(LS.IMP_HIST, State.importHist); },
    saveRecent() { IDB.set(LS.RECENT, State.recentSearch); },
    saveSettings() { IDB.set(LS.SETTINGS, State.settings); },

    async loadAll() {
        State.panels = await IDB.get(LS.PANELS, []);
        State.lists = await IDB.get(LS.LISTS, []);
        State.trash = await IDB.get(LS.TRASH, []);
        State.favIds = new Set(await IDB.get(LS.FAVS, []));
        State.searchHist = await IDB.get(LS.SRCH_HIST, []);
        State.importHist = await IDB.get(LS.IMP_HIST, []);
        State.recentSearch = await IDB.get(LS.RECENT, []);
        const savedSets = await IDB.get(LS.SETTINGS, {});
        State.settings = { ...State.settings, ...savedSets };
    },
};

/* ──────────────────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────────────────── */
function norm(str = '') { return String(str).toLowerCase().replace(/[\s\-().\[\]_*~`]+/g, ''); }
function esc(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }); }
function fmtDateTime(iso) { return `${fmtDate(iso)} ${fmtTime(iso)}`; }
function $(id) { return document.getElementById(id); }
function $q(sel) { return document.querySelector(sel); }
function $qa(sel) { return document.querySelectorAll(sel); }

/* ──────────────────────────────────────────────────────────
   BRAND DETECTION & WHATSAPP PARSER
   ────────────────────────────────────────────────────────── */
function detectBrand(text, categoryHint = '') {
    const combined = `${categoryHint} ${text}`;
    for (const { brand, pat } of BRAND_PATTERNS) {
        if (pat.test(combined)) return brand;
    }
    return 'Other';
}

function parseWhatsApp(text, listId, listName, importedAt) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];
    let category = '';

    for (const rawLine of lines) {
        const line = rawLine.replace(/[*_~`]/g, '').trim();
        if (!line) continue;

        const emojis = [...line.matchAll(EMOJI_RE)].map(m => m[0]);
        const lineNoEmoji = line.replace(EMOJI_RE, '').trim();

        const priceMatch = lineNoEmoji.match(PRICE_RE);
        const priceRaw = priceMatch ? priceMatch[1] : '';

        const services = SERVICE_KEYWORDS.filter(kw =>
            new RegExp(`\\b${escRe(kw)}\\b`, 'i').test(lineNoEmoji)
        );

        const stdMatch = lineNoEmoji.match(/^([A-Za-z0-9]{2,10})\s*\(([^)]+)\)\s*(.*)/);
        if (stdMatch) {
            const [, code, namePart, rest] = stdMatch;
            const name = namePart.trim();
            const price = priceRaw || rest.trim();
            const brand = detectBrand(`${code} ${name}`, category);
            results.push(buildPanel(code.toUpperCase(), name, brand, price, emojis, services, category, rawLine, listId, listName, importedAt));
            continue;
        }

        if (priceRaw) {
            const beforePrice = lineNoEmoji.slice(0, lineNoEmoji.indexOf(priceRaw)).trim();
            let modelRaw = beforePrice;
            for (const kw of SERVICE_KEYWORDS) {
                modelRaw = modelRaw.replace(new RegExp(`\\b${escRe(kw)}\\b`, 'gi'), '');
            }
            modelRaw = modelRaw.trim();

            if (modelRaw.length >= 2) {
                const tokens = modelRaw.split(/\s+/);
                let code = '', name = '';
                if (tokens.length === 1) {
                    code = tokens[0].toUpperCase();
                    name = tokens[0];
                } else {
                    const isCode = /^[A-Za-z]{0,3}[0-9]+[A-Za-z]*$/.test(tokens[0]) && tokens[0].length <= 6;
                    if (isCode) {
                        code = tokens[0].toUpperCase();
                        name = tokens.slice(1).join(' ');
                    } else {
                        code = '';
                        name = modelRaw;
                    }
                }
                const brand = detectBrand(`${code} ${name}`, category);
                results.push(buildPanel(code || name.toUpperCase(), name, brand, priceRaw, emojis, services, category, rawLine, listId, listName, importedAt));
                continue;
            }
        }

        if (line.length > 2 && line.length < 120 && !priceRaw) {
            category = line;
        }
    }
    return results;
}

function buildPanel(code, name, brand, price, emojis, services, category, original, listId, listName, importedAt) {
    const aliases = [
        norm(code), norm(name), name.toLowerCase(),
        `${brand.toLowerCase()} ${name.toLowerCase()}`,
        norm(`${brand} ${name}`),
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    return { id: uid(), code: code.trim(), name: name.trim(), brand, price: price.trim(), badges: emojis, services, category, original: original.trim(), aliases, sourceListId: listId, sourceListName: listName, importedAt };
}

/* ──────────────────────────────────────────────────────────
   SEARCH INDEX & ENGINE
   ────────────────────────────────────────────────────────── */
function buildIndex() {
    State.searchIndex = State.panels.map(p => ({
        id: p.id,
        norm_code: norm(p.code),
        norm_name: norm(p.name),
        norm_brand: norm(p.brand),
        norm_price: norm(p.price),
        norm_svc: p.services.map(norm).join(' '),
        norm_list: norm(p.sourceListName || ''),
        aliases: p.aliases,
        fullText: norm(`${p.code} ${p.name} ${p.brand} ${p.price} ${p.services.join(' ')} ${(p.aliases || []).join(' ')}`),
    }));
}

function scorePanel(idx, normQ, terms) {
    let score = 0;
    if (idx.norm_code === normQ) return 1000;
    if (idx.norm_name === normQ) score += 900;
    if (idx.aliases.some(a => norm(a) === normQ)) score += 800;
    if (idx.norm_code.startsWith(normQ)) score += 700;
    if (idx.norm_name.startsWith(normQ)) score += 600;
    if (idx.norm_name.includes(normQ)) score += 400;
    if (idx.aliases.some(a => norm(a).includes(normQ))) score += 300;
    if (idx.norm_brand.includes(normQ)) score += 200;
    if (idx.norm_price.includes(normQ)) score += 150;
    if (idx.norm_svc.includes(normQ)) score += 120;
    if (idx.norm_list.includes(normQ)) score += 80;
    if (terms.length > 1 && terms.every(t => idx.fullText.includes(t))) score += 250;
    if (score === 0 && idx.fullText.includes(normQ)) score += 50;
    return score;
}

function runSearch(rawQuery) {
    const query = rawQuery.trim();
    State.query = query;
    let pool = State.panels;

    if (State.activeFilter.brand !== 'All') pool = pool.filter(p => p.brand === State.activeFilter.brand);
    if (State.activeFilter.list !== 'All') pool = pool.filter(p => p.sourceListId === State.activeFilter.list);

    if (!query) return pool;

    const normQ = norm(query);
    const terms = normQ.length > 0 ? [normQ] : [];
    const indexMap = {};
    State.searchIndex.forEach(idx => { indexMap[idx.id] = idx; });

    const scored = [];
    for (const p of pool) {
        const idx = indexMap[p.id];
        if (!idx) continue;
        const s = scorePanel(idx, normQ, terms);
        if (s > 0) scored.push({ p, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.map(x => x.p);
}

function hl(text, query) {
    if (!query || !text) return esc(text || '');
    const terms = query.trim().split(/\s+/).filter(Boolean);
    let out = esc(String(text));
    terms.forEach(t => {
        const re = new RegExp(escRe(esc(t)), 'gi');
        out = out.replace(re, m => `<mark>${m}</mark>`);
    });
    return out;
}

function findDuplicates(incoming) {
    const results = [];
    incoming.forEach(np => {
        const existing = State.panels.find(ep => norm(ep.code) === norm(np.code) || norm(ep.name) === norm(np.name));
        if (existing) results.push({ incoming: np, existing });
    });
    return results;
}

/* ──────────────────────────────────────────────────────────
   RENDER — CARDS
   ────────────────────────────────────────────────────────── */
const SVC_CLASS = { oled: 'svc-oled', amoled: 'svc-amoled', incell: 'svc-incell', ic: 'svc-incell', full: 'svc-full', hd: 'svc-hd', gx: 'svc-gx', led: 'svc-led', 'service pack': 'svc-sp', crown: 'svc-crown', original: 'svc-orig', frame: 'svc-frame' };

function svcBadge(kw) { return `<span class="svc-badge ${SVC_CLASS[kw.toLowerCase()] || ''}">${esc(kw)}</span>`; }

function renderCard(panel, query) {
    const isFav = State.favIds.has(panel.id);
    return `<div class="panel-card${isFav ? ' fav' : ''}" data-id="${panel.id}">
    <div class="card-top">
      <div class="card-main">
        <div class="card-code">${hl(panel.code, query)}</div>
        <div class="card-name">${hl(panel.name, query)}</div>
      </div>
      <div class="card-btns">
        <button class="cb fav-btn${isFav ? ' on' : ''}" data-action="fav" title="Favorite">⭐</button>
        <button class="cb copy-btn" data-action="copy" title="Copy">📋</button>
        <button class="cb edit-btn" data-action="edit" title="Edit">✏️</button>
        <button class="cb del-btn"  data-action="del"  title="Delete">🗑</button>
      </div>
    </div>
    <div class="card-meta">
      <span class="brand-tag">${esc(panel.brand)}</span>
      ${panel.services.map(svcBadge).join('')}
      ${panel.badges.map(e => `<span class="emoji-badge">${e}</span>`).join('')}
    </div>
    <div class="card-price"><span class="price-label">PKR</span><span class="price-val">${esc(panel.price)}</span></div>
    <div class="card-original">${hl(panel.original, query)}</div>
    <div class="card-source">
      <span class="source-list-chip" data-list="${esc(panel.sourceListId || '')}">📂 ${esc(panel.sourceListName || 'Unknown List')}</span>
      <span class="source-date">${panel.importedAt ? fmtDateTime(panel.importedAt) : ''}</span>
    </div>
  </div>`;
}

let _renderTimer = null;
function scheduleRender() {
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(doRender, 16);
}

function doRender() {
    if (State.view !== 'search') return;
    const results = runSearch(State.query);
    const container = $('results');
    const countEl = $('resultCount');

    if (!container) return;
    countEl.textContent = State.panels.length === 0 ? '0 panels — import a list to get started' : `${results.length} of ${State.panels.length} panels`;

    if (results.length === 0) {
        container.innerHTML = State.panels.length === 0
            ? `<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-title">No panels yet</div><div class="empty-sub">Tap <strong>➕ Import</strong> to paste a WhatsApp price list.</div></div>`
            : `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No results for "${esc(State.query)}"</div><div class="empty-sub">Try a model code, phone name, brand, price, or service type.</div></div>`;
        return;
    }

    container.innerHTML = '';
    const CHUNK = 50; let i = 0;
    function renderChunk() {
        const frag = document.createDocumentFragment();
        const end = Math.min(i + CHUNK, results.length);
        for (; i < end; i++) {
            const wrap = document.createElement('div');
            wrap.innerHTML = renderCard(results[i], State.query);
            frag.appendChild(wrap.firstElementChild);
        }
        container.appendChild(frag);
        if (i < results.length) requestAnimationFrame(renderChunk);
    }
    renderChunk();
}

function handleCardAction(e) {
    const btn = e.target.closest('[data-action]');
    if (btn) {
        const card = btn.closest('.panel-card'); const id = card?.dataset.id; const action = btn.dataset.action;
        if (action === 'fav') { e.stopPropagation(); toggleFav(id, card, btn); return; }
        if (action === 'copy') { e.stopPropagation(); copyPanel(id, btn); return; }
        if (action === 'edit') { e.stopPropagation(); openEditPanel(id); return; }
        if (action === 'del') { e.stopPropagation(); deletePanel(id); return; }
    }
    const chip = e.target.closest('.source-list-chip');
    if (chip && chip.dataset.list) viewSourceList(chip.dataset.list);
}

function toggleFav(id, card, btn) {
    if (State.favIds.has(id)) {
        State.favIds.delete(id); card?.classList.remove('fav'); if (btn) { btn.classList.remove('on'); } toast('Removed from favorites');
    } else {
        State.favIds.add(id); card?.classList.add('fav'); if (btn) { btn.classList.add('on'); } toast('Added to favorites ⭐', 'success');
    }
    Store.saveFavs();
}

function copyPanel(id, btn) {
    const p = State.panels.find(p => p.id === id); if (!p) return;
    navigator.clipboard.writeText(p.original).then(() => {
        const orig = btn.textContent; btn.textContent = '✅'; toast('Copied!', 'success'); setTimeout(() => btn.textContent = orig, 1500);
    });
}

function deletePanel(id) {
    const idx = State.panels.findIndex(p => p.id === id); if (idx === -1) return;
    const [panel] = State.panels.splice(idx, 1);
    State.trash.push({ type: 'panel', data: panel, deletedAt: new Date().toISOString() });
    buildIndex(); Store.savePanels(); Store.saveTrash();
    updateListStats(panel.sourceListId); Store.saveLists();
    scheduleRender(); buildBrandTabs(); buildListFilter();
    toast('Panel moved to trash 🗑');
}

function openEditPanel(id) {
    const p = State.panels.find(p => p.id === id); if (!p) return;
    $('editId').value = p.id; $('editCode').value = p.code; $('editName').value = p.name; $('editBrand').value = p.brand; $('editPrice').value = p.price;
    openModal('editModal');
}

function saveEditPanel() {
    const id = $('editId').value; const panel = State.panels.find(p => p.id === id); if (!panel) return;
    panel.code = $('editCode').value.trim() || panel.code; panel.name = $('editName').value.trim() || panel.name;
    panel.brand = $('editBrand').value.trim() || panel.brand; panel.price = $('editPrice').value.trim() || panel.price;
    panel.aliases = [norm(panel.code), norm(panel.name), panel.name.toLowerCase(), `${panel.brand.toLowerCase()} ${panel.name.toLowerCase()}`].filter((v, i, a) => v && a.indexOf(v) === i);
    buildIndex(); Store.savePanels(); closeModal('editModal'); scheduleRender(); buildBrandTabs(); toast('Panel updated', 'success');
}

/* ──────────────────────────────────────────────────────────
   IMPORT FLOW
   ────────────────────────────────────────────────────────── */
let _pendingImport = null;

function startImport() {
    const text = $('importText').value.trim(); const listName = $('listNameInput').value.trim();
    if (!text) { toast('Paste a price list first', 'error'); return; }
    if (!listName) { toast('Enter a list name first', 'error'); return; }

    const listId = uid(); const importedAt = new Date().toISOString();
    const parsed = parseWhatsApp(text, listId, listName, importedAt);
    if (parsed.length === 0) { toast('No panels detected — check the format', 'error'); return; }

    const duplicates = findDuplicates(parsed);
    _pendingImport = { parsed, listId, listName, importedAt, duplicates };
    if (duplicates.length > 0) showDuplicateDialog(duplicates); else commitImport('skip');
}

function commitImport(dupeAction) {
    if (!_pendingImport) return;
    const { parsed, listId, listName, importedAt, duplicates } = _pendingImport;
    let added = 0, updated = 0, kept = 0; const toAdd = [];

    for (const np of parsed) {
        const isDupe = duplicates.find(d => norm(d.incoming.code) === norm(np.code) || norm(d.incoming.name) === norm(np.name));
        if (isDupe) {
            if (dupeAction === 'replace') {
                const ei = State.panels.findIndex(p => norm(p.code) === norm(np.code) || norm(p.name) === norm(np.name));
                if (ei !== -1) { State.panels[ei] = { ...np, id: State.panels[ei].id }; updated++; } else { toAdd.push(np); added++; }
            } else if (dupeAction === 'keep') { toAdd.push({ ...np, id: uid() }); kept++; }
        } else { toAdd.push(np); added++; }
    }
    State.panels.push(...toAdd); buildIndex(); Store.savePanels();

    const listMeta = { id: listId, name: listName, importedAt, panelCount: State.panels.filter(p => p.sourceListId === listId).length, brands: [...new Set(State.panels.filter(p => p.sourceListId === listId).map(p => p.brand))], status: 'active' };
    State.lists.push(listMeta); Store.saveLists();

    State.importHist.unshift({ listId, listName, importedAt, added, updated, kept });
    State.importHist = State.importHist.slice(0, 200); Store.saveImpHist();

    closeModal('importModal'); closeModal('dupeModal');
    $('importText').value = ''; $('listNameInput').value = ''; $('importPreview').textContent = ''; _pendingImport = null;
    buildBrandTabs(); buildListFilter(); scheduleRender();
    const msg = [added ? `${added} added` : '', updated ? `${updated} replaced` : '', kept ? `${kept} duplicated` : ''].filter(Boolean).join(', ');
    toast(`✅ Imported: ${msg}`, 'success');
}

function showDuplicateDialog(dupes) {
    $('dupeList').innerHTML = dupes.slice(0, 5).map(d => `<div class="dupe-row"><strong>${esc(d.incoming.code)}</strong> ${esc(d.incoming.name)} already exists</div>`).join('') + (dupes.length > 5 ? `<div class="dupe-row text-muted">…and ${dupes.length - 5} more</div>` : '');
    $('dupeCount').textContent = `${dupes.length} duplicate${dupes.length > 1 ? 's' : ''} found`; openModal('dupeModal');
}

/* ──────────────────────────────────────────────────────────
   LISTS MANAGER
   ────────────────────────────────────────────────────────── */
function updateListStats(listId) {
    const list = State.lists.find(l => l.id === listId); if (!list) return;
    const lp = State.panels.filter(p => p.sourceListId === listId);
    list.panelCount = lp.length; list.brands = [...new Set(lp.map(p => p.brand))];
}

function renderListsView() {
    const container = $('listsContent'); if (!container) return;
    if (State.lists.length === 0) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No lists imported yet</div><div class="empty-sub">Import your first WhatsApp price list using the ➕ button.</div></div>`; return; }
    container.innerHTML = State.lists.map(list => `
    <div class="list-card" data-list-id="${list.id}">
      <div class="list-card-header">
        <div class="list-card-name">${esc(list.name)}</div>
        <div class="list-status ${list.status === 'active' ? 'status-active' : 'status-inactive'}">${list.status || 'active'}</div>
      </div>
      <div class="list-stats">
        <div class="stat-item"><span class="stat-val">${list.panelCount || 0}</span><span class="stat-lbl">Panels</span></div>
        <div class="stat-item"><span class="stat-val">${(list.brands || []).length}</span><span class="stat-lbl">Brands</span></div>
        <div class="stat-item"><span class="stat-val">${fmtDate(list.importedAt)}</span><span class="stat-lbl">Imported</span></div>
      </div>
      ${list.brands && list.brands.length ? `<div class="list-brands">${list.brands.map(b => `<span class="mini-brand">${esc(b)}</span>`).join('')}</div>` : ''}
      <div class="list-actions">
        <button class="lb-btn" data-list-action="view" data-lid="${list.id}">👁 View</button>
        <button class="lb-btn" data-list-action="replace" data-lid="${list.id}">🔄 Replace</button>
        <button class="lb-btn btn-danger-sm" data-list-action="delete" data-lid="${list.id}">🗑 Delete</button>
      </div>
    </div>
  `).join('');
    $qa('[data-list-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const lid = btn.dataset.lid; const act = btn.dataset.listAction;
            if (act === 'view') viewSourceList(lid); if (act === 'replace') openReplaceList(lid); if (act === 'delete') deleteList(lid);
        });
    });
}

function viewSourceList(listId) {
    State.activeFilter.list = listId; State.activeFilter.brand = 'All'; switchView('search'); buildListFilter();
    const lf = $('listFilter'); if (lf) lf.value = listId; scheduleRender(); closeModal('settingsModal');
}

function openReplaceList(listId) {
    $('replaceListId').value = listId; const list = State.lists.find(l => l.id === listId);
    $('replaceListName').textContent = list?.name || ''; $('replaceText').value = ''; openModal('replaceModal');
}

function commitReplaceList() {
    const listId = $('replaceListId').value; const text = $('replaceText').value.trim();
    if (!text) { toast('Paste new list content first', 'error'); return; }
    const list = State.lists.find(l => l.id === listId); if (!list) return;

    const importedAt = new Date().toISOString(); const parsed = parseWhatsApp(text, listId, list.name, importedAt);
    const oldPanels = State.panels.filter(p => p.sourceListId === listId);
    oldPanels.forEach(p => { State.trash.push({ type: 'panel', data: p, deletedAt: importedAt, reason: 'list_replaced' }); });
    State.panels = State.panels.filter(p => p.sourceListId !== listId);

    const favCodes = new Set([...State.favIds].map(fid => { const op = oldPanels.find(p => p.id === fid); return op ? norm(op.code) : ''; }).filter(Boolean));
    parsed.forEach(np => {
        if (favCodes.has(norm(np.code))) { const oldFavPanel = oldPanels.find(p => norm(p.code) === norm(np.code) && State.favIds.has(p.id)); if (oldFavPanel) { np.id = oldFavPanel.id; } }
        State.panels.push(np);
    });

    list.importedAt = importedAt; updateListStats(listId);
    buildIndex(); Store.savePanels(); Store.saveLists(); Store.saveTrash();
    closeModal('replaceModal'); renderListsView(); buildBrandTabs(); buildListFilter(); scheduleRender();
    toast(`✅ List replaced with ${parsed.length} panels`, 'success');
}

function deleteList(listId) {
    if (!confirm('Delete this entire list and all its panels? They will be moved to Trash.')) return;
    const list = State.lists.find(l => l.id === listId); if (!list) return;
    const listPanels = State.panels.filter(p => p.sourceListId === listId);
    listPanels.forEach(p => State.trash.push({ type: 'panel', data: p, deletedAt: new Date().toISOString(), reason: 'list_deleted' }));
    State.trash.push({ type: 'list', data: list, deletedAt: new Date().toISOString() });
    State.panels = State.panels.filter(p => p.sourceListId !== listId); State.lists = State.lists.filter(l => l.id !== listId);
    buildIndex(); Store.savePanels(); Store.saveLists(); Store.saveTrash(); renderListsView(); buildBrandTabs(); buildListFilter(); scheduleRender();
    toast(`🗑 List and ${listPanels.length} panels moved to Trash`);
}

/* ──────────────────────────────────────────────────────────
   TRASH BIN
   ────────────────────────────────────────────────────────── */
function renderTrashView() {
    const container = $('trashContent'); if (!container) return;
    if (State.trash.length === 0) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">🗑</div><div class="empty-title">Trash is empty</div></div>`; return; }
    container.innerHTML = `<div class="trash-actions-bar"><button class="btn btn-danger-sm" id="emptyTrashBtn">🗑 Empty Trash</button></div>` + State.trash.slice().reverse().map((item, ri) => {
        const i = State.trash.length - 1 - ri;
        if (item.type === 'panel') { const p = item.data; return `<div class="trash-card"><div class="trash-info"><strong>${esc(p.code)}</strong> ${esc(p.name)}<span class="trash-brand">${esc(p.brand)}</span><span class="trash-price">PKR ${esc(p.price)}</span></div><div class="trash-meta">Deleted ${fmtDateTime(item.deletedAt)} · from ${esc(p.sourceListName || '')}</div><div class="trash-btns"><button class="tb-btn" data-trash-action="restore" data-ti="${i}">♻️ Restore</button><button class="tb-btn tb-danger" data-trash-action="perm" data-ti="${i}">❌ Delete</button></div></div>`; }
        if (item.type === 'list') { const l = item.data; return `<div class="trash-card"><div class="trash-info"><strong>📋 List:</strong> ${esc(l.name)}</div><div class="trash-meta">Deleted ${fmtDateTime(item.deletedAt)}</div><div class="trash-btns"><button class="tb-btn tb-danger" data-trash-action="perm" data-ti="${i}">❌ Delete Permanently</button></div></div>`; } return '';
    }).join('');
    $qa('[data-trash-action]').forEach(btn => { btn.addEventListener('click', () => { const ti = Number(btn.dataset.ti); const act = btn.dataset.trashAction; if (act === 'restore') restoreFromTrash(ti); if (act === 'perm') permDeleteFromTrash(ti); }); });
    $('emptyTrashBtn')?.addEventListener('click', emptyTrash);
}
function restoreFromTrash(idx) {
    const item = State.trash[idx]; if (!item) return;
    if (item.type === 'panel') { State.panels.push(item.data); buildIndex(); Store.savePanels(); buildBrandTabs(); buildListFilter(); scheduleRender(); toast('Panel restored ♻️', 'success'); }
    State.trash.splice(idx, 1); Store.saveTrash(); renderTrashView();
}
function permDeleteFromTrash(idx) { State.trash.splice(idx, 1); Store.saveTrash(); renderTrashView(); toast('Permanently deleted'); }
function emptyTrash() { if (!confirm('Permanently delete all items in Trash? This cannot be undone.')) return; State.trash = []; Store.saveTrash(); renderTrashView(); toast('Trash emptied'); }

/* ──────────────────────────────────────────────────────────
   UI & NAVIGATION HELPERS
   ────────────────────────────────────────────────────────── */
function buildBrandTabs() {
    const brands = ['All', ...new Set(State.panels.map(p => p.brand))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b));
    const el = $('brandTabs'); if (!el) return;
    el.innerHTML = brands.map(b => `<button class="brand-tab${b === State.activeFilter.brand ? ' active' : ''}" data-brand="${esc(b)}">${esc(b)}</button>`).join('');
    el.querySelectorAll('.brand-tab').forEach(btn => { btn.addEventListener('click', () => { State.activeFilter.brand = btn.dataset.brand; el.querySelectorAll('.brand-tab').forEach(t => t.classList.remove('active')); btn.classList.add('active'); scheduleRender(); }); });
}

function buildListFilter() {
    const el = $('listFilter'); if (!el) return;
    const cur = State.activeFilter.list;
    el.innerHTML = `<option value="All">All Lists</option>` + State.lists.map(l => `<option value="${esc(l.id)}"${l.id === cur ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
    el.onchange = () => { State.activeFilter.list = el.value; scheduleRender(); };
}

function addSearchHistory(q) {
    if (!q || q.length < 2) return;
    State.searchHist = [{ q, t: new Date().toISOString() }, ...State.searchHist.filter(h => h.q !== q)].slice(0, 100);
    State.recentSearch = [...new Set([q, ...State.recentSearch])].slice(0, 20);
    Store.saveSrchHist(); Store.saveRecent(); renderRecentChips();
}

function renderRecentChips() {
    const wrap = $('recentSearches'), sec = $('recentSection'); if (!wrap || !sec) return;
    if (State.recentSearch.length === 0) { sec.style.display = 'none'; return; } sec.style.display = 'block';
    wrap.innerHTML = State.recentSearch.slice(0, 12).map(q => `<span class="recent-chip">${esc(q)}</span>`).join('');
    wrap.querySelectorAll('.recent-chip').forEach((chip, i) => { chip.addEventListener('click', () => { const q = State.recentSearch[i]; $('searchInput').value = q; triggerSearch(q); }); });
}

function renderHistoryModal() {
    const body = $('histBody'); if (!body) return;
    if (State.searchHist.length === 0) { body.innerHTML = '<div class="empty-state"><div class="empty-icon">🕐</div><div class="empty-title">No search history</div></div>'; return; }
    body.innerHTML = State.searchHist.map((h, i) => `<div class="list-item"><div class="list-item-text" data-hi="${i}">${esc(h.q)}</div><span class="list-item-time">${fmtDateTime(h.t)}</span></div>`).join('');
    body.querySelectorAll('[data-hi]').forEach(el => { el.addEventListener('click', () => { const q = State.searchHist[Number(el.dataset.hi)].q; closeModal('histModal'); $('searchInput').value = q; triggerSearch(q); }); });
}

function renderImportHistModal() {
    const body = $('impHistBody'); if (!body) return;
    let list = [...State.importHist];
    const q = $('impSearch')?.value.toLowerCase().trim() || '';
    if (q) list = list.filter(h => h.listName.toLowerCase().includes(q));
    const sort = $('impSort')?.value || 'new';
    if (sort === 'old') list.reverse();

    if (list.length === 0) { body.innerHTML = '<div class="empty-state"><div class="empty-icon">📥</div><div class="empty-title">No import history yet</div></div>'; return; }
    body.innerHTML = list.map(h => `
    <div class="list-item">
      <div>
        <div class="list-item-text">${esc(h.listName)}</div>
        <div class="list-item-time">${fmtDateTime(h.importedAt)} · Added ${h.added || 0}, Updated ${h.updated || 0}</div>
      </div>
      <button class="list-item-del" data-idel="${h.listId}" title="Delete Record">✕</button>
    </div>`).join('');

    body.querySelectorAll('[data-idel]').forEach(btn => {
        btn.addEventListener('click', () => {
            State.importHist = State.importHist.filter(x => x.listId !== btn.dataset.idel);
            Store.saveImpHist(); renderImportHistModal();
        });
    });
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'system' ? (window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light') : theme;
    State.settings.theme = theme; Store.saveSettings();
    if ($('setTheme')) $('setTheme').value = theme;
}

function switchView(view) {
    State.view = view;
    ['search', 'lists', 'trash'].forEach(v => { const el = $(v + 'View'); if (el) el.style.display = v === view ? 'block' : 'none'; });
    $qa('.nav-btn').forEach(btn => { btn.classList.toggle('active', btn.dataset.view === view); });
    if (view === 'lists') renderListsView(); if (view === 'trash') renderTrashView();
}

function renderFavoritesModal() {
    const body = $('favBody'); if (!body) return;
    const favPanels = State.panels.filter(p => State.favIds.has(p.id));
    if (favPanels.length === 0) { body.innerHTML = '<div class="empty-state"><div class="empty-icon">⭐</div><div class="empty-title">No favorites yet</div><div class="empty-sub">Tap ☆ on any card to save it here.</div></div>'; return; }
    body.innerHTML = favPanels.map(p => `<div class="list-item"><div class="list-item-text" data-fv="${p.id}"><strong>${esc(p.code)}</strong> ${esc(p.name)} · PKR ${esc(p.price)}</div><button class="list-item-del" data-fdel="${p.id}">✕</button></div>`).join('');
    body.querySelectorAll('[data-fv]').forEach(el => { el.addEventListener('click', () => { closeModal('favModal'); $('searchInput').value = el.querySelector('strong').textContent; triggerSearch(el.querySelector('strong').textContent); }); });
    body.querySelectorAll('[data-fdel]').forEach(el => { el.addEventListener('click', () => { State.favIds.delete(el.dataset.fdel); Store.saveFavs(); renderFavoritesModal(); const card = document.querySelector(`.panel-card[data-id="${el.dataset.fdel}"]`); if (card) { card.classList.remove('fav'); const fb = card.querySelector('.fav-btn'); if (fb) { fb.classList.remove('on'); } } }); });
}

/* ──────────────────────────────────────────────────────────
   MODAL HELPERS
   ────────────────────────────────────────────────────────── */
function openModal(id) { $(id)?.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id)?.classList.remove('open'); document.body.style.overflow = ''; }

/* ──────────────────────────────────────────────────────────
   SETTINGS, SECURITY & BACKUP Logic
   ────────────────────────────────────────────────────────── */
function openSettings() {
    $('setUsername').value = State.settings.username || '';
    $('setTheme').value = State.settings.theme || 'system';
    if (State.settings.password) {
        $('setPassBtn').style.display = 'none'; $('removePassBtn').style.display = 'block';
    } else {
        $('setPassBtn').style.display = 'block'; $('removePassBtn').style.display = 'none';
    }
    openModal('settingsModal');
}

function exportDataBackup() {
    IDB.getAll().then(data => {
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `AwaisMobileHub_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click(); URL.revokeObjectURL(url);
        toast('Backup Exported', 'success');
    });
}

function restoreDataBackup(file) {
    if (!confirm('This will OVERWRITE your current database entirely. Continue?')) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            await IDB.clear();
            for (const key in data) { await IDB.set(key, data[key]); }
            alert('Backup Restored! Application will now reload.');
            location.reload();
        } catch (err) {
            alert('Error parsing backup file. Make sure it is valid JSON.');
        }
    };
    reader.readAsText(file);
}

async function resetApplication() {
    if (State.settings.password) {
        const p = prompt('App is locked. Enter password to authorize reset:');
        if (p !== State.settings.password) { alert('Incorrect password.'); return; }
    } else {
        const c = prompt('WARNING: This action cannot be undone. Type CONFIRM to delete all data:');
        if (c !== 'CONFIRM') return;
    }
    await IDB.clear();
    alert('Application reset completely. Reloading...'); location.reload();
}

/* ──────────────────────────────────────────────────────────
   BOOTSTRAP & EVENTS
   ────────────────────────────────────────────────────────── */
let _toastTimer;
function toast(msg, type = '') { const t = $('toast'); if (!t) return; t.textContent = msg; t.className = `toast${type ? ' ' + type : ''} show`; clearTimeout(_toastTimer); _toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }

let _searchTimer;
function triggerSearch(val) { State.query = val; clearTimeout(_searchTimer); _searchTimer = setTimeout(() => { if (val.trim()) addSearchHistory(val.trim()); scheduleRender(); }, 60); }

let App_installPrompt = null;

function setupEvents() {
    const input = $('searchInput'), clearBtn = $('clearBtn');
    input?.addEventListener('input', () => { clearBtn?.classList.toggle('visible', input.value.length > 0); triggerSearch(input.value); });
    clearBtn?.addEventListener('click', () => { input.value = ''; clearBtn.classList.remove('visible'); triggerSearch(''); input.focus(); });
    document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); input?.focus(); input?.select(); } });

    $('results')?.addEventListener('click', handleCardAction);
    $qa('.nav-btn').forEach(btn => { btn.addEventListener('click', () => switchView(btn.dataset.view)); });

    // Import
    $('importBtn')?.addEventListener('click', () => openModal('importModal'));
    $('importClose')?.addEventListener('click', () => closeModal('importModal'));
    $('importCancel')?.addEventListener('click', () => closeModal('importModal'));
    $('importConfirm')?.addEventListener('click', startImport);
    $('importText')?.addEventListener('input', () => { const t = $('importText').value.trim(); if (!t) { $('importPreview').textContent = ''; return; } const tmp = parseWhatsApp(t, '_', '_', '_'); $('importPreview').innerHTML = `Detected: <strong>${tmp.length} panels</strong>`; });

    // Dupes & Replace
    $('dupeSkip')?.addEventListener('click', () => commitImport('skip')); $('dupeReplace')?.addEventListener('click', () => commitImport('replace')); $('dupeKeepBoth')?.addEventListener('click', () => commitImport('keep')); $('dupeClose')?.addEventListener('click', () => closeModal('dupeModal'));
    $('editClose')?.addEventListener('click', () => closeModal('editModal')); $('editCancel')?.addEventListener('click', () => closeModal('editModal')); $('editSave')?.addEventListener('click', saveEditPanel);
    $('replaceClose')?.addEventListener('click', () => closeModal('replaceModal')); $('replaceCancel')?.addEventListener('click', () => closeModal('replaceModal')); $('replaceConfirm')?.addEventListener('click', commitReplaceList);

    // Favs, Hist
    $('favBtn')?.addEventListener('click', () => { renderFavoritesModal(); openModal('favModal'); }); $('favClose')?.addEventListener('click', () => closeModal('favModal'));
    $('histBtn')?.addEventListener('click', () => { renderHistoryModal(); openModal('histModal'); }); $('histClose')?.addEventListener('click', () => closeModal('histModal'));
    $('clearHistBtn')?.addEventListener('click', () => { State.searchHist = []; State.recentSearch = []; Store.saveSrchHist(); Store.saveRecent(); renderHistoryModal(); renderRecentChips(); toast('History cleared'); });

    $('impHistBtn')?.addEventListener('click', () => { renderImportHistModal(); openModal('impHistModal'); }); $('impHistClose')?.addEventListener('click', () => closeModal('impHistModal'));
    $('impSearch')?.addEventListener('input', renderImportHistModal);
    $('impSort')?.addEventListener('change', renderImportHistModal);
    $('clearImpHistBtn')?.addEventListener('click', () => { if (confirm('Clear all import history records?')) { State.importHist = []; Store.saveImpHist(); renderImportHistModal(); toast('Import history cleared'); } });

    // Settings
    $('settingsBtn')?.addEventListener('click', openSettings);
    $('settingsClose')?.addEventListener('click', () => closeModal('settingsModal'));
    $('setUsername')?.addEventListener('change', e => { State.settings.username = e.target.value; Store.saveSettings(); toast('Username saved'); });
    $('setTheme')?.addEventListener('change', e => applyTheme(e.target.value));

    $('setPassBtn')?.addEventListener('click', () => { $('passSection').style.display = 'block'; });
    $('savePassBtn')?.addEventListener('click', () => {
        const pw = $('newPass').value; const sq = $('secQuestion').value; const sa = $('secAnswer').value;
        if (!pw) { toast('Password required', 'error'); return; }
        State.settings.password = pw; State.settings.secQuestion = sq; State.settings.secAnswer = sa;
        Store.saveSettings(); $('passSection').style.display = 'none'; $('setPassBtn').style.display = 'none'; $('removePassBtn').style.display = 'block'; toast('Password protected!', 'success');
    });
    $('removePassBtn')?.addEventListener('click', () => {
        const p = prompt('Enter password to remove it:');
        if (p === State.settings.password) { State.settings.password = ''; State.settings.secQuestion = ''; State.settings.secAnswer = ''; Store.saveSettings(); $('setPassBtn').style.display = 'block'; $('removePassBtn').style.display = 'none'; toast('Password removed'); } else { toast('Incorrect', 'error'); }
    });

    $('exportBtn')?.addEventListener('click', exportDataBackup);
    $('importDBBtn')?.addEventListener('click', () => $('importDBFile').click());
    $('importDBFile')?.addEventListener('change', e => { if (e.target.files.length) restoreDataBackup(e.target.files[0]); });
    $('resetAppBtn')?.addEventListener('click', resetApplication);

    // PWA Installation Handling
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

    // 1. Initial State Check on Load
    if (isStandalone) {
        if ($('installAppBtn')) $('installAppBtn').style.display = 'none';
        if ($('installUnavailableMsg')) {
            $('installUnavailableMsg').style.display = 'block';
            $('installUnavailableMsg').innerHTML = '✅ Already Installed';
        }
    }

    // 2. Capture the install prompt
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        App_installPrompt = e;
        if (!isStandalone) {
            if ($('installAppBtn')) $('installAppBtn').style.display = 'block';
            if ($('installUnavailableMsg')) $('installUnavailableMsg').style.display = 'none';
        }
    });

    // 3. Handle the Install button click
    $('installAppBtn')?.addEventListener('click', async () => {
        if (!App_installPrompt) return;
        App_installPrompt.prompt();
        const { outcome } = await App_installPrompt.userChoice;

        if (outcome === 'accepted') {
            toast('App installed successfully! ✅', 'success');
            App_installPrompt = null;
            $('installAppBtn').style.display = 'none';
            if ($('installUnavailableMsg')) {
                $('installUnavailableMsg').style.display = 'block';
                $('installUnavailableMsg').innerHTML = '✅ Application Installed Successfully';
            }
        }
    });

    // 4. Listen for native OS installation completion
    window.addEventListener('appinstalled', () => {
        App_installPrompt = null;
        if ($('installAppBtn')) $('installAppBtn').style.display = 'none';
        if ($('installUnavailableMsg')) {
            $('installUnavailableMsg').style.display = 'block';
            $('installUnavailableMsg').innerHTML = '✅ Application Installed Successfully';
        }
    });

    window.addEventListener('appinstalled', () => {
        App_installPrompt = null;
        if ($('installAppBtn')) $('installAppBtn').style.display = 'none';
        if ($('installUnavailableMsg')) {
            $('installUnavailableMsg').style.display = 'block';
            $('installUnavailableMsg').innerHTML = '✅ Awais Mobile Hub is installed and running natively.';
        }
    });

    // Modal overlay closing
    ['importModal', 'favModal', 'histModal', 'impHistModal', 'editModal', 'dupeModal', 'replaceModal', 'settingsModal'].forEach(id => { const el = $(id); if (el) el.addEventListener('click', e => { if (e.target === el) closeModal(id); }); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal('importModal'); closeModal('settingsModal'); } });
}

// Security Check
$('authSubmit')?.addEventListener('click', () => {
    if ($('authPassword').value === State.settings.password) {
        $('authScreen').style.display = 'none';
        $('app').style.display = 'flex';
        if (window.innerWidth >= 768) $('searchInput')?.focus();
    } else {
        toast('Incorrect Password', 'error');
    }
});
$('authRecoverBtn')?.addEventListener('click', () => {
    if (!State.settings.secQuestion) { alert('No security question was set.'); return; }
    const ans = prompt(`Recovery Question: ${State.settings.secQuestion}`);
    if (ans && ans.toLowerCase() === State.settings.secAnswer.toLowerCase()) {
        State.settings.password = ''; Store.saveSettings();
        alert('Password removed. You can now access the app.');
        location.reload();
    } else {
        alert('Incorrect answer.');
    }
});

async function init() {
    await IDB.init();
    await Store.loadAll();

    buildIndex();
    applyTheme(State.settings.theme);
    buildBrandTabs();
    buildListFilter();
    renderRecentChips();
    scheduleRender();
    setupEvents();

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .then(reg => {
                    console.log('Service Worker registered successfully:', reg.scope);
                    reg.update(); // Automatically check for updates
                })
                .catch(err => console.error('Service Worker registration failed:', err));
        });
    }

    if (State.settings.password) {
        $('authScreen').style.display = 'flex';
    } else {
        $('app').style.display = 'flex';
        if (window.innerWidth >= 768) $('searchInput')?.focus();
    }
}

document.addEventListener('DOMContentLoaded', init);
