/* ==========================================================
   Tally — price list notepad
   Everything is saved in this browser (localStorage).
   ========================================================== */
(() => {
  "use strict";

  const STORAGE_KEY = "tally.v1";
  const $ = (id) => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const STATUS_LABEL = { planned: "Planned", bought: "Bought", maybe: "Maybe" };
  const STATUS_ORDER = ["planned", "bought", "maybe"];

  /* ---------------- State ---------------- */
  const defaultSettings = () => ({ currency: "EUR", tax: 0, shipping: 0, budget: 0, excludeMaybe: false });
  const newList = (name) => ({ id: uid(), name, created: Date.now(), items: [], settings: defaultSettings() });

  let state = load();
  let sort = { key: null, dir: 1 };   // null = order added
  let filters = { q: "", category: "", status: "" };
  let groupByCategory = false;
  let lastDeleted = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.lists && Object.keys(s.lists).length) return s;
      }
    } catch (e) { /* storage unavailable or corrupt */ }
    const first = newList("My list");
    return { lists: { [first.id]: first }, activeId: first.id, theme: "light" };
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast("Couldn't save in this browser (storage blocked or full)."); }
  }

  const list = () => state.lists[state.activeId];
  const settings = () => list().settings;

  /* ---------------- Formatting ---------------- */
  let fmtCache = {};
  function money(n) {
    const cur = settings().currency;
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
  // Accepts "12.50", "12,50", "1.299,99", "1,299.99", "€ 12" …
  const num = (v, d = 0) => {
    let s = String(v ?? "").trim().replace(/[^\d.,-]/g, "");
    if (!s) return d;
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (lc > -1) s = /,\d{3}$/.test(s) && (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : d;
  };
  const round2 = (n) => Math.round(n * 100) / 100;

  function normalizeLink(raw) {
    const v = (raw || "").trim();
    if (!v) return "";
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v;
    try {
      const u = new URL(withProto);
      if (!/^https?:$/.test(u.protocol)) return "";
      return u.href;
    } catch (e) { return null; } // invalid
  }
  function linkLabel(href) {
    try { const u = new URL(href); return u.hostname.replace(/^www\./, ""); }
    catch (e) { return href; }
  }

  /* ---------------- Calculations ---------------- */
  const lineTotal = (it) => round2(it.price * it.qty);
  const counts = (it) => !(settings().excludeMaybe && it.status === "maybe");

  function totals(items = list().items) {
    const s = settings();
    const included = items.filter(counts);
    const subtotal = round2(included.reduce((a, it) => a + lineTotal(it), 0));
    const tax = round2(subtotal * (num(s.tax) / 100));
    const shipping = included.length ? round2(num(s.shipping)) : 0;
    const grand = round2(subtotal + tax + shipping);
    const units = included.reduce((a, it) => a + it.qty, 0);
    const bought = round2(included.filter((i) => i.status === "bought").reduce((a, it) => a + lineTotal(it), 0));
    return { included, subtotal, tax, shipping, grand, units, bought, remaining: round2(subtotal - bought) };
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

  function categories() {
    return [...new Set(list().items.map((i) => i.category || "General"))].sort((a, b) => a.localeCompare(b));
  }

  function groupItems(items) {
    const map = new Map();
    items.forEach((it) => {
      const c = it.category || "General";
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(it);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  /* ---------------- Render ---------------- */
  function render(flashId) {
    document.documentElement.dataset.theme = state.theme || "light";
    renderListPicker();
    renderSettings();
    renderFilters();
    renderTable(flashId);
    renderStats();
    renderBreakdown();
    updateLinePreview();
  }

  function renderListPicker() {
    const sel = $("listSelect");
    const lists = Object.values(state.lists).sort((a, b) => a.created - b.created);
    sel.innerHTML = lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.items.length})</option>`).join("");
    sel.value = state.activeId;
    $("deleteListBtn").disabled = lists.length < 2;
    $("deleteListBtn").style.opacity = lists.length < 2 ? .3 : "";
    document.title = `${list().name} — Tally`;
  }

  function renderSettings() {
    const s = settings();
    $("currencySelect").value = s.currency;
    $("taxInput").value = s.tax || "";
    $("shippingInput").value = s.shipping || "";
    $("budgetInput").value = s.budget || "";
    $("excludeMaybe").checked = !!s.excludeMaybe;
    $("curSym").textContent = currencySymbol();
    const symLen = currencySymbol().length;
    $("fPrice").style.paddingLeft = (18 + symLen * 8) + "px";
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
    $("sheet").classList.toggle("grouped", groupByCategory);
    // sort header indicators
    document.querySelectorAll("th.sortable").forEach((th) => {
      th.classList.remove("asc", "desc");
      if (th.dataset.sort === sort.key) th.classList.add(sort.dir === 1 ? "asc" : "desc");
    });

    // footer
    const t = totals();
    const s = settings();
    const filtered = items.length !== all.length;
    let foot = "";
    if (all.length) {
      if (filtered) {
        const ft = items.filter(counts).reduce((a, it) => a + lineTotal(it), 0);
        foot += footRow(`Showing ${items.length} of ${all.length} — filtered subtotal`, money(ft), "sub");
      }
      foot += footRow(`Subtotal · ${t.units} unit${t.units === 1 ? "" : "s"}`, money(t.subtotal), "sub");
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
      empty.innerHTML = `<div class="empty-icon">▦</div><p><strong>Your list is empty.</strong></p><p>Add an item on the left. Its name, link and price go into an organized sheet here.</p>`;
    }

    if (flashId) {
      const row = body.querySelector(`tr[data-id="${flashId}"]`);
      if (row) { row.classList.add("flash"); row.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    }
  }

  // Columns between "#" and "Total" that are currently visible (some hide on smaller screens)
  function labelSpan() {
    const ths = [...document.querySelectorAll("#sheet thead th")];
    const visible = ths.filter((th) => getComputedStyle(th).display !== "none").length;
    return Math.max(1, visible - 3);
  }

  const footRow = (label, value, cls) =>
    `<tr class="${cls}"><td class="c-num"></td><td colspan="${labelSpan()}" class="f-label">${label}</td><td class="num">${value}</td><td class="c-act"></td></tr>`;

  function renderStats() {
    const t = totals();
    const s = settings();
    const n = t.included.length;
    $("statTotal").textContent = money(t.grand);
    $("statCount").textContent = `${list().items.length}` + (t.units !== list().items.length && t.units ? ` · ${t.units} units` : "");
    $("statAvg").textContent = money(n ? t.subtotal / t.units : 0);
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
    const panel = $("breakdownPanel");
    if (groups.length < 2 || t.subtotal <= 0) { panel.hidden = true; return; }
    panel.hidden = false;
    const rows = groups
      .map(([cat, its]) => [cat, its.reduce((a, it) => a + lineTotal(it), 0)])
      .sort((a, b) => b[1] - a[1]);
    const max = rows[0][1] || 1;
    $("breakdown").innerHTML = rows.map(([cat, v]) => `
      <div class="bd-row">
        <span class="bd-name" title="${esc(cat)}">${esc(cat)}</span>
        <div class="bd-track"><div class="bd-fill" style="width:${(v / max) * 100}%"></div></div>
        <span class="bd-val">${money(v)}</span>
        <span class="bd-pct">${((v / t.subtotal) * 100).toFixed(0)}%</span>
      </div>`).join("");
  }

  function updateLinePreview() {
    const p = num($("fPrice").value);
    const q = Math.max(1, Math.round(num($("fQty").value, 1)));
    $("linePreview").textContent = money(round2(p * q));
  }

  /* ---------------- Form ---------------- */
  const form = $("itemForm");

  function readForm() {
    const name = $("fName").value.trim();
    const priceRaw = $("fPrice").value.trim();
    const price = num(priceRaw, NaN);
    const qty = Math.max(1, Math.round(num($("fQty").value, 1)));
    const link = normalizeLink($("fLink").value);
    const errors = [];

    [$("fName"), $("fPrice"), $("fLink")].forEach((el) => el.classList.remove("invalid"));
    if (!name) { errors.push("Give the item a name."); $("fName").classList.add("invalid"); }
    if (!priceRaw || !Number.isFinite(price) || price < 0 || !/\d/.test(priceRaw)) { errors.push("Enter a valid price."); $("fPrice").classList.add("invalid"); }
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
    [$("fName"), $("fPrice"), $("fLink")].forEach((el) => el.classList.remove("invalid"));
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
      const it = list().items.find((i) => i.id === editId);
      Object.assign(it, data);
      id = editId;
      toast("Item updated.");
    } else {
      id = uid();
      list().items.push({ id, created: Date.now(), ...data });
    }
    save();
    resetForm(true);
    render(id);
    $("fName").focus();
  });

  // Enter in textarea should not submit; Ctrl/Cmd+Enter does
  $("fNotes").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  $("cancelEditBtn").addEventListener("click", () => { resetForm(false); renderTable(); });
  ["fPrice", "fQty"].forEach((id) => $(id).addEventListener("input", updateLinePreview));
  document.querySelectorAll(".qty-btn").forEach((b) =>
    b.addEventListener("click", () => {
      $("fQty").value = Math.max(1, Math.round(num($("fQty").value, 1)) + Number(b.dataset.step));
      updateLinePreview();
    })
  );
  // Tidy link when leaving the field
  $("fLink").addEventListener("blur", () => {
    const n = normalizeLink($("fLink").value);
    if (n) $("fLink").value = n;
  });

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

  function undoDelete() {
    if (!lastDeleted) return;
    const l = state.lists[lastDeleted.listId];
    if (l) {
      l.items.splice(lastDeleted.index, 0, lastDeleted.item);
      const id = lastDeleted.item.id;
      lastDeleted = null;
      save(); render(id);
    }
  }

  document.querySelectorAll("th.sortable").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (sort.key !== k) sort = { key: k, dir: k === "price" || k === "total" ? -1 : 1 };
      else if (sort.dir === (k === "price" || k === "total" ? -1 : 1)) sort.dir *= -1;
      else sort = { key: null, dir: 1 }; // third click: back to order added
      renderTable();
    })
  );

  /* ---------------- Toolbar / filters ---------------- */
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
  const bindNum = (id, key) => $(id).addEventListener("input", (e) => {
    settings()[key] = Math.max(0, num(e.target.value)); save();
    renderTable(); renderStats(); renderBreakdown();
  });
  ["taxInput", "shippingInput", "budgetInput"].forEach((id) =>
    $(id).addEventListener("blur", (e) => { const v = num(e.target.value); e.target.value = v ? v : ""; }));
  bindNum("taxInput", "tax");
  bindNum("shippingInput", "shipping");
  bindNum("budgetInput", "budget");
  $("excludeMaybe").addEventListener("change", (e) => { settings().excludeMaybe = e.target.checked; save(); render(); });

  /* ---------------- Lists ---------------- */
  $("listSelect").addEventListener("change", (e) => {
    state.activeId = e.target.value;
    filters = { q: "", category: "", status: "" };
    $("searchInput").value = ""; $("filterStatus").value = "";
    resetForm(false); save(); render();
  });
  $("newListBtn").addEventListener("click", async () => {
    const name = await modal({ title: "New list", text: "Give your list a name.", input: "", ok: "Create" });
    if (!name) return;
    const l = newList(name.trim());
    l.settings.currency = settings().currency; // keep chosen currency
    state.lists[l.id] = l; state.activeId = l.id;
    resetForm(false); save(); render();
    toast(`Created “${l.name}”.`);
  });
  $("renameListBtn").addEventListener("click", async () => {
    const name = await modal({ title: "Rename list", input: list().name, ok: "Rename" });
    if (!name) return;
    list().name = name.trim(); save(); render();
  });
  $("deleteListBtn").addEventListener("click", async () => {
    if (Object.keys(state.lists).length < 2) return;
    const ok = await modal({ title: "Delete list?", text: `“${list().name}” and its ${list().items.length} item(s) will be removed. This can't be undone.`, ok: "Delete" });
    if (!ok) return;
    delete state.lists[state.activeId];
    state.activeId = Object.keys(state.lists)[0];
    resetForm(false); save(); render();
  });

  /* ---------------- Menu ---------------- */
  const menu = $("moreMenu");
  $("moreBtn").addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("open"); });
  document.addEventListener("click", () => menu.classList.remove("open"));
  menu.addEventListener("click", async (e) => {
    const a = e.target.dataset.action;
    if (!a) return;
    menu.classList.remove("open");
    if (a === "csv") exportCSV();
    if (a === "json") exportJSON();
    if (a === "import") $("importFile").click();
    if (a === "theme") { state.theme = state.theme === "dark" ? "light" : "dark"; save(); render(); }
    if (a === "clear") {
      if (!list().items.length) return toast("The list is already empty.");
      const ok = await modal({ title: "Clear all items?", text: `Remove all ${list().items.length} items from “${list().name}”? This can't be undone.`, ok: "Clear" });
      if (ok) { list().items = []; resetForm(false); save(); render(); }
    }
  });

  /* ---------------- Export: PDF ---------------- */
  function buildReport() {
    const l = list();
    const s = settings();
    const items = visibleItems();
    const t = totals();
    const filtered = items.length !== l.items.length;
    const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    let i = 0;

    const row = (it) => `
      <tr>
        <td class="idx">${++i}</td>
        <td><strong>${esc(it.name)}</strong>${it.notes ? `<span class="notes">${esc(it.notes)}</span>` : ""}</td>
        <td>${esc(it.category || "General")}</td>
        <td>${it.link ? `<a class="link" href="${esc(it.link)}">${esc(it.link)}</a>` : "—"}</td>
        <td>${STATUS_LABEL[it.status]}${!counts(it) ? " *" : ""}</td>
        <td class="num">${money(it.price)}</td>
        <td class="num">${it.qty}</td>
        <td class="num"><strong>${money(lineTotal(it))}</strong></td>
      </tr>`;

    let rows;
    if (groupByCategory) {
      rows = groupItems(items).map(([cat, its]) => {
        const sub = its.filter(counts).reduce((a, it) => a + lineTotal(it), 0);
        return `<tr class="rp-group"><td colspan="7">${esc(cat)}</td><td class="num">${money(sub)}</td></tr>` + its.map(row).join("");
      }).join("");
    } else rows = items.map(row).join("");

    const fr = (label, val, cls = "") => `<tr class="${cls}"><td colspan="7" class="num">${label}</td><td class="num">${val}</td></tr>`;
    let foot = fr("Subtotal", money(t.subtotal));
    if (num(s.tax)) foot += fr(`Tax / VAT (${num(s.tax)}%)`, money(t.tax));
    if (t.shipping) foot += fr("Shipping / fees", money(t.shipping));
    foot += fr("Grand total", money(t.grand), "grand");

    const budget = num(s.budget);
    $("report").innerHTML = `
      <div class="rp-head">
        <h1 class="rp-title">${esc(l.name)}</h1>
        <div class="rp-meta">${date}<br>${l.items.length} items · ${t.units} units · ${esc(s.currency)}${filtered ? "<br>Filtered view" : ""}</div>
      </div>
      <div class="rp-summary">
        <div><small>Subtotal</small><b>${money(t.subtotal)}</b></div>
        <div><small>Bought</small><b>${money(t.bought)}</b></div>
        <div><small>Remaining</small><b>${money(t.remaining)}</b></div>
        ${budget ? `<div><small>Budget left</small><b>${money(budget - t.grand)}</b></div>` : ""}
        <div><small>Grand total</small><b>${money(t.grand)}</b></div>
      </div>
      <table class="rp-table">
        <thead><tr><th>#</th><th>Item</th><th>Category</th><th>Link</th><th>Status</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Total</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">No items.</td></tr>`}</tbody>
        <tfoot>${foot}</tfoot>
      </table>
      <div class="rp-foot">
        <span>${s.excludeMaybe ? "* “Maybe” items are not included in totals." : ""}</span>
        <span>Generated with Tally</span>
      </div>`;
  }

  $("pdfBtn").addEventListener("click", () => {
    if (!list().items.length) return toast("Add some items first.");
    buildReport();
    toast("In the print window, choose “Save as PDF”.");
    setTimeout(() => window.print(), 150);
  });
  window.addEventListener("beforeprint", buildReport); // covers Ctrl/Cmd+P too

  /* ---------------- Export: CSV / JSON ---------------- */
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
    lines.push("");
    lines.push([, , , , , , "Subtotal", t.subtotal.toFixed(2)].map(q).join(","));
    if (num(s.tax)) lines.push([, , , , , , `Tax ${num(s.tax)}%`, t.tax.toFixed(2)].map(q).join(","));
    if (t.shipping) lines.push([, , , , , , "Shipping", t.shipping.toFixed(2)].map(q).join(","));
    lines.push([, , , , , , "Grand total", t.grand.toFixed(2)].map(q).join(","));
    download(`${slug(list().name)}-${today()}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
    toast("CSV downloaded — opens in Excel, Numbers or Google Sheets.");
  }

  function exportJSON() {
    download(`tally-backup-${today()}.json`, JSON.stringify(state, null, 2), "application/json");
    toast("Backup downloaded (all lists).");
  }

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !data.lists || typeof data.lists !== "object") throw new Error("bad");
      // sanitize items
      Object.values(data.lists).forEach((l) => {
        l.settings = { ...defaultSettings(), ...(l.settings || {}) };
        l.items = (l.items || []).map((it) => ({
          id: it.id || uid(), created: it.created || Date.now(),
          name: String(it.name || "Untitled"), link: normalizeLink(it.link) || "",
          price: round2(num(it.price)), qty: Math.max(1, Math.round(num(it.qty, 1))),
          category: String(it.category || "General"), status: STATUS_LABEL[it.status] ? it.status : "planned",
          notes: String(it.notes || ""),
        }));
      });
      const ok = await modal({ title: "Restore backup?", text: `This replaces your current lists with ${Object.keys(data.lists).length} list(s) from the file.`, ok: "Restore" });
      if (!ok) return;
      state = { lists: data.lists, activeId: data.lists[data.activeId] ? data.activeId : Object.keys(data.lists)[0], theme: data.theme || state.theme };
      resetForm(false); save(); render();
      toast("Backup restored.");
    } catch (err) { toast("That file isn't a valid Tally backup."); }
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
    toastTimer = setTimeout(() => el.classList.remove("show"), actionLabel ? 6000 : 2800);
  }

  /* ---------------- Modal (promise based) ---------------- */
  function modal({ title, text = "", input = null, ok = "OK" }) {
    return new Promise((resolve) => {
      const m = $("modal"), inp = $("modalInput");
      $("modalTitle").textContent = title;
      $("modalText").textContent = text;
      $("modalText").hidden = !text;
      $("modalOk").textContent = ok;
      inp.hidden = input === null;
      inp.value = input ?? "";
      m.hidden = false;
      (input === null ? $("modalOk") : inp).focus();
      if (input !== null) inp.select();

      const close = (val) => {
        m.hidden = true;
        document.removeEventListener("keydown", onKey, true);
        $("modalOk").onclick = $("modalCancel").onclick = m.onclick = null;
        resolve(val);
      };
      const confirm = () => {
        if (input === null) return close(true);
        if (inp.value.trim()) close(inp.value.trim());
        else inp.focus();
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); close(null); }
        if (e.key === "Enter") { e.preventDefault(); confirm(); }
      };
      document.addEventListener("keydown", onKey, true);
      $("modalOk").onclick = confirm;
      $("modalCancel").onclick = () => close(null);
      m.onclick = (e) => { if (e.target === m) close(null); };
    });
  }

  /* ---------------- Keyboard shortcuts ---------------- */
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === "Escape") {
      if ($("editId").value) { resetForm(false); renderTable(); }
      else if (document.activeElement === $("searchInput") && filters.q) { $("searchInput").value = ""; filters.q = ""; renderTable(); }
      menu.classList.remove("open");
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); $("searchInput").focus(); }
    if (e.key.toLowerCase() === "n") { e.preventDefault(); $("fName").focus(); }
  });

  // Sync across tabs
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) { state = load(); if (!state.lists[state.activeId]) state.activeId = Object.keys(state.lists)[0]; render(); }
  });

  let resizeT;
  let lastSpan = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { const s = labelSpan(); if (s !== lastSpan) { lastSpan = s; renderTable(); } }, 120);
  });

  /* ---------------- Go ---------------- */
  render();
  $("fName").focus();
})();
