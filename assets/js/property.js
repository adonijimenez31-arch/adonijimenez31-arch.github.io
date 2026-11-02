/* Property detail page: live status, photo lightbox, location map and mortgage estimate. */
(function () {
  "use strict";
  const { CFG, T, track } = window.SITE;
  const $ = (id) => document.getElementById(id);

  /* ---------- Live status (IDX) ----------
     Static pages are rebuilt from ARMLS on a schedule; between rebuilds this asks
     /api/status so a home that sells or is withdrawn is flagged immediately.
     In demo mode, add ?demo_status=Closed to the URL to preview the behavior. */
  function markGone() {
    const gone = $("gone");
    if (!gone || !gone.hidden) return;
    gone.hidden = false;
    if ($("dyn")) document.querySelectorAll("#gallery, #dyn .prop-layout > div:first-child").forEach((n) => { n.hidden = true; });
    const st = $("propStatus");
    if (st) { st.textContent = T.status_gone; st.className = "badge badge-gone"; }
    document.querySelectorAll('[data-lead-form] [name="form_type"][value="showing"]').forEach((i) => {
      const form = i.closest("form");
      if (form) form.hidden = true;
    });
    track("listing_unavailable", { listing_id: (($("gallery") || {}).dataset || {}).listingId });
  }
  function applyStatus(s) {
    if (!s || !s.status || !["Active", "Pending"].includes(s.status)) return markGone();
    const st = $("propStatus");
    if (st && T["status_" + s.status]) {
      st.textContent = T["status_" + s.status];
      st.className = "badge" + (s.status === "Pending" ? " badge-pending" : "");
    }
    if (s.price && $("propPrice")) $("propPrice").textContent = "$" + Math.round(s.price).toLocaleString("en-US");
  }
  const g = $("gallery");
  const id = g && g.dataset.listingId;
  const demoStatus = CFG.demo && new URLSearchParams(location.search).get("demo_status");
  if (demoStatus) applyStatus({ status: demoStatus });
  else if (id && CFG.statusEndpoint && !$("dyn")) {
    fetch(CFG.statusEndpoint + "?id=" + encodeURIComponent(id), { headers: { Accept: "application/json" } })
      .then((r) => (r.status === 404 ? { status: "Gone" } : r.ok ? r.json() : null))
      .then((s) => { if (s) applyStatus(s); })
      .catch(() => { /* keep the static status if the check fails */ });
  }

  function init() {
    /* ---------- Lightbox ---------- */
    const gallery = $("gallery");
    const lb = $("lightbox");
    if (gallery && lb && lb.showModal) {
      const images = JSON.parse(gallery.dataset.images || "[]");
      const img = $("lbImg");
      const count = $("lbCount");
      let idx = 0;
      const show = (i) => {
        idx = (i + images.length) % images.length;
        img.src = images[idx];
        img.alt = gallery.querySelectorAll("img")[Math.min(idx, 2)].alt;
        count.textContent = idx + 1 + " / " + images.length;
      };
      gallery.addEventListener("click", (e) => {
        const b = e.target.closest("[data-lb]");
        if (!b) return;
        show(+b.dataset.lb);
        lb.showModal();
        track("view_photos", {});
      });
      lb.querySelector("[data-lb-close]").addEventListener("click", () => lb.close());
      lb.querySelector("[data-lb-prev]").addEventListener("click", () => show(idx - 1));
      lb.querySelector("[data-lb-next]").addEventListener("click", () => show(idx + 1));
      lb.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") show(idx - 1);
        if (e.key === "ArrowRight") show(idx + 1);
      });
      let x0 = null;
      lb.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
      lb.addEventListener("touchend", (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
        x0 = null;
      });
    }

    /* ---------- Map ---------- */
    const mm = $("miniMap");
    if (mm && window.L) {
      const lat = +mm.dataset.lat, lng = +mm.dataset.lng;
      const map = L.map(mm, { scrollWheelZoom: false }).setView([lat, lng], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const pin = document.createElement("span");
      pin.className = "pin";
      pin.textContent = mm.dataset.price;
      L.marker([lat, lng], { icon: L.divIcon({ className: "pin-wrap", html: pin.outerHTML, iconSize: null }) }).addTo(map);
    }

    /* ---------- Mortgage estimate ---------- */
    const f = $("mortForm");
    if (f) {
      const out = (n) => "$" + Math.round(n).toLocaleString("en-US");
      const extra = +f.dataset.extra || 0;
      const calc = () => {
        const price = Math.max(0, +f.elements.price.value || 0);
        const down = Math.min(100, Math.max(0, +f.elements.down.value || 0));
        const r = Math.max(0, +f.elements.rate.value || 0) / 100 / 12;
        const n = (+f.elements.term.value || 30) * 12;
        const loan = price * (1 - down / 100);
        const pi = r ? (loan * r) / (1 - Math.pow(1 + r, -n)) : loan / n;
        $("mPI").textContent = out(pi);
        $("mTotal").textContent = out(pi + extra);
      };
      f.addEventListener("input", calc);
      f.addEventListener("submit", (e) => e.preventDefault());
      calc();
    }
  }

  /* ---------- Dynamic IDX listing (/listing/?id=…), any home in Arizona ---------- */
  const fmt = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? "");
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const shortMoney = (n) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M" : "$" + Math.round(n / 1000) + "K");
  function node(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fill(l) {
    const lang = CFG.lang;
    const title = l.title[lang];
    const loc = [l.address || l.area, l.cityName, "AZ " + (l.zip || "")].filter(Boolean).join(", ");
    document.title = title + " | " + l.cityName + ", AZ";
    $("propTitle").textContent = title;
    $("propLoc").textContent = loc;
    $("propPrice").textContent = money(l.price);
    $("propFacts").replaceChildren(...[
      [l.beds, T.d_beds], [l.baths, T.d_baths], [Number(l.sqft).toLocaleString("en-US"), T.sqft],
      [l.sqft ? "$" + Math.round(l.price / l.sqft) : "—", "/ " + T.sqft],
    ].map(([v, u]) => { const d = node("div"); d.append(node("b", null, String(v)), node("span", null, u)); return d; }));
    $("propDesc").textContent = l.description[lang] || "";
    $("propDescNote").hidden = !(l.remarksEnglishOnly && lang === "es");
    const days = Math.max(0, Math.round((Date.now() - new Date(l.listDate + "T12:00:00")) / 864e5));
    $("propDl").replaceChildren(...[
      [T.d_type, T["type_" + l.type] || l.type], [T.d_beds, l.beds], [T.d_baths, l.baths],
      [T.d_sqft, Number(l.sqft).toLocaleString("en-US") + " " + T.sqft],
      [T.d_lot, l.lotSqft ? Number(l.lotSqft).toLocaleString("en-US") + " " + T.sqft : "—"],
      [T.d_year, l.yearBuilt || "—"], [T.d_garage, l.garage || "—"], [T.d_pool, l.pool ? T.yes : T.no],
      [T.d_hoa, l.hoa ? money(l.hoa) + T.per_month : T.none], [T.d_area, l.area], [T.d_mls, l.id],
      [T.d_listed, l.listDate], [T.d_dom, days],
    ].map(([k, v]) => { const d = node("div"); d.append(node("dt", null, k), node("dd", null, String(v))); return d; }));

    const g = $("gallery");
    const pics = l.photos && l.photos.length ? l.photos : [l.image];
    g.dataset.images = JSON.stringify(pics);
    g.dataset.listingId = l.id;
    g.replaceChildren(...pics.slice(0, 3).map((src, i) => {
      const b = node("button");
      b.type = "button";
      b.dataset.lb = i;
      const img = node("img");
      img.src = src; img.alt = fmt(T.photo_of, { n: i + 1, title }); img.width = 1200; img.height = 800;
      b.append(img);
      if (i === Math.min(2, pics.length - 1)) b.append(node("span", "more", "📷 " + pics.length));
      return b;
    }));

    const mm = $("miniMap");
    mm.dataset.lat = l.lat; mm.dataset.lng = l.lng; mm.dataset.price = shortMoney(l.price);
    $("m-price").value = l.price;
    $("mortForm").dataset.extra = Math.round(l.price * 0.0065 / 12 + 150 + (l.hoa || 0));
    $("propCourtesy").textContent = fmt(T.courtesy, { office: l.office || "" }) + " · " + T.idx_disclaimer;

    const leadForm = document.querySelector("[data-lead-form]");
    if (leadForm) {
      leadForm.elements.listing_id.value = l.id;
      leadForm.elements.message.value = fmt(T.msg_property, { id: l.id });
    }
    const wa = document.querySelector("#dynContact .btn-wa");
    if (wa) wa.href = "https://wa.me/" + CFG.whatsapp + "?text=" + encodeURIComponent(fmt(T.wa_property, { title: title + " — " + loc, id: l.id }));
  }
  function hydrate() {
    const id = new URLSearchParams(location.search).get("id") || "";
    const loading = $("dynLoading");
    if (!/^[A-Za-z0-9-]{1,30}$/.test(id)) { loading.remove(); return markGone(); }
    fetch(CFG.listingEndpoint + "?id=" + encodeURIComponent(id), { headers: { Accept: "application/json" } })
      .then((r) => (r.status === 404 ? null : r.ok ? r.json() : Promise.reject(r.status)))
      .then((l) => {
        loading.remove();
        if (!l) return markGone();
        fill(l);
        init();
        applyStatus({ status: l.status });
        track("view_item", { listing_id: l.id });
      })
      .catch(() => { loading.textContent = T.load_error; });
  }

  if ($("dyn")) hydrate();
  else init();
})();
