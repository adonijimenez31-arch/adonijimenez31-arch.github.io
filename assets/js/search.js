/* Arizona map search: location autocomplete (every AZ city, town, community, county and ZIP),
   filters, "search as I move the map", clustered price pins and URL sync.

   listingsMode "static": filters CFG.listingsSource (demo data, or IDX snapshot built by idx_sync.py).
   listingsMode "api":    asks CFG.searchEndpoint for the homes inside the visible map area, so the
                          whole state can be explored once the authorized IDX feed is connected. */
(function () {
  "use strict";
  const { CFG, T, track, paintFavs, enhanceCards, toast, renderCard, linkFor } = window.SITE;
  const lang = CFG.lang;
  const $ = (id) => document.getElementById(id);
  const form = $("filters");
  const results = $("results");
  const countEl = $("count");
  const sortEl = $("sort");
  const inMapEl = $("inMap");
  const layout = $("layout");
  const toggle = $("viewToggle");
  const qEl = $("q");
  const listEl = $("locList");
  const body = document.body;
  const pageCity = body.dataset.city || "";
  const API = CFG.listingsMode === "api";
  const AZ_BOUNDS = [[31.33, -114.82], [37.0, -109.04]];
  const ZOOM = { c: 12, t: 12, p: 13, z: 13, k: 9, n: 14, g: 13 };

  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const short = (n) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M" : "$" + Math.round(n / 1000) + "K");
  const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? "");
  const daysAgo = (iso) => (Date.now() - new Date(iso + "T12:00:00").getTime()) / 864e5;
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  let all = [];
  let map, layer, markers = {};
  let place = null; // chosen location {name, kind, lat, lng}
  let apiError = false;
  let apiTotal = 0;

  /* ---------- URL <-> state ---------- */
  const FIELDS = ["city", "min", "max", "beds", "baths", "type", "status", "pool"];
  function readUrl() {
    const qs = new URLSearchParams(location.search);
    FIELDS.forEach((f) => {
      const elf = form.elements[f];
      if (!qs.has(f) || !elf) return;
      const v = qs.get(f);
      if (elf.tagName === "SELECT" && v && ![...elf.options].some((o) => o.value === v)) {
        elf.add(new Option(f === "min" || f === "max" ? "$" + Math.round(v / 1000) + "K" : v, v)); // e.g. budget from the calculator
      }
      elf.value = v;
    });
    if (pageCity && !qs.has("city")) form.elements.city.value = pageCity;
    if (qs.get("sort")) sortEl.value = qs.get("sort");
    if (qs.get("q")) qEl.value = qs.get("q");
    if (qs.get("loc") && qs.get("lat")) place = { name: qs.get("loc"), kind: qs.get("k") || "g", lat: +qs.get("lat"), lng: +qs.get("lng") };
    if (qs.get("inmap") === "0") inMapEl.checked = false;
    return qs;
  }
  function filters() {
    const s = {};
    FIELDS.forEach((f) => { const v = (form.elements[f].value || "").trim(); if (v) s[f] = v; });
    if (!place && qEl.value.trim()) s.q = qEl.value.trim();
    return s;
  }
  function writeUrl(s) {
    const qs = new URLSearchParams(s);
    if (pageCity && s.city === pageCity) qs.delete("city");
    if (place) { qs.set("loc", place.name); qs.set("k", place.kind); qs.set("lat", place.lat); qs.set("lng", place.lng); }
    if (sortEl.value !== "new") qs.set("sort", sortEl.value);
    if (!inMapEl.checked) qs.set("inmap", "0");
    const q = qs.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
  }

  /* ---------- Filtering ---------- */
  // A chosen city (dropdown, city page, or a city/town picked in the search box) searches the
  // whole city — not just the visible rectangle — and the map then frames all of its homes.
  function cityName() {
    const c = form.elements.city.value;
    if (c && CFG.cities[c]) return CFG.cities[c][0];
    if (place && (place.kind === "c" || place.kind === "t")) return place.name;
    return "";
  }
  function apply(s, useBounds) {
    const q = norm(s.q || "");
    const cn = norm(cityName());
    const bounds = useBounds && !cn && inMapEl.checked && map ? map.getBounds() : null;
    const list = all.filter((l) =>
      (!cn || norm(l.cityName) === cn) &&
      (!s.min || l.price >= +s.min) &&
      (!s.max || l.price <= +s.max) &&
      (!s.beds || l.beds >= +s.beds) &&
      (!s.baths || l.baths >= +s.baths) &&
      (!s.type || l.type === s.type) &&
      (!s.status || l.status === s.status) &&
      (!s.pool || l.pool) &&
      (!q || norm([l.title[lang], l.area, l.cityName, l.zip, l.id, l.address || ""].join(" ")).includes(q)) &&
      (!bounds || bounds.contains([l.lat, l.lng]))
    );
    const sorters = {
      new: (a, b) => b.listDate.localeCompare(a.listDate),
      price_asc: (a, b) => a.price - b.price,
      price_desc: (a, b) => b.price - a.price,
      sqft: (a, b) => b.sqft - a.sqft,
    };
    return list.sort(sorters[sortEl.value] || sorters.new);
  }

  /* ---------- Rendering (DOM APIs only; listing data is never injected as HTML) ---------- */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const card = (l, i) => renderCard(l, i, { onHover: highlight });

  function emptyState() {
    const empty = el("div", "empty");
    const p = el("p");
    p.append(el("b", null, apiError ? T.idx_offline : T.none_area));
    empty.append(p);
    const b = el("a", "btn btn-wa", T.ask_search);
    const where = place ? " (" + place.name + ")" : "";
    b.href = "https://wa.me/" + CFG.whatsapp + "?text=" + encodeURIComponent(T.wa_default + where);
    b.target = "_blank"; b.rel = "noopener"; b.dataset.track = "click_whatsapp";
    empty.append(b);
    return empty;
  }

  let markerKey = "";
  function render() {
    const s = filters();
    const list = API ? all : apply(s, true);
    writeUrl(s);
    form.querySelectorAll("select").forEach((sel) => sel.classList.toggle("is-set", !!sel.value));
    const n = list.length;
    const total = API ? Math.max(apiTotal, n) : n;
    countEl.textContent = apiError ? ""
      : total > n ? fmt(T.showing_capped, { shown: n.toLocaleString("en-US"), total: total.toLocaleString("en-US") })
      : inMapEl.checked && !cityName()
        ? (n === 1 ? T.in_area_1 : fmt(T.in_area, { n: n.toLocaleString("en-US") }))
        : (n === 1 ? T.results_1 : fmt(T.results, { n: n.toLocaleString("en-US") }));
    results.replaceChildren();
    if (!n) results.append(emptyState());
    else {
      const frag = document.createDocumentFragment();
      list.slice(0, 120).forEach((l, i) => frag.append(card(l, i)));
      results.append(frag);
    }
    paintFavs(results);
    enhanceCards(results);
    // Pins show every match (not only the visible area) so people can pan toward them.
    const key = API ? String(loadSeq) : JSON.stringify(s) + all.length;
    if (key !== markerKey) { markerKey = key; drawMarkers(API ? all : apply(s, false)); }
    if (!API) fitCity(list);
  }

  let fittedCity = "";
  function fitCity(list) {
    const cn = cityName();
    if (!cn) { fittedCity = ""; return; }
    if (!map || !list.length || fittedCity === cn) return;
    fittedCity = cn;
    map.fitBounds(L.latLngBounds(list.map((l) => [l.lat, l.lng])).pad(0.12), { maxZoom: 13 });
  }

  /* ---------- Map ---------- */
  function initMap(qs) {
    if (!window.L || !$("map")) return;
    const [lat, lng] = (body.dataset.center || "33.45,-112.07").split(",").map(Number);
    map = L.map("map", { scrollWheelZoom: false, minZoom: 5, worldCopyJump: false }).setView([lat, lng], +body.dataset.zoom || 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layer = L.markerClusterGroup
      ? L.markerClusterGroup({
          showCoverageOnHover: false, maxClusterRadius: 50, spiderfyOnMaxZoom: true,
          iconCreateFunction: (c) => L.divIcon({ className: "pin-wrap", html: '<span class="cluster">' + c.getChildCount() + "</span>", iconSize: null }),
        }).addTo(map)
      : L.layerGroup().addTo(map);
    map.on("focus", () => map.scrollWheelZoom.enable());
    map.on("blur", () => map.scrollWheelZoom.disable());
    // Once the user drags the map, the visible area becomes the search location (like Zillow):
    // drop the city/place constraint so panning from Goodyear to Buckeye shows Buckeye homes.
    map.on("dragstart", () => {
      if (!form.elements.city.value && !place) return;
      form.elements.city.value = "";
      place = null;
      qEl.value = "";
      inMapEl.checked = true;
    });

    const AZ = L.control({ position: "topright" });
    AZ.onAdd = () => {
      const b = L.DomUtil.create("button", "map-btn");
      b.type = "button";
      b.textContent = T.az_all;
      L.DomEvent.on(b, "click", (e) => { L.DomEvent.stop(e); clearPlace(); map.fitBounds(AZ_BOUNDS); track("map_view_arizona", {}); });
      return b;
    };
    AZ.addTo(map);

    if (place) map.setView([place.lat, place.lng], ZOOM[place.kind] || 12);
    else if (qs.get("view") === "az") map.fitBounds(AZ_BOUNDS);
    let t;
    map.on("moveend", () => {
      clearTimeout(t);
      t = setTimeout(() => (API ? load() : render()), API ? 300 : 60);
    });
  }
  function popup(l) {
    const wrap = el("div", "map-pop");
    const img = el("img"); img.src = l.image; img.alt = ""; img.width = 220; img.height = 147;
    const a = el("a"); a.href = linkFor(l);
    a.append(el("strong", null, money(l.price)));
    wrap.append(img, a, el("span", null, `${l.beds} ${T.bd} · ${l.baths} ${T.ba} · ${Number(l.sqft).toLocaleString("en-US")} ${T.sqft}`), el("br"), el("span", null, `${l.area}, ${l.cityName}`));
    return wrap;
  }
  function drawMarkers(list) {
    if (!map) return;
    layer.clearLayers();
    markers = {};
    const ms = list.map((l) => {
      const icon = L.divIcon({ className: "pin-wrap", html: `<span class="pin${l.status === "Pending" ? " pending" : ""}">${short(l.price)}</span>`, iconSize: null });
      const m = L.marker([l.lat, l.lng], { icon, title: l.title[lang], riseOnHover: true }).bindPopup(() => popup(l), { maxWidth: 240 });
      m.on("click", () => track("view_map_pin", { listing_id: l.id }));
      markers[l.id] = m;
      return m;
    });
    if (layer.addLayers) layer.addLayers(ms); else ms.forEach((m) => m.addTo(layer));
  }
  function highlight(id, on) {
    const m = markers[id];
    const pin = m && m.getElement() && m.getElement().querySelector(".pin");
    if (pin) pin.classList.toggle("is-active", on);
    if (m && m.getElement()) m.setZIndexOffset(on ? 1000 : 0);
  }

  /* ---------- Data ---------- */
  let loadSeq = 0;
  let lastQuery = "";
  function load() {
    if (!API) return;
    const cn = cityName();
    const f = filters();
    delete f.city;
    if (cn) f.city = cn; // the MLS City field holds the city name
    const qs = new URLSearchParams(f);
    const b = map.getBounds();
    qs.set("bbox", cn ? "31.3,-114.9,37.05,-109" : [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((x) => x.toFixed(4)).join(","));
    qs.set("sort", sortEl.value);
    const query = qs.toString();
    if (query === lastQuery) return; // e.g. zooming inside a city search: same results, no refetch
    lastQuery = query;
    const seq = ++loadSeq;
    countEl.textContent = T.loading;
    fetch(CFG.searchEndpoint + "?" + query, { headers: { Accept: "application/json" } })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => {
        if (seq !== loadSeq) return;
        apiError = false; all = d.listings || []; apiTotal = +d.total || all.length;
        render();
        if (cn && all.length) map.fitBounds(L.latLngBounds(all.map((l) => [l.lat, l.lng])).pad(0.12), { maxZoom: 13 });
      })
      .catch(() => { if (seq !== loadSeq) return; apiError = true; all = []; lastQuery = ""; render(); });
  }

  /* ---------- Location autocomplete (every Arizona place) ---------- */
  let places = null;
  let active = -1;
  let options = [];
  function loadPlaces() {
    if (places) return Promise.resolve(places);
    return fetch(CFG.placesUrl).then((r) => r.json()).then((d) => (places = d)).catch(() => (places = []));
  }
  function suggestions(text) {
    const q = norm(text.trim());
    if (q.length < 2) return [];
    const out = [];
    const seen = new Set();
    const push = (name, kind, lat, lng, rank) => {
      const key = kind + name;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, kind, lat, lng, rank });
    };
    (places || []).forEach(([name, kind, lat, lng]) => {
      const n = norm(name);
      const i = n.indexOf(q);
      if (i === 0 || (i > 0 && n[i - 1] === " ")) push(name, kind, lat, lng, (i === 0 ? 0 : 1) + "ctkpz".indexOf(kind) / 10);
    });
    all.forEach((l) => {  // neighborhoods / subdivisions present in the listing data
      if (l.area && norm(l.area).includes(q) && l.area !== l.cityName) push(l.area + ", " + l.cityName, "n", l.lat, l.lng, 0.5);
    });
    return out.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length).slice(0, 8);
  }
  function showList(items) {
    options = items;
    active = -1;
    listEl.replaceChildren();
    items.forEach((it, i) => {
      const li = el("li");
      li.id = "loc-opt-" + i;
      li.setAttribute("role", "option");
      li.append(el("span", "loc-name", it.name), el("span", "loc-kind", T["k_" + it.kind] || ""));
      li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(it); });
      listEl.append(li);
    });
    listEl.hidden = !items.length;
    qEl.setAttribute("aria-expanded", String(!!items.length));
  }
  function setActive(i) {
    active = i;
    listEl.querySelectorAll("li").forEach((li, k) => li.classList.toggle("on", k === i));
    qEl.setAttribute("aria-activedescendant", i >= 0 ? "loc-opt-" + i : "");
  }
  function choose(it) {
    place = { name: it.name, kind: it.kind, lat: it.lat, lng: it.lng };
    qEl.value = it.name;
    showList([]);
    form.elements.city.value = "";
    inMapEl.checked = true;
    if (map) map.flyTo([it.lat, it.lng], ZOOM[it.kind] || 12, { duration: 0.8 });
    track("search", { search_term: it.name, location_type: it.kind });
    if (!map) render();
  }
  function clearPlace() { place = null; }
  function geocode(text) {
    // Fallback for neighborhoods and addresses not in the Census list (OpenStreetMap Nominatim, Arizona only).
    const qs = new URLSearchParams({ q: text + ", Arizona", format: "jsonv2", limit: "1", countrycodes: "us", viewbox: "-114.82,37.0,-109.04,31.33", bounded: "1", "accept-language": lang });
    return fetch("https://nominatim.openstreetmap.org/search?" + qs, { headers: { Accept: "application/json" } })
      .then((r) => r.json()).then((d) => (d && d[0] ? { name: text, kind: "g", lat: +d[0].lat, lng: +d[0].lon } : null)).catch(() => null);
  }
  let sugT;
  qEl.addEventListener("input", () => {
    place = null;
    clearTimeout(sugT);
    sugT = setTimeout(() => loadPlaces().then(() => showList(suggestions(qEl.value))), 120);
    if (!qEl.value) { showList([]); render(); }
  });
  qEl.addEventListener("focus", loadPlaces, { once: true });
  qEl.addEventListener("blur", () => setTimeout(() => showList([]), 150));
  qEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && options.length) { e.preventDefault(); setActive(Math.min(active + 1, options.length - 1)); }
    else if (e.key === "ArrowUp" && options.length) { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === "Escape") showList([]);
    else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) return choose(options[active]);
      const text = qEl.value.trim();
      if (!text) return render();
      loadPlaces().then(() => {
        const s = suggestions(text);
        const exact = s.find((x) => norm(x.name) === norm(text)) || (s.length === 1 && s[0]);
        if (exact) return choose(exact);
        const kw = apply({ q: text }, false);
        if (kw.length) { showList([]); inMapEl.checked = false; return render(); }
        geocode(text).then((g) => (g ? choose(g) : toast(T.loc_none)));
      });
    }
  });

  /* ---------- Events ---------- */
  form.addEventListener("change", (e) => {
    if (e.target.name === "city" && e.target.value && CFG.cities[e.target.value] && map) {
      place = null; qEl.value = "";
      const [, lat, lng] = CFG.cities[e.target.value];
      let moved = false;
      map.once("moveend", () => { moved = true; });
      map.flyTo([lat, lng], 11, { duration: 0.8 });
      setTimeout(() => { if (!moved) (API ? load() : render()); }, 1500); // already there: no moveend fires
      return; // results load once the map arrives (moveend), so the area and city always match
    }
    API ? load() : render();
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("reset", () => setTimeout(() => {
    place = null;
    if (pageCity) form.elements.city.value = pageCity;
    API ? load() : render();
  }, 0));
  sortEl.addEventListener("change", () => (API ? load() : render()));
  inMapEl.addEventListener("change", () => (API ? load() : render()));

  const ft = form.querySelector(".filter-toggle");
  ft && ft.addEventListener("click", () => {
    const open = form.classList.toggle("is-open");
    ft.setAttribute("aria-expanded", String(open));
  });
  toggle && toggle.addEventListener("click", () => {
    const showMap = layout.classList.toggle("show-map");
    toggle.setAttribute("aria-pressed", String(showMap));
    toggle.querySelector("span").textContent = showMap ? T.view_list : T.view_map;
    if (showMap && map) setTimeout(() => map.invalidateSize(), 50);
  });

  /* ---------- Boot ---------- */
  const qs = readUrl();
  initMap(qs);
  if (API) { if (map) load(); }
  else {
    fetch(CFG.listingsSource, { headers: { Accept: "application/json" } })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((data) => { all = data.listings || []; render(); })
      .catch(() => { countEl.textContent = T.load_error; });
  }
})();
