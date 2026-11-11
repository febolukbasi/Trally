/* ==========================================================
   Trally — price list notepad
   Everything is saved in this browser (localStorage).
   ========================================================== */
(() => {
  "use strict";

  /* ✏️ Change this to your own name / link for the site footer */
  const MADE_BY = { name: "Trally", url: "" };

  const STORAGE_KEY = "trally.v1";
  const OLD_KEY = "tally.v1";          // data from the earlier "Tally" version is moved over
  const DATA_TAG = "TRALLY1";          // marker for list data hidden inside exported PDFs
  const $ = (id) => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const STATUS_LABEL = { planned: "Planned", bought: "Bought", maybe: "Maybe" };
  const STATUS_ORDER = ["planned", "bought", "maybe"];
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const THEME_ICON = {
    auto: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
    light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    dark: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  };
  const THEME_NAME = { auto: "Match system", light: "Light", dark: "Dark" };

  /* ---------------- State ---------------- */
  const defaultSettings = () => ({ currency: "EUR", tax: 0, shipping: 0, discount: 0, budget: 0, excludeMaybe: false });
  const defaultPdf = () => ({ summary: true, links: true, status: true, itemNotes: true, notepad: true, landscape: false });
  const newList = (name) => ({ id: uid(), name, created: Date.now(), items: [], settings: defaultSettings(), notepad: "", notepadInPdf: true });

  let state = load();
  let sort = { key: null, dir: 1 };
  let filters = { q: "", category: "", status: "" };
  let groupByCategory = false;
  let lastDeleted = null;
  let nameWasAuto = false;

  function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function load() {
    let s = null;
    try { s = JSON.parse(storageGet(STORAGE_KEY) || "null"); } catch (e) {}
    if (!s) {
      try {
        s = JSON.parse(storageGet(OLD_KEY) || "null");
        if (s) s.theme = "auto"; // the old version always stored "light"
      } catch (e) {}
    }
    if (!s || !s.lists || !Object.keys(s.lists).length) {
      const first = newList("My list");
      s = { lists: { [first.id]: first }, activeId: first.id };
    }
    // fill in fields added in newer versions
    Object.values(s.lists).forEach((l) => {
      l.settings = { ...defaultSettings(), ...(l.settings || {}) };
      if (typeof l.notepad !== "string") l.notepad = "";
      if (typeof l.notepadInPdf !== "boolean") l.notepadInPdf = true;
      l.items = Array.isArray(l.items) ? l.items : [];
    });
    if (!s.lists[s.activeId]) s.activeId = Object.keys(s.lists)[0];
    if (!["auto", "light", "dark"].includes(s.theme)) s.theme = "auto";
    s.pdf = { ...defaultPdf(), ...(s.pdf || {}) };
    if (typeof s.preparedBy !== "string") s.preparedBy = "";
    return s;
  }

  let saveTimer;
  function save() {
    const el = $("saveState");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      el.textContent = "Saved"; el.classList.remove("saving");
    } catch (e) {
      el.textContent = "Not saved";
      toast("Couldn't save in this browser (storage blocked or full). Use More → Backup.");
    }
    clearTimeout(saveTimer);
  }
  // for typing-heavy fields (notepad)
  function saveSoon() {
    $("saveState").textContent = "Saving…"; $("saveState").classList.add("saving");
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 400);
  }

  const list = () => state.lists[state.activeId];
  const settings = () => list().settings;

  /* ---------------- Formatting ---------------- */
  const fmtCache = {};
  function money(n, cur = settings().currency) {
    if (!fmtCache[cur]) {
      try { fmtCache[cur] = new Intl.NumberFormat(undefined, { style: "currency", currency: cur }); }
      catch (e) { fmtCache[cur] = { format: (v) => cur + " " + v.toFixed(2) }; }
    }
    return fmtCache[cur].format(Number.isFinite(n) ? n : 0);
  }
  function currencySymbol() {
    try {
      const parts = new Intl.NumberFormat(undefined, { style: "currency", currency: settings().currency }).formatToParts(0);
      return (parts.find((p) => p.type === "currency") || {}).value || settings().currency;
    } catch (e) { return settings().currency; }
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const round2 = (n) => Math.round(n * 100) / 100;

  // Accepts "12.50", "12,50", "1.299,99", "1,299.99", "€ 12" …
  const num = (v, d = 0) => {
    let s = String(v ?? "").trim().replace(/[^\d.,-]/g, "");
    if (!s || !/\d/.test(s)) return d;
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (lc > -1) s = /,\d{3}$/.test(s) && (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : d;
  };

  function normalizeLink(raw) {
    const v = (raw || "").trim();
    if (!v || v === "—") return "";
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v;
    try {
      const u = new URL(withProto);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
      return u.href;
    } catch (e) { return null; }
  }
  function linkLabel(href) {
    try { return new URL(href).hostname.replace(/^www\./, ""); } catch (e) { return href; }
  }

  // Guess a readable product name from a shop URL
  function nameFromUrl(href) {
    try {
      const u = new URL(href);
      const skip = /^(dp|gp|p|product|products|item|items|i|en|nl|de|fr|tr|us|uk|shop|store|buy|www|html?|index|pd|s|c|cat)$/i;
      const segs = decodeURIComponent(u.pathname).split("/").map((s) => s.replace(/\.(html?|php|aspx?)$/i, "")).filter(Boolean);
      const words = segs
        .filter((s) => !skip.test(s) && /[a-z]/i.test(s) && !/^[A-Z0-9]{8,}$/.test(s) && !/^\d+$/.test(s))
        .map((s) => s.replace(/[-_+]+/g, " ").replace(/\b\d{5,}\b/g, "").replace(/\s+/g, " ").trim())
        .filter((s) => s.length > 2 && s.includes(" "));
      const best = words.sort((a, b) => b.length - a.length)[0];
      if (!best) return "";
      const clean = best.split(" ").slice(0, 8).join(" ");
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    } catch (e) { return ""; }
  }

  /* ---------------- Calculations ---------------- */
  const lineTotal = (it) => round2(it.price * it.qty);
  const counts = (it) => !(settings().excludeMaybe && it.status === "maybe");

  function totals(items = list().items) {
    const s = settings();
    const included = items.filter(counts);
    const subtotal = round2(included.reduce((a, it) => a + lineTotal(it), 0));
    const discount = round2(subtotal * (Math.min(100, num(s.discount)) / 100));
    const afterDiscount = round2(subtotal - discount);
    const tax = round2(afterDiscount * (num(s.tax) / 100));
    const shipping = included.length ? round2(num(s.shipping)) : 0;
    const grand = round2(afterDiscount + tax + shipping);
    const units = included.reduce((a, it) => a + it.qty, 0);
    const bought = round2(included.filter((i) => i.status === "bought").reduce((a, it) => a + lineTotal(it), 0));
    return { included, subtotal, discount, tax, shipping, grand, units, bought, remaining: round2(subtotal - bought) };
  }

  /* ---------------- View helpers ---------------- */
  function visibleItems() {
    const q = filters.q.trim().toLowerCase();
    let items = list().items.filter((it) => {
      if (filters.category && (it.category || "General") !== filters.category) return false;
      if (filters.status && it.status !== filters.status) return false;
      if (q && !`${it.name} ${it.notes} ${it.link} ${it.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort.key) {
      const k = sort.key;
      const val = (it) =>
        k === "total" ? lineTotal(it) :
        k === "status" ? STATUS_ORDER.indexOf(it.status) :
        k === "category" ? (it.category || "General").toLowerCase() :
        typeof it[k] === "string" ? it[k].toLowerCase() : it[k];
      items = [...items].sort((a, b) => {
        const va = val(a), vb = val(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
      });
    }
    return items;
  }

  const categories = () =>
    [...new Set(list().items.map((i) => i.category || "General"))].sort((a, b) => a.localeCompare(b));

  function groupItems(items) {
    const map = new Map();
    items.forEach((it) => {
      const c = it.category || "General";
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(it);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  /* ---------------- Theme ---------------- */
  const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function applyTheme() {
    const t = state.theme;
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    const effective = t === "auto" ? (darkQuery && darkQuery.matches ? "dark" : "light") : t;
    $("themeBtn").innerHTML = THEME_ICON[t];
    $("themeBtn").title = `Theme: ${THEME_NAME[t]}${t === "auto" ? ` (${effective} now)` : ""} — click to change`;
    document.querySelectorAll(".theme-opt").forEach((b) => b.classList.toggle("active", b.dataset.themeOpt === t));
  }
  function setTheme(t) { state.theme = t; save(); applyTheme(); toast(`Theme: ${THEME_NAME[t]}`); }
  if (darkQuery) (darkQuery.addEventListener ? darkQuery.addEventListener("change", applyTheme) : darkQuery.addListener(applyTheme));
  $("themeBtn").addEventListener("click", () => {
    const order = ["auto", "light", "dark"];
    setTheme(order[(order.indexOf(state.theme) + 1) % 3]);
  });

  /* ---------------- Render ---------------- */
  function render(flashId) {
    applyTheme();
    renderListPicker();
    renderSettings();
    renderFilters();
    renderTable(flashId);
    renderStats();
    renderBreakdown();
    renderNotepad();
    updateLinePreview();
  }

  function renderListPicker() {
    const sel = $("listSelect");
    const lists = Object.values(state.lists).sort((a, b) => a.created - b.created);
    sel.innerHTML = lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.items.length})</option>`).join("");
    sel.value = state.activeId;
    const single = lists.length < 2;
    $("deleteListBtn").disabled = single;
    $("deleteListBtn").style.opacity = single ? .3 : "";
    document.title = `${list().name} — Trally`;
  }

  function renderSettings() {
    const s = settings();
    $("currencySelect").value = s.currency;
    $("taxInput").value = s.tax || "";
    $("shippingInput").value = s.shipping || "";
    $("discountInput").value = s.discount || "";
    $("budgetInput").value = s.budget || "";
    $("excludeMaybe").checked = !!s.excludeMaybe;
    $("preparedByInput").value = state.preparedBy || "";
    const sym = currencySymbol();
    $("curSym").textContent = sym;
    $("fPrice").style.paddingLeft = (18 + sym.length * 8) + "px";
  }

  function renderFilters() {
    const cats = categories();
    const fc = $("filterCategory");
    fc.innerHTML = `<option value="">All categories</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join("");
    if (!cats.includes(filters.category)) filters.category = "";
    fc.value = filters.category;
    $("categoryList").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
  }

  function rowHTML(it, idx) {
    const editing = $("editId").value === it.id;
    const link = it.link
      ? `<a class="link" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer" title="${esc(it.link)}">${esc(linkLabel(it.link))} ↗</a>`
      : `<span class="muted">—</span>`;
    return `
      <tr data-id="${it.id}" class="is-${it.status}${editing ? " editing" : ""}">
        <td class="col-num c-num">${idx}</td>
        <td class="c-item">
          <span class="item-name" title="${esc(it.name)}">${esc(it.name)}</span>
          ${it.notes ? `<span class="item-notes" title="${esc(it.notes)}">${esc(it.notes)}</span>` : ""}
          <span class="item-cat">${esc(it.category || "General")}</span>
        </td>
        <td class="c-cat"><span class="tag">${esc(it.category || "General")}</span></td>
        <td class="c-link">${link}</td>
        <td class="c-status"><button class="status-btn status-${it.status}" data-act="status" title="Click to change status"><span class="dot"></span>${STATUS_LABEL[it.status]}</button></td>
        <td class="num c-price" data-qty=" × ${it.qty}">${money(it.price)}</td>
        <td class="num c-qty">${it.qty}</td>
        <td class="num c-total"><strong>${money(lineTotal(it))}</strong></td>
        <td class="c-act">
          <div class="row-actions">
            <button class="icon-btn" data-act="edit" title="Edit">✎</button>
            <button class="icon-btn" data-act="dup" title="Duplicate">⧉</button>
            <button class="icon-btn" data-act="del" title="Delete">✕</button>
          </div>
        </td>
      </tr>`;
  }

  // Columns between "#" and "Total" that are currently visible (some hide on smaller screens)
  function labelSpan() {
    const ths = [...document.querySelectorAll("#sheet thead th")];
    return Math.max(1, ths.filter((th) => getComputedStyle(th).display !== "none").length - 3);
  }
  const footRow = (label, value, cls) =>
    `<tr class="${cls}"><td class="c-num"></td><td colspan="${labelSpan()}" class="f-label">${label}</td><td class="num">${value}</td><td class="c-act"></td></tr>`;

  function renderTable(flashId) {
    const items = visibleItems();
    const all = list().items;
    const body = $("sheetBody");
    $("sheet").classList.toggle("grouped", groupByCategory);
    let i = 0;

    if (groupByCategory) {
      body.innerHTML = groupItems(items).map(([cat, its]) => {
        const sub = its.filter(counts).reduce((a, it) => a + lineTotal(it), 0);
        return `<tr class="group-row"><td class="c-num"></td><td colspan="${labelSpan()}" class="g-label">${esc(cat)} · ${its.length} item${its.length === 1 ? "" : "s"}</td><td class="num">${money(sub)}</td><td class="c-act"></td></tr>` +
          its.map((it) => rowHTML(it, ++i)).join("");
      }).join("");
    } else {
      body.innerHTML = items.map((it) => rowHTML(it, ++i)).join("");
    }

    $("sortSelect").value = sort.key ? `${sort.key}:${sort.dir}` : "";
    if ($("sortSelect").selectedIndex < 0) $("sortSelect").value = "";
    document.querySelectorAll("th.sortable").forEach((th) => {
      th.classList.remove("asc", "desc");
      if (th.dataset.sort === sort.key) th.classList.add(sort.dir === 1 ? "asc" : "desc");
    });

    const t = totals();
    const s = settings();
    let foot = "";
    if (all.length) {
      if (items.length !== all.length) {
        const ft = items.filter(counts).reduce((a, it) => a + lineTotal(it), 0);
        foot += footRow(`Showing ${items.length} of ${all.length} — filtered subtotal`, money(ft), "sub");
      }
      foot += footRow(`Subtotal · ${t.units} unit${t.units === 1 ? "" : "s"}`, money(t.subtotal), "sub");
      if (t.discount) foot += footRow(`Discount (${num(s.discount)}%)`, "− " + money(t.discount), "sub");
      if (num(s.tax)) foot += footRow(`Tax / VAT (${num(s.tax)}%)`, money(t.tax), "sub");
      if (t.shipping) foot += footRow("Shipping / fees", money(t.shipping), "sub");
      foot += footRow("Grand total", money(t.grand), "grand");
    }
    $("sheetFoot").innerHTML = foot;

    const empty = $("emptyState");
    empty.style.display = items.length ? "none" : "block";
    if (!items.length && all.length) {
      empty.innerHTML = `<div class="empty-icon">⌕</div><p><strong>No matches.</strong></p><p>No items match your search or filters.</p>`;
    } else if (!all.length) {
      empty.innerHTML = `<div class="empty-icon">▦</div><p><strong>Your list is empty.</strong></p>
        <p>Add an item on the left, or <button class="linklike" data-empty="import">import a Trally PDF or CSV</button>.</p>`;
    }

    if (flashId) {
      const row = body.querySelector(`tr[data-id="${flashId}"]`);
      if (row) { row.classList.add("flash"); row.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    }
  }

  function renderStats() {
    const t = totals();
    const s = settings();
    const all = list().items;
    $("statTotal").textContent = money(t.grand);
    $("statCount").textContent = `${all.length}` + (t.units && t.units !== all.length ? ` · ${t.units} units` : "");
    const max = all.reduce((m, it) => (!m || it.price > m.price ? it : m), null);
    $("statMax").textContent = max ? money(max.price) : "—";
    $("statMaxName").textContent = max ? max.name : "";
    $("statMaxName").title = max ? max.name : "";
    $("statBought").textContent = `${money(t.bought)} / ${money(t.remaining)}`;

    const bar = $("budgetBar");
    const budget = num(s.budget);
    if (budget > 0) {
      bar.hidden = false;
      const pct = (t.grand / budget) * 100;
      $("budgetFill").style.width = Math.min(pct, 100) + "%";
      const left = budget - t.grand;
      bar.classList.toggle("over", left < 0);
      $("budgetText").textContent = left >= 0
        ? `${money(left)} left of ${money(budget)} budget (${pct.toFixed(0)}% used)`
        : `Over budget by ${money(-left)} (${pct.toFixed(0)}%)`;
    } else bar.hidden = true;
  }

  function renderBreakdown() {
    const t = totals();
    const groups = groupItems(t.included);
    if (!groups.length || t.subtotal <= 0) {
      $("breakdown").innerHTML = `<p class="breakdown-empty">Totals per category show up here once you add items.</p>`;
      return;
    }
    const rows = groups.map(([cat, its]) => [cat, its.reduce((a, it) => a + lineTotal(it), 0)]).sort((a, b) => b[1] - a[1]);
    const max = rows[0][1] || 1;
    $("breakdown").innerHTML = rows.map(([cat, v]) => `
      <div class="bd-row">
        <span class="bd-name" title="${esc(cat)}">${esc(cat)}</span>
        <div class="bd-track"><div class="bd-fill" style="width:${(v / max) * 100}%"></div></div>
        <span class="bd-val">${money(v)}</span>
        <span class="bd-pct">${((v / t.subtotal) * 100).toFixed(0)}%</span>
      </div>`).join("");
  }

  function renderNotepad() {
    if (document.activeElement !== $("notepad")) $("notepad").value = list().notepad;
    $("notepadInPdf").checked = list().notepadInPdf;
    updateNotepadCount();
  }
  function updateNotepadCount() {
    const v = $("notepad").value;
    const words = v.trim() ? v.trim().split(/\s+/).length : 0;
    $("notepadCount").textContent = `${words} word${words === 1 ? "" : "s"} · ${v.length} characters`;
  }

  function updateLinePreview() {
    const p = num($("fPrice").value);
    const q = Math.max(1, Math.round(num($("fQty").value, 1)));
    $("linePreview").textContent = money(round2(p * q));
  }

  /* ---------------- Form ---------------- */
  const form = $("itemForm");
  const fieldsToMark = () => [$("fName"), $("fPrice"), $("fLink")];

  function readForm() {
    const name = $("fName").value.trim();
    const priceRaw = $("fPrice").value.trim();
    const price = num(priceRaw, NaN);
    const qty = Math.max(1, Math.round(num($("fQty").value, 1)));
    const link = normalizeLink($("fLink").value);
    const errors = [];
    fieldsToMark().forEach((el) => el.classList.remove("invalid"));
    if (!name) { errors.push("Give the item a name."); $("fName").classList.add("invalid"); }
    if (!priceRaw || !Number.isFinite(price) || price < 0) { errors.push("Enter a valid price, e.g. 12.50 or 12,50."); $("fPrice").classList.add("invalid"); }
    if (link === null) { errors.push("That link doesn't look like a valid web address."); $("fLink").classList.add("invalid"); }
    return {
      errors,
      data: {
        name, price: round2(price), qty, link: link || "",
        category: $("fCategory").value.trim() || "General",
        status: $("fStatus").value,
        notes: $("fNotes").value.trim(),
      },
    };
  }

  function resetForm(keepCategory = true) {
    const cat = $("fCategory").value;
    form.reset();
    $("editId").value = "";
    $("fQty").value = 1;
    if (keepCategory) $("fCategory").value = cat;
    $("formTitle").textContent = "Add item";
    $("submitBtn").innerHTML = "Add to list <kbd>↵</kbd>";
    $("cancelEditBtn").hidden = true;
    $("formError").textContent = "";
    fieldsToMark().forEach((el) => el.classList.remove("invalid"));
    nameWasAuto = false;
    updateLinePreview();
  }

  function startEdit(id) {
    const it = list().items.find((i) => i.id === id);
    if (!it) return;
    $("editId").value = id;
    $("fName").value = it.name;
    $("fLink").value = it.link;
    $("fPrice").value = it.price;
    $("fQty").value = it.qty;
    $("fCategory").value = it.category;
    $("fStatus").value = it.status;
    $("fNotes").value = it.notes;
    $("formTitle").textContent = "Edit item";
    $("submitBtn").innerHTML = "Save changes <kbd>↵</kbd>";
    $("cancelEditBtn").hidden = false;
    $("formError").textContent = "";
    nameWasAuto = false;
    updateLinePreview();
    renderTable();
    $("fName").focus();
    if (window.innerWidth < 900) form.scrollIntoView({ behavior: "smooth" });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const { errors, data } = readForm();
    if (errors.length) { $("formError").textContent = errors[0]; return; }
    const editId = $("editId").value;
    let id;
    if (editId) {
      Object.assign(list().items.find((i) => i.id === editId), data);
      id = editId;
      toast("Item updated.");
    } else {
      id = uid();
      list().items.push({ id, created: Date.now(), ...data });
    }
    save();
    resetForm(true);
    render(id);
    $("fLink").focus();
  });

  $("cancelEditBtn").addEventListener("click", () => { resetForm(false); renderTable(); });
  ["fPrice", "fQty"].forEach((id) => $(id).addEventListener("input", updateLinePreview));
  document.querySelectorAll(".qty-btn").forEach((b) =>
    b.addEventListener("click", () => {
      $("fQty").value = Math.max(1, Math.round(num($("fQty").value, 1)) + Number(b.dataset.step));
      updateLinePreview();
    })
  );

  // Link → suggest name (only fills an empty name, or one we filled ourselves)
  function suggestName() {
    const n = normalizeLink($("fLink").value);
    if (!n) return;
    if ($("fName").value.trim() && !nameWasAuto) return;
    const guess = nameFromUrl(n);
    if (guess) { $("fName").value = guess; nameWasAuto = true; }
  }
  $("fLink").addEventListener("paste", () => setTimeout(suggestName, 0));
  $("fLink").addEventListener("blur", () => {
    const n = normalizeLink($("fLink").value);
    if (n) $("fLink").value = n;
    suggestName();
  });
  $("fName").addEventListener("input", () => { nameWasAuto = false; });

  /* ---------------- Table actions ---------------- */
  $("sheetBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest("tr").dataset.id;
    const items = list().items;
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const it = items[idx];
    switch (btn.dataset.act) {
      case "edit": startEdit(id); break;
      case "dup": {
        const copy = { ...it, id: uid(), created: Date.now(), name: it.name + " (copy)" };
        items.splice(idx + 1, 0, copy);
        save(); render(copy.id);
        break;
      }
      case "del":
        lastDeleted = { item: it, index: idx, listId: state.activeId };
        items.splice(idx, 1);
        if ($("editId").value === id) resetForm(false);
        save(); render();
        toast(`Deleted “${it.name}”.`, "Undo", undoDelete);
        break;
      case "status":
        it.status = STATUS_ORDER[(STATUS_ORDER.indexOf(it.status) + 1) % STATUS_ORDER.length];
        save(); render();
        break;
    }
  });
  $("sheetBody").addEventListener("dblclick", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr && !e.target.closest("button, a")) startEdit(tr.dataset.id);
  });
  $("emptyState").addEventListener("click", (e) => { if (e.target.dataset.empty === "import") $("importFile").click(); });

  function undoDelete() {
    if (!lastDeleted) return;
    const l = state.lists[lastDeleted.listId];
    if (!l) return;
    l.items.splice(lastDeleted.index, 0, lastDeleted.item);
    const id = lastDeleted.item.id;
    if (state.activeId !== lastDeleted.listId) state.activeId = lastDeleted.listId;
    lastDeleted = null;
    save(); render(id);
    toast("Item restored.");
  }

  document.querySelectorAll("th.sortable").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      const first = k === "price" || k === "total" ? -1 : 1;
      if (sort.key !== k) sort = { key: k, dir: first };
      else if (sort.dir === first) sort.dir *= -1;
      else sort = { key: null, dir: 1 };
      renderTable();
    })
  );

  /* ---------------- Toolbar ---------------- */
  $("searchInput").addEventListener("input", (e) => { filters.q = e.target.value; renderTable(); });
  $("filterCategory").addEventListener("change", (e) => { filters.category = e.target.value; renderTable(); });
  $("filterStatus").addEventListener("change", (e) => { filters.status = e.target.value; renderTable(); });
  $("sortSelect").addEventListener("change", (e) => {
    const [k, d] = e.target.value.split(":");
    sort = k ? { key: k, dir: Number(d) } : { key: null, dir: 1 };
    renderTable();
  });
  $("groupToggle").addEventListener("change", (e) => { groupByCategory = e.target.checked; renderTable(); });

  /* ---------------- Settings ---------------- */
  $("currencySelect").addEventListener("change", (e) => { settings().currency = e.target.value; save(); render(); });
  [["taxInput", "tax"], ["shippingInput", "shipping"], ["budgetInput", "budget"], ["discountInput", "discount"]].forEach(([id, key]) => {
    $(id).addEventListener("input", (e) => {
      settings()[key] = Math.max(0, num(e.target.value));
      save(); renderTable(); renderStats(); renderBreakdown();
    });
    $(id).addEventListener("blur", (e) => { const v = num(e.target.value); e.target.value = v ? v : ""; });
  });
  $("excludeMaybe").addEventListener("change", (e) => { settings().excludeMaybe = e.target.checked; save(); render(); });
  $("preparedByInput").addEventListener("input", (e) => { state.preparedBy = e.target.value; saveSoon(); });

  /* ---------------- Notepad ---------------- */
  $("notepad").addEventListener("input", (e) => { list().notepad = e.target.value; updateNotepadCount(); saveSoon(); });
  $("notepadInPdf").addEventListener("change", (e) => { list().notepadInPdf = e.target.checked; save(); });

  /* ---------------- Lists ---------------- */
  function switchList(id) {
    state.activeId = id;
    filters = { q: "", category: "", status: "" };
    $("searchInput").value = ""; $("filterStatus").value = "";
    resetForm(false); save(); render();
  }
  $("listSelect").addEventListener("change", (e) => switchList(e.target.value));
  $("newListBtn").addEventListener("click", async () => {
    const name = await modal({ title: "New list", text: "Give your list a name.", input: "", ok: "Create" });
    if (!name) return;
    const l = newList(name);
    l.settings.currency = settings().currency;
    state.lists[l.id] = l;
    switchList(l.id);
    toast(`Created “${l.name}”.`);
  });
  $("renameListBtn").addEventListener("click", async () => {
    const name = await modal({ title: "Rename list", input: list().name, ok: "Rename" });
    if (!name) return;
    list().name = name; save(); render();
  });
  $("dupListBtn").addEventListener("click", () => {
    const src = list();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid(); copy.created = Date.now(); copy.name = src.name + " (copy)";
    copy.items.forEach((it) => { it.id = uid(); });
    state.lists[copy.id] = copy;
    switchList(copy.id);
    toast(`Duplicated as “${copy.name}”.`);
  });
  $("deleteListBtn").addEventListener("click", async () => {
    if (Object.keys(state.lists).length < 2) return;
    const ok = await modal({ title: "Delete list?", text: `“${list().name}” and its ${list().items.length} item(s) will be removed. This can't be undone.`, ok: "Delete" });
    if (!ok) return;
    delete state.lists[state.activeId];
    switchList(Object.keys(state.lists)[0]);
  });

  /* ---------------- Menu ---------------- */
  const menu = $("moreMenu");
  $("moreBtn").addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("open"); });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) menu.classList.remove("open"); });
  menu.addEventListener("click", async (e) => {
    const a = e.target.closest("button")?.dataset.action;
    if (!a) return;
    menu.classList.remove("open");
    if (a === "csv") exportCSV();
    if (a === "copy") copyAsText();
    if (a === "json") exportJSON();
    if (a === "import") $("importFile").click();
    if (a.startsWith("theme-")) setTheme(a.slice(6));
    if (a === "clear") {
      if (!list().items.length) return toast("The list is already empty.");
      const ok = await modal({ title: "Clear all items?", text: `Remove all ${list().items.length} items from “${list().name}”? This can't be undone.`, ok: "Clear" });
      if (ok) { list().items = []; resetForm(false); save(); render(); }
    }
  });
  $("importBtn").addEventListener("click", () => $("importFile").click());

  /* ==========================================================
     EXPORT: PDF
     ========================================================== */
  // List data hidden in the PDF (white 2pt text) so Trally can import it back exactly
  function encodeListData(l) {
    const payload = { v: 1, name: l.name, settings: l.settings, notepad: l.notepad, notepadInPdf: l.notepadInPdf,
      items: l.items.map(({ name, link, price, qty, category, status, notes }) => ({ name, link, price, qty, category, status, notes })) };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return `${DATA_TAG}:${btoa(bin)}:END`;
  }

  function buildReport(opts = state.pdf, title = list().name) {
    const l = list();
    const s = settings();
    const items = visibleItems();
    const t = totals();
    const filtered = items.length !== l.items.length;
    const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const cols = 6 + (opts.status ? 1 : 0); // columns before "Total"
    let i = 0;

    const row = (it) => `
      <tr>
        <td class="idx">${++i}</td>
        <td><strong>${esc(it.name)}</strong>${opts.itemNotes && it.notes ? `<span class="notes">${esc(it.notes)}</span>` : ""}</td>
        <td>${esc(it.category || "General")}</td>
        <td>${it.link ? `<a class="link" href="${esc(it.link)}">${esc(opts.links ? it.link : linkLabel(it.link))}</a>` : "—"}</td>
        ${opts.status ? `<td>${STATUS_LABEL[it.status]}${!counts(it) ? " *" : ""}</td>` : ""}
        <td class="num">${money(it.price)}</td>
        <td class="num">${it.qty}</td>
        <td class="num"><strong>${money(lineTotal(it))}</strong></td>
      </tr>`;

    const rows = groupByCategory
      ? groupItems(items).map(([cat, its]) => {
          const sub = its.filter(counts).reduce((a, it) => a + lineTotal(it), 0);
          return `<tr class="rp-group"><td colspan="${cols}">${esc(cat)}</td><td class="num">${money(sub)}</td></tr>` + its.map(row).join("");
        }).join("")
      : items.map(row).join("");

    const fr = (label, val, cls = "") => `<tr class="${cls}"><td colspan="${cols}" class="num">${label}</td><td class="num">${val}</td></tr>`;
    let foot = fr("Subtotal", money(t.subtotal));
    if (t.discount) foot += fr(`Discount (${num(s.discount)}%)`, "− " + money(t.discount));
    if (num(s.tax)) foot += fr(`Tax / VAT (${num(s.tax)}%)`, money(t.tax));
    if (t.shipping) foot += fr("Shipping / fees", money(t.shipping));
    foot += fr("Grand total", money(t.grand), "grand");

    const budget = num(s.budget);
    const notes = l.notepad.trim();
    const by = (state.preparedBy || "").trim();

    $("report").innerHTML = `
      <div class="rp-head">
        <h1 class="rp-title">${esc(title)}</h1>
        <div class="rp-meta">${date}${by ? `<br>Prepared by ${esc(by)}` : ""}<br>${l.items.length} items · ${t.units} units · ${esc(s.currency)}${filtered ? " · filtered view" : ""}</div>
      </div>
      ${opts.summary ? `<div class="rp-summary">
        <div><small>Subtotal</small><b>${money(t.subtotal)}</b></div>
        <div><small>Bought</small><b>${money(t.bought)}</b></div>
        <div><small>Remaining</small><b>${money(t.remaining)}</b></div>
        ${budget ? `<div><small>Budget left</small><b>${money(budget - t.grand)}</b></div>` : ""}
        <div><small>Grand total</small><b>${money(t.grand)}</b></div>
      </div>` : ""}
      <table class="rp-table">
        <thead><tr><th>#</th><th>Item</th><th>Category</th><th>Link</th>${opts.status ? "<th>Status</th>" : ""}<th class="num">Price</th><th class="num">Qty</th><th class="num">Total</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${cols + 1}">No items.</td></tr>`}</tbody>
        <tfoot>${foot}</tfoot>
      </table>
      ${opts.notepad && notes ? `<div class="rp-notes"><h2>Notes</h2><div>${esc(notes)}</div></div>` : ""}
      <div class="rp-foot">
        <span>${s.excludeMaybe && opts.status ? "* “Maybe” items are not included in totals." : ""}</span>
      </div>
      <p class="rp-data">${encodeListData(l)}</p>`;

    $("pageStyle")?.remove();
    const st = document.createElement("style");
    st.id = "pageStyle";
    st.textContent = `@page { size: A4 ${opts.landscape ? "landscape" : "portrait"}; }`;
    document.head.appendChild(st);
  }

  function openPdfDialog() {
    if (!list().items.length) return toast("Add some items first.");
    const o = state.pdf;
    $("pdfTitle").value = list().name;
    $("optSummary").checked = o.summary;
    $("optLinks").checked = o.links;
    $("optStatus").checked = o.status;
    $("optItemNotes").checked = o.itemNotes;
    $("optNotepad").checked = list().notepadInPdf;
    $("optNotepad").disabled = !list().notepad.trim();
    $("optNotepad").closest("label").title = list().notepad.trim() ? "" : "The notepad is empty";
    $("optLandscape").checked = o.landscape;
    $("pdfModal").hidden = false;
    $("pdfGo").focus();
  }
  function closePdfDialog() { $("pdfModal").hidden = true; }
  $("pdfBtn").addEventListener("click", openPdfDialog);
  $("pdfCancel").addEventListener("click", closePdfDialog);
  $("pdfModal").addEventListener("click", (e) => { if (e.target === $("pdfModal")) closePdfDialog(); });
  $("pdfGo").addEventListener("click", () => {
    state.pdf = {
      summary: $("optSummary").checked, links: $("optLinks").checked, status: $("optStatus").checked,
      itemNotes: $("optItemNotes").checked, notepad: $("optNotepad").checked, landscape: $("optLandscape").checked,
    };
    list().notepadInPdf = $("optNotepad").checked;
    save(); renderNotepad();
    const title = $("pdfTitle").value.trim() || list().name;
    closePdfDialog();
    buildReport({ ...state.pdf, notepad: list().notepadInPdf }, title);
    printing = true;
    setTimeout(() => { window.print(); printing = false; }, 120);
  });
  let printing = false;
  // Ctrl/Cmd+P without the dialog still gives a good PDF
  window.addEventListener("beforeprint", () => { if (!printing) buildReport({ ...state.pdf, notepad: list().notepadInPdf }); });

  /* ---------------- Export: CSV / text / JSON ---------------- */
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const slug = (s) => (s || "list").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list";
  const today = () => new Date().toISOString().slice(0, 10);

  function exportCSV() {
    const items = visibleItems();
    if (!items.length) return toast("Nothing to export.");
    const s = settings(); const t = totals();
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["#", "Item", "Category", "Link", "Status", `Price (${s.currency})`, "Qty", `Total (${s.currency})`, "Notes"].map(q).join(",")];
    items.forEach((it, i) => lines.push([i + 1, it.name, it.category, it.link, STATUS_LABEL[it.status], it.price.toFixed(2), it.qty, lineTotal(it).toFixed(2), it.notes].map(q).join(",")));
    const tot = (label, v) => lines.push(["", "", "", "", "", "", label, v.toFixed(2), ""].map(q).join(","));
    lines.push("");
    tot("Subtotal", t.subtotal);
    if (t.discount) tot(`Discount ${num(s.discount)}%`, -t.discount);
    if (num(s.tax)) tot(`Tax ${num(s.tax)}%`, t.tax);
    if (t.shipping) tot("Shipping", t.shipping);
    tot("Grand total", t.grand);
    download(`${slug(list().name)}-${today()}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
    toast("CSV downloaded — opens in Excel, Numbers or Google Sheets.");
  }

  async function copyAsText() {
    const items = visibleItems();
    if (!items.length) return toast("Nothing to copy.");
    const t = totals(); const s = settings();
    const lines = [`${list().name}`, ""];
    items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.name} — ${it.qty} × ${money(it.price)} = ${money(lineTotal(it))}${it.status === "bought" ? " ✓" : ""}`);
      if (it.link) lines.push(`   ${it.link}`);
    });
    lines.push("", `Subtotal: ${money(t.subtotal)}`);
    if (t.discount) lines.push(`Discount (${num(s.discount)}%): −${money(t.discount)}`);
    if (num(s.tax)) lines.push(`Tax (${num(s.tax)}%): ${money(t.tax)}`);
    if (t.shipping) lines.push(`Shipping: ${money(t.shipping)}`);
    lines.push(`Total: ${money(t.grand)}`);
    if (list().notepad.trim()) lines.push("", "Notes:", list().notepad.trim());
    const text = lines.join("\n");
    try { await navigator.clipboard.writeText(text); toast("List copied — paste it in a chat or email."); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("List copied."); } catch (e2) { toast("Copy isn't allowed here."); }
      ta.remove();
    }
  }

  function exportJSON() {
    download(`trally-backup-${today()}.json`, JSON.stringify(state, null, 2), "application/json");
    toast("Backup downloaded (all lists).");
  }

  /* ==========================================================
     IMPORT: PDF / CSV / JSON
     ========================================================== */
  $("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) importFile(file);
  });

  async function importFile(file) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".json") || file.type === "application/json") return await importBackup(file);
      let parsed;
      if (name.endsWith(".pdf") || file.type === "application/pdf") {
        toast("Reading PDF…");
        parsed = await parsePdf(file);
      } else if (name.endsWith(".csv") || file.type.includes("csv") || name.endsWith(".txt")) {
        parsed = parseCSV(await file.text(), file.name);
      } else {
        return toast("Choose a PDF, CSV or Trally backup (.json).");
      }
      if (!parsed || !parsed.items.length) {
        return toast(parsed && parsed.reason ? parsed.reason : "No items found in that file.");
      }
      await offerImport(parsed);
    } catch (err) {
      console.error(err);
      toast(err && err.userMessage ? err.userMessage : "Couldn't read that file.");
    }
  }

  function cleanItem(it) {
    return {
      id: uid(), created: Date.now(),
      name: String(it.name || "Untitled").trim().slice(0, 300) || "Untitled",
      link: normalizeLink(it.link) || "",
      price: round2(Math.max(0, num(it.price))),
      qty: Math.max(1, Math.round(num(it.qty, 1))),
      category: String(it.category || "General").trim() || "General",
      status: STATUS_LABEL[it.status] ? it.status : statusFromText(it.status),
      notes: String(it.notes || "").trim(),
    };
  }
  function statusFromText(t) {
    const s = String(t || "").toLowerCase();
    return s.startsWith("b") ? "bought" : s.startsWith("m") ? "maybe" : "planned";
  }

  async function offerImport(p) {
    const n = p.items.length;
    const choice = await modal({
      title: `Import ${n} item${n === 1 ? "" : "s"}?`,
      text: `Found “${p.name}”${p.exact ? "" : " (read from the table — check prices after importing)"}. Where should it go?`,
      buttons: [
        { label: "Cancel", value: null, cls: "btn-ghost btn-left" },
        { label: `Add to “${list().name}”`, value: "merge" },
        { label: "New list", value: "new", cls: "btn-dark" },
      ],
    });
    if (!choice) return;
    const items = p.items.map(cleanItem);
    if (choice === "new") {
      const l = newList(p.name || "Imported list");
      l.items = items;
      if (p.settings) l.settings = { ...defaultSettings(), ...p.settings };
      else if (p.currency) l.settings.currency = p.currency;
      if (p.notepad) l.notepad = p.notepad;
      if (typeof p.notepadInPdf === "boolean") l.notepadInPdf = p.notepadInPdf;
      state.lists[l.id] = l;
      switchList(l.id);
    } else {
      list().items.push(...items);
      if (p.notepad && !list().notepad.includes(p.notepad)) list().notepad = (list().notepad ? list().notepad + "\n\n" : "") + p.notepad;
      save(); render();
    }
    toast(`Imported ${n} item${n === 1 ? "" : "s"}.`);
  }

  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return toast("That file isn't valid JSON."); }
    if (!data || !data.lists || typeof data.lists !== "object") return toast("That file isn't a Trally backup.");
    const lists = {};
    Object.values(data.lists).forEach((l) => {
      const id = l.id || uid();
      lists[id] = {
        id, name: String(l.name || "Imported list"), created: l.created || Date.now(),
        settings: { ...defaultSettings(), ...(l.settings || {}) },
        notepad: typeof l.notepad === "string" ? l.notepad : "", notepadInPdf: l.notepadInPdf !== false,
        items: (l.items || []).map(cleanItem),
      };
    });
    if (!Object.keys(lists).length) return toast("That backup has no lists.");
    const choice = await modal({
      title: "Restore backup?",
      text: `The file has ${Object.keys(lists).length} list(s). Replace everything, or add them next to your current lists?`,
      buttons: [
        { label: "Cancel", value: null, cls: "btn-ghost btn-left" },
        { label: "Add lists", value: "add" },
        { label: "Replace all", value: "replace", cls: "btn-dark" },
      ],
    });
    if (!choice) return;
    if (choice === "replace") state.lists = lists;
    else Object.values(lists).forEach((l) => { if (state.lists[l.id]) l.id = uid(); state.lists[l.id] = l; });
    state.activeId = data.lists[data.activeId] && state.lists[data.activeId] ? data.activeId : Object.keys(lists).find((k) => state.lists[k]) || Object.keys(state.lists)[0];
    if (!state.lists[state.activeId]) state.activeId = Object.keys(state.lists)[0];
    resetForm(false); save(); render();
    toast("Backup restored.");
  }

  /* ---------- CSV ---------- */
  function csvRows(text) {
    text = text.replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/)[0] || "";
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : (firstLine.includes("\t") ? "\t" : ",");
    const rows = []; let row = []; let cell = ""; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  function parseCSV(text, filename) {
    const rows = csvRows(text);
    const hi = rows.findIndex((r) => r.some((c) => /^(item|name|product|title)$/i.test(c.trim())));
    if (hi < 0) return { items: [], reason: "Couldn't find an “Item” or “Name” column in that CSV." };
    const head = rows[hi].map((c) => c.trim().toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const c = {
      name: col(/^(item|name|product|title)$/), link: col(/link|url/), price: col(/^(unit )?price/),
      qty: col(/^(qty|quantity|amount|aantal)/), category: col(/categ/), status: col(/status/), notes: col(/note/),
      total: col(/^total/),
    };
    let currency = "";
    const ph = head[c.price] || "";
    const m = ph.match(/\(([a-z]{3})\)/i); if (m) currency = m[1].toUpperCase();
    const items = rows.slice(hi + 1).map((r) => {
      const g = (k) => (c[k] >= 0 ? (r[c[k]] || "").trim() : "");
      let price = g("price");
      if (!price && g("total")) price = String(num(g("total")) / Math.max(1, num(g("qty"), 1)));
      return { name: g("name"), link: g("link"), price, qty: g("qty") || 1, category: g("category"), status: g("status"), notes: g("notes") };
    }).filter((it) => it.name && /\d/.test(String(it.price)));
    return { name: filename.replace(/\.(csv|txt)$/i, "").replace(/[-_]\d{4}-\d{2}-\d{2}$/, "").replace(/[-_]+/g, " "), items, currency };
  }

  /* ---------- PDF ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src));
      document.head.appendChild(s);
    });
  }
  let pdfjsReady = null;
  function loadPdfJs() {
    if (pdfjsReady) return pdfjsReady;
    const CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
    pdfjsReady = (async () => {
      // Loading the worker as a normal script lets PDF.js run without a separate worker,
      // which also works when you open index.html straight from your computer.
      try { await loadScript("lib/pdf.worker.min.js"); await loadScript("lib/pdf.min.js"); }
      catch (e) { await loadScript(CDN + "pdf.worker.min.js"); await loadScript(CDN + "pdf.min.js"); }
      const lib = window.pdfjsLib;
      if (!lib) throw new Error("pdfjs missing");
      return lib;
    })().catch((e) => {
      pdfjsReady = null;
      const err = new Error("pdfjs");
      err.userMessage = "Couldn't load the PDF reader. Keep the “lib” folder next to index.html, or go online.";
      throw err;
    });
    return pdfjsReady;
  }

  async function parsePdf(file) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      pages.push(tc.items.filter((i) => i.str !== undefined).map((i) => ({
        str: i.str, x: i.transform[4], y: i.transform[5], w: i.width,
        size: Math.round(Math.hypot(i.transform[0], i.transform[1]) * 10) / 10,
      })));
    }

    // 1) Exact: data hidden by Trally inside the PDF
    const all = pages.flat().map((i) => i.str).join("").replace(/\s+/g, "");
    const m = all.match(new RegExp(DATA_TAG + ":([A-Za-z0-9+/=]+):END"));
    if (m) {
      try {
        const bin = atob(m[1]);
        const json = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
        const d = JSON.parse(json);
        return { exact: true, name: d.name, items: d.items || [], settings: d.settings, notepad: d.notepad, notepadInPdf: d.notepadInPdf };
      } catch (e) { /* fall through to reading the table */ }
    }

    // 2) Best effort: read the visible table (PDFs from the earlier version)
    const res = readTableFromPdf(pages);
    if (!res.items.length) res.reason = "No Trally table found in that PDF. Only PDFs exported from Trally (or Tally) can be imported.";
    return res;
  }

  function readTableFromPdf(pages) {
    const items = [];
    let title = "", currency = "", notepad = "";
    const HEAD = ["#", "item", "category", "link", "status", "price", "qty", "total"];
    const isMoney = (s) => /\d/.test(s) && /^[^\d-]*-?[\d.,\s]+[^\d]*$/.test(s.trim());

    // join text pieces on one line, adding spaces only where there is a visual gap
    const joinLine = (arr, glue = " ") => {
      const s = [...arr].sort((a, b) => a.x - b.x);
      let out = "";
      s.forEach((it, i) => {
        if (i && glue) { const prev = s[i - 1]; if (it.x - (prev.x + prev.w) > 1.2 && !out.endsWith(" ")) out += " "; }
        out += it.str;
      });
      return out.trim();
    };
    const joinBlock = (arr, glue = " ") => {
      const lines = groupLines(arr);
      return lines.map((l) => joinLine(l.items, glue)).join(glue).replace(/\s+/g, glue === "" ? "" : " ").trim();
    };
    function groupLines(arr) {
      const lines = [];
      [...arr].sort((a, b) => b.y - a.y || a.x - b.x).forEach((it) => {
        const ln = lines.find((l) => Math.abs(l.y - it.y) < 2.2);
        if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
      });
      return lines.sort((a, b) => b.y - a.y);
    }

    // PDFs split text into small pieces (sometimes single letters). Stitch them back into
    // words and table cells: small gaps join, wide gaps or wide spaces start a new cell.
    function toCells(raw) {
      const cells = [];
      groupLinesRaw(raw).forEach((ln) => {
        let cur = null;
        [...ln.items].sort((a, b) => a.x - b.x).forEach((it) => {
          const blank = !it.str.trim();
          if (blank) {
            if (cur && it.w > 6) cur = null;               // wide space = column gap
            else if (cur && !cur.str.endsWith(" ")) cur.str += " ";
            return;
          }
          const gap = cur ? it.x - (cur.x + cur.w) : Infinity;
          if (cur && gap < 4 && Math.abs(cur.size - it.size) < 1.5) {
            if (gap > 1.2 && !cur.str.endsWith(" ")) cur.str += " ";
            cur.str += it.str;
            cur.w = it.x + it.w - cur.x;
            cur.size = Math.max(cur.size, it.size);
          } else {
            cur = { str: it.str, x: it.x, y: ln.y, w: it.w, size: it.size };
            cells.push(cur);
          }
        });
      });
      cells.forEach((c) => { c.str = c.str.replace(/\s+/g, " ").trim(); });
      return cells.filter((c) => c.str);
    }
    function groupLinesRaw(arr) {
      const lines = [];
      [...arr].sort((a, b) => b.y - a.y).forEach((it) => {
        const ln = lines.find((l) => Math.abs(l.y - it.y) < 1);
        if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
      });
      return lines;
    }

    pages.forEach((raw, pi) => {
      const its = toCells(raw);
      if (pi === 0 && its.length) {
        const maxSize = Math.max(...its.map((i) => i.size));
        title = joinLine(its.filter((i) => i.size === maxSize));
      }
      // header cells
      const h = {};
      its.forEach((i) => {
        const k = i.str.trim().toLowerCase();
        if (HEAD.includes(k) && !h[k]) h[k] = i;
      });
      if (!h.item || !h.price || !h.total) return;
      const headY = h.item.y;
      const body = its.filter((i) => i.y < headY - 2);
      const lines = groupLines(body);
      const idxRight = h.item.x - 1;
      const xCat = h.category ? h.category.x - 2 : Infinity;
      const xLink = h.link ? h.link.x - 2 : Infinity;
      const xStatus = h.status ? h.status.x - 2 : Infinity;
      const xNums = Math.min(h.price.x - 30, (h.qty || h.price).x - 30);

      let cur = null;
      const rows = [];
      for (const ln of lines) {
        const first = [...ln.items].sort((a, b) => a.x - b.x)[0];
        const startsRow = first.x < idxRight && /^\d+$/.test(first.str.trim());
        const hasTotal = ln.items.some((i) => i.x + i.w > h.total.x - 5 && isMoney(i.str));
        if (startsRow) { cur = { parts: [...ln.items] }; rows.push(cur); }
        else if (cur && !hasTotal && !(ln.items.length === 1 && /made with/i.test(first.str))) cur.parts.push(...ln.items);
        else cur = null; // group header, footer totals, notes box…
      }

      rows.forEach((r) => {
        const inCol = (a, b) => r.parts.filter((i) => i.x >= a && i.x < b);
        const nameParts = inCol(idxRight, Math.min(xCat, xLink, xStatus, xNums));
        const big = Math.max(0, ...nameParts.map((i) => i.size));
        const name = joinBlock(nameParts.filter((i) => i.size >= big - 0.3));
        const notes = joinBlock(nameParts.filter((i) => i.size < big - 0.3));
        const category = h.category ? joinBlock(inCol(xCat, Math.min(xLink, xStatus))) : "";
        const linkRaw = h.link ? joinBlock(inCol(xLink, Math.min(xStatus, xNums + 30)), "") : "";
        let status = "";
        const rest = r.parts.filter((i) => i.x >= Math.min(xStatus, xNums + 30));
        const nums = [];
        groupLines(rest).forEach((l) => {
          [...l.items].sort((a, b) => a.x - b.x).forEach((i) => {
            const s = i.str.trim();
            if (/^(planned|bought|maybe)\b/i.test(s)) status = s.toLowerCase().replace(/[^a-z]/g, "");
            else if (/\d/.test(s)) nums.push(s);
          });
        });
        // merge split money pieces (e.g. "€" + "12.50") was handled by trimming; take last 3 numbers: price, qty, total
        const vals = nums.slice(-3);
        if (vals.length < 3 || !name) return;
        if (!currency) {
          const sym = vals[0].replace(/[\d.,\s-]/g, "");
          currency = { "€": "EUR", "$": "USD", "£": "GBP", "₺": "TRY", "¥": "JPY", "zł": "PLN", "kr": "SEK", "CHF": "CHF", "TL": "TRY" }[sym] || "";
        }
        const qty = Math.max(1, Math.round(num(vals[1], 1)));
        let price = num(vals[0], NaN);
        const total = num(vals[2], NaN);
        if (!Number.isFinite(price) && Number.isFinite(total)) price = total / qty;
        items.push({ name, notes, category, link: linkRaw === "—" ? "" : linkRaw, status, qty, price });
      });

      // notes box at the bottom ("NOTES" heading)
      const nh = its.find((i) => /^notes$/i.test(i.str.trim()) && i.y < headY);
      if (nh) {
        notepad = groupLines(its.filter((i) => i.y < nh.y - 1 && i.size > 3))
          .map((l) => joinLine(l.items))
          .filter((t) => !/^(made with trally|generated with tally|page \d+ of \d+|\* .*not included in totals\.?)$/i.test(t) && !/made with trally$/i.test(t))
          .join("\n").trim();
      }
    });
    return { exact: false, name: title || "Imported list", items, currency, notepad };
  }

  /* ---------------- Drag & drop import ---------------- */
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $("dropOverlay").hidden = false; });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("dropOverlay").hidden = true; });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $("dropOverlay").hidden = true;
    const f = e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(msg, actionLabel = "", action = null) {
    const el = $("toast");
    $("toastMsg").textContent = msg;
    const btn = $("toastAction");
    btn.textContent = actionLabel;
    btn.onclick = () => { el.classList.remove("show"); action && action(); };
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), actionLabel ? 6000 : 3000);
  }

  /* ---------------- Modal (promise based) ---------------- */
  function modal({ title, text = "", input = null, ok = "OK", buttons = null }) {
    return new Promise((resolve) => {
      const m = $("modal"), inp = $("modalInput"), actions = $("modalActions");
      $("modalTitle").textContent = title;
      $("modalText").textContent = text;
      $("modalText").hidden = !text;
      inp.hidden = input === null;
      inp.value = input ?? "";
      const btns = buttons || [{ label: "Cancel", value: null, cls: "btn-ghost" }, { label: ok, value: "ok", cls: "btn-dark" }];
      actions.innerHTML = "";
      btns.forEach((b) => {
        const el = document.createElement("button");
        el.className = "btn " + (b.cls || "");
        el.textContent = b.label;
        el.onclick = () => (b.value === "ok" ? confirm() : close(b.value));
        actions.appendChild(el);
      });
      m.hidden = false;
      const primary = actions.lastElementChild;
      (input === null ? primary : inp).focus();
      if (input !== null) inp.select();

      function close(val) {
        m.hidden = true;
        document.removeEventListener("keydown", onKey, true);
        m.onclick = null;
        resolve(val);
      }
      function confirm() {
        if (input === null) return close(true);
        if (inp.value.trim()) close(inp.value.trim()); else inp.focus();
      }
      function onKey(e) {
        if (e.key === "Escape") { e.stopPropagation(); close(null); }
        if (e.key === "Enter" && !buttons) { e.preventDefault(); confirm(); }
      }
      document.addEventListener("keydown", onKey, true);
      m.onclick = (e) => { if (e.target === m) close(null); };
    });
  }

  /* ---------------- Keyboard shortcuts ---------------- */
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === "Escape") {
      if (!$("pdfModal").hidden) return closePdfDialog();
      if ($("editId").value) { resetForm(false); renderTable(); }
      else if (document.activeElement === $("searchInput") && filters.q) { $("searchInput").value = ""; filters.q = ""; renderTable(); }
      menu.classList.remove("open");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing && lastDeleted) { e.preventDefault(); undoDelete(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") { e.preventDefault(); openPdfDialog(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); $("searchInput").focus(); }
    if (e.key.toLowerCase() === "n") { e.preventDefault(); $("fLink").focus(); }
  });

  // Keep several open tabs in sync
  window.addEventListener("storage", (e) => { if (e.key === STORAGE_KEY) { state = load(); render(); } });

  let resizeT, lastSpan = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { const s = labelSpan(); if (s !== lastSpan) { lastSpan = s; renderTable(); } }, 120);
  });

  /* ---------------- Footer ---------------- */
  $("year").textContent = new Date().getFullYear();
  $("madeBy").innerHTML = "Made by " + (MADE_BY.url
    ? `<a href="${esc(MADE_BY.url)}" target="_blank" rel="noopener">${esc(MADE_BY.name)}</a>`
    : esc(MADE_BY.name));

  /* ---------------- Go ---------------- */
  render();
  save();
  $("fLink").focus();
})();
