/* Lizbeth Guzmán | REALTOR® — shared site behavior.
   No chatbots or automated replies: forms deliver leads to Lizbeth only. */
(function () {
  "use strict";

  const readJSON = (id) => {
    try { return JSON.parse(document.getElementById(id).textContent); } catch { return {}; }
  };
  const CFG = readJSON("site-config");
  const T = readJSON("i18n");
  window.SITE = { CFG, T };

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    sget(k) { try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  window.SITE.store = store;

  /* ---------- Analytics / Google Ads (loads only when IDs are configured) ---------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  const tr = CFG.tracking || {};
  const tagId = tr.ga4 || tr.googleAds;
  if (tagId) {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(tagId);
    document.head.appendChild(s);
    gtag("js", new Date());
    if (tr.ga4) gtag("config", tr.ga4);
    if (tr.googleAds) gtag("config", tr.googleAds);
  }
  function track(event, params) {
    const p = Object.assign({ language: CFG.lang, page_type: document.body.dataset.page }, params || {});
    window.dataLayer.push(Object.assign({ event }, p));
    if (tagId) {
      gtag("event", event, p);
      if (event === "generate_lead" && tr.googleAds && tr.adsLeadConversionLabel) {
        gtag("event", "conversion", { send_to: tr.googleAds + "/" + tr.adsLeadConversionLabel });
      }
    }
  }
  window.SITE.track = track;
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-track]");
    if (a) track(a.dataset.track, { link_url: a.href || "" });
  });

  /* ---------- Campaign attribution (UTM / gclid) kept for the session ---------- */
  const qs = new URLSearchParams(location.search);
  const attribution = store.sget("attr") || {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid"].forEach((k) => {
    if (qs.get(k)) attribution[k] = qs.get(k).slice(0, 150);
  });
  if (!attribution.landing) attribution.landing = location.pathname;
  if (!attribution.referrer && document.referrer && !document.referrer.startsWith(location.origin)) {
    attribution.referrer = document.referrer.slice(0, 200);
  }
  store.sset("attr", attribution);

  /* ---------- Header ---------- */
  const header = document.querySelector(".site-header");
  const onScroll = () => header && header.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const menuBtn = document.querySelector(".menu-btn");
  const nav = document.getElementById("nav");
  if (menuBtn && nav) {
    menuBtn.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      menuBtn.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) { nav.classList.remove("is-open"); menuBtn.setAttribute("aria-expanded", "false"); }
    });
  }

  /* ---------- Toast ---------- */
  const toastEl = document.getElementById("toast");
  let toastTimer;
  window.SITE.toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2200);
  };

  /* ---------- Favorites (saved in this browser) ---------- */
  const favs = new Set(store.get("favs", []));
  function paintFavs(root) {
    (root || document).querySelectorAll("[data-fav]").forEach((b) => b.setAttribute("aria-pressed", String(favs.has(b.dataset.fav))));
    document.querySelectorAll("[data-fav-count]").forEach((c) => { c.textContent = favs.size; c.hidden = !favs.size; });
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fav]");
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.fav;
    favs.has(id) ? favs.delete(id) : favs.add(id);
    store.set("favs", [...favs]);
    paintFavs();
    if (favs.has(id)) track("add_to_favorites", { listing_id: id });
  });
  paintFavs();
  window.SITE.paintFavs = paintFavs;
  window.SITE.favs = favs;

  /* ---------- Listing card (shared by search, saved homes) — DOM APIs only ---------- */
  const fmtS = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ""));
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  function node(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function linkFor(l) {
    return (l.url && l.url[CFG.lang]) || CFG.listingPage + "?id=" + encodeURIComponent(l.id);
  }
  function renderCard(l, i, opts) {
    const lang = CFG.lang;
    const art = node("article", "card");
    art.dataset.id = l.id;
    const media = node("div", "card-media");
    const img = node("img");
    img.src = l.image; img.alt = l.title[lang]; img.width = 640; img.height = 427;
    img.loading = i < 2 ? "eager" : "lazy"; img.decoding = "async";
    media.dataset.photos = JSON.stringify((l.photos && l.photos.length ? l.photos : [l.image]).slice(0, 6));
    const badges = node("div", "card-badges");
    badges.append(node("span", "badge" + (l.status === "Pending" ? " badge-pending" : ""), T["status_" + l.status] || l.status));
    if (l.status === "Active" && (Date.now() - new Date(l.listDate + "T12:00:00")) / 864e5 <= 7) badges.append(node("span", "badge badge-new", T.new));
    const fav = node("button", "fav-btn");
    fav.type = "button"; fav.dataset.fav = l.id; fav.setAttribute("aria-pressed", String(favs.has(l.id))); fav.setAttribute("aria-label", "♥ " + l.title[lang]);
    fav.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>';
    media.append(img, badges, fav);
    const body = node("div", "card-body");
    const facts = node("div", "card-facts");
    [[l.beds, T.bd], [l.baths, T.ba], [Number(l.sqft).toLocaleString("en-US"), T.sqft]].forEach(([v, u]) => {
      const sp = node("span"); sp.append(node("b", null, String(v)), document.createTextNode(" " + u)); facts.append(sp);
    });
    const h = node("h3", "card-title");
    const a = node("a", null, l.title[lang]); a.href = linkFor(l);
    h.append(a);
    body.append(
      node("div", "card-price", money(l.price)), facts, h,
      node("div", "card-loc", [l.address || l.area, l.cityName, "AZ " + (l.zip || "")].filter(Boolean).join(", ")),
      node("div", "card-courtesy", fmtS(T.courtesy, { office: l.office || "" }))
    );
    art.append(media, body);
    if (opts && opts.onHover) {
      art.addEventListener("mouseenter", () => opts.onHover(l.id, true));
      art.addEventListener("mouseleave", () => opts.onHover(l.id, false));
    }
    return art;
  }
  window.SITE.renderCard = renderCard;
  window.SITE.linkFor = linkFor;

  /* ---------- Card photo carousel ---------- */
  const fmtT = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ""));
  function enhanceCards(root) {
    (root || document).querySelectorAll(".card-media[data-photos]:not([data-ready])").forEach((media) => {
      let list;
      try { list = JSON.parse(media.dataset.photos); } catch { list = []; }
      media.dataset.ready = "1";
      if (list.length < 2) return;
      const img = media.querySelector("img");
      let i = 0;
      const dots = document.createElement("div");
      dots.className = "card-dots";
      list.forEach(() => dots.appendChild(document.createElement("span")));
      const paint = () => {
        dots.querySelectorAll("span").forEach((d, k) => d.classList.toggle("on", k === i));
        img.alt = img.alt.replace(/ · .*$/, "") + (i ? " · " + fmtT(T.photo_n, { n: i + 1, total: list.length }) : "");
      };
      const go = (step) => {
        i = (i + step + list.length) % list.length;
        img.removeAttribute("srcset");
        img.src = list[i];
        paint();
        if (i === 1) list.slice(2).forEach((u) => { new Image().src = u; });
      };
      [["prev", -1, "prev_photo", "M15 6l-6 6 6 6"], ["next", 1, "next_photo", "M9 6l6 6-6 6"]].forEach(([cls, step, label, d]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "card-nav " + cls;
        b.setAttribute("aria-label", T[label]);
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="' + d + '"/></svg>';
        b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); go(step); });
        media.appendChild(b);
      });
      let x0 = null;
      media.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
      media.addEventListener("touchend", (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 35) go(dx < 0 ? 1 : -1);
        x0 = null;
      });
      media.appendChild(dots);
      paint();
    });
  }
  enhanceCards();
  window.SITE.enhanceCards = enhanceCards;

  /* ---------- Showing date chips (next 7 days) ---------- */
  document.querySelectorAll("[data-date-chips]").forEach((wrap) => {
    const locale = wrap.dataset.lang === "es" ? "es-US" : "en-US";
    const d = new Date();
    for (let i = 1; i <= 7; i++) {
      d.setDate(d.getDate() + 1);
      const iso = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
      const label = document.createElement("label");
      label.className = "chip date-chip";
      const input = document.createElement("input");
      input.type = "radio"; input.name = "tour_date"; input.value = iso;
      if (i === 1) input.checked = true;
      const span = document.createElement("span");
      const small = document.createElement("small");
      small.textContent = d.toLocaleDateString(locale, { weekday: "short" });
      const b = document.createElement("b");
      b.textContent = d.getDate();
      const m = document.createElement("small");
      m.textContent = d.toLocaleDateString(locale, { month: "short" });
      span.append(small, b, m);
      label.append(input, span);
      wrap.appendChild(label);
    }
  });

  /* ---------- Lead forms ---------- */
  const startedAt = Date.now();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  document.querySelectorAll("[data-lead-form]").forEach((form) => {
    const msg = form.querySelector(".form-msg");
    const btn = form.querySelector('button[type="submit"]');
    const showError = (text) => {
      msg.className = "form-msg is-error";
      msg.textContent = text;
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.className = "form-msg";
      const data = Object.fromEntries(new FormData(form).entries());
      const name = form.elements.name;
      const phone = form.elements.phone;
      const email = form.elements.email;
      [name, phone, email].forEach((el) => el && el.removeAttribute("aria-invalid"));

      if (!data.name || data.name.trim().length < 2) { name.setAttribute("aria-invalid", "true"); name.focus(); return; }
      const hasPhone = (data.phone || "").replace(/\D/g, "").length >= 10;
      const hasEmail = EMAIL_RE.test(data.email || "");
      if (!hasPhone && !hasEmail) {
        phone.setAttribute("aria-invalid", "true");
        showError(T.f_need_contact);
        phone.focus();
        return;
      }
      if (data.email && !hasEmail) { email.setAttribute("aria-invalid", "true"); email.focus(); return; }
      const address = form.elements.address;
      if (address && !data.address.trim()) { address.setAttribute("aria-invalid", "true"); address.focus(); return; }
      const consent = form.elements.consent;
      if (consent && !consent.checked) { consent.focus(); consent.reportValidity && consent.reportValidity(); return; }

      if (form.elements.listing_ids) data.listing_ids = [...favs].join(",");
      const payload = Object.assign({}, data, {
        page: location.pathname + location.search,
        elapsed_ms: Date.now() - startedAt,
        attribution: store.sget("attr") || {},
      });

      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = T.f_sending;
      try {
        const res = await fetch(CFG.leadEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        track("generate_lead", { form_type: data.form_type, listing_id: data.listing_id || undefined });
        location.assign(CFG.thanks);
      } catch (err) {
        showError(T.f_error);
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });

  /* ---------- WhatsApp share (property pages) ---------- */
  document.querySelectorAll("[data-wa-share]").forEach((a) => {
    a.href = "https://wa.me/?text=" + encodeURIComponent(document.title + "\n" + location.href);
  });

  /* ---------- Language suggestion (visitor's browser prefers the other language) ---------- */
  (function () {
    const sw = document.querySelector(".lang-switch");
    const pref = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    const wants = pref.toLowerCase().startsWith("es") ? "es" : "en";
    if (!sw || wants === CFG.lang || store.get("langAsked", false)) return;
    const bar = node("div", "lang-bar");
    bar.setAttribute("role", "note");
    bar.lang = wants;
    const go = node("a", "btn btn-gold btn-sm", T.lang_go);
    go.href = sw.href;
    go.addEventListener("click", () => { store.set("langAsked", true); track("lang_suggest_accept", {}); });
    const no = node("button", "linkbtn", T.lang_no);
    no.type = "button";
    no.addEventListener("click", () => { store.set("langAsked", true); bar.remove(); });
    bar.append(node("span", null, T.lang_suggest), go, no);
    document.body.prepend(bar);
  })();

  /* ---------- Affordability calculator (buyer guide) ---------- */
  const af = document.getElementById("affordForm");
  if (af) {
    const calc = () => {
      const v = (n) => Math.max(0, +af.elements[n].value || 0);
      const monthly = v("income") / 12;
      const budget = Math.max(0, Math.min(monthly * 0.31, monthly * 0.36 - v("debts")));
      const r = v("rate") / 100 / 12, n = 360;
      const f = r ? r / (1 - Math.pow(1 + r, -n)) : 1 / n;
      // payment = (price - down)·f + price·0.65%/12 (tax) + $150 (insurance)  ->  solve for price
      const price = Math.max(0, (budget - 150 + v("down") * f) / (f + 0.0065 / 12));
      const rounded = Math.floor(price / 5000) * 5000;
      document.getElementById("afPrice").textContent = money(rounded);
      document.getElementById("afPay").textContent = money(budget) + (T.per_month || "");
      document.getElementById("afCta").href = af.dataset.homes + "?max=" + rounded;
    };
    af.addEventListener("input", calc);
    af.addEventListener("submit", (e) => e.preventDefault());
    calc();
  }

  /* ---------- Home page: newest homes around Phoenix, live from the IDX (hidden if not connected) ---------- */
  const featured = document.getElementById("featuredCards");
  if (featured && featured.dataset.live && CFG.listingsMode === "api") {
    fetch(CFG.searchEndpoint + "?bbox=33.2,-112.65,33.9,-111.5&sort=new", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = ((d && d.listings) || []).filter((l) => l.status === "Active").slice(0, 6);
        if (!list.length) return;
        list.forEach((l, i) => featured.append(renderCard(l, i)));
        window.SITE.enhanceCards && window.SITE.enhanceCards(featured);
        document.getElementById("featured").hidden = false;
      })
      .catch(() => { /* IDX not connected: keep the section hidden */ });
  }

  /* ---------- Saved homes page ---------- */
  const favList = document.getElementById("favsList");
  if (favList) {
    const ids = [...favs];
    const show = (list) => {
      favList.replaceChildren();
      if (!list.length) { favList.append(node("p", "lead", T.favs_empty)); return; }
      list.forEach((l, i) => favList.append(renderCard(l, i)));
      window.SITE.enhanceCards && window.SITE.enhanceCards(favList);
      document.getElementById("favsSend").hidden = false;
    };
    if (!ids.length) show([]);
    else fetch(CFG.listingsSource).then((r) => r.json()).then((d) => {
      const found = (d.listings || []).filter((l) => favs.has(l.id));
      const missing = ids.filter((id) => !found.some((l) => l.id === id));
      if (CFG.listingsMode !== "api" || !missing.length) return show(found);
      return Promise.all(missing.slice(0, 30).map((id) =>
        fetch(CFG.listingEndpoint + "?id=" + encodeURIComponent(id)).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      )).then((more) => show(found.concat(more.filter(Boolean))));
    }).catch(() => show([]));
  }

  /* ---------- Installable app (service worker) ---------- */
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  /* ---------- Share ---------- */
  document.querySelectorAll("[data-share]").forEach((b) => {
    b.addEventListener("click", async () => {
      const data = { title: document.title, url: location.href };
      try {
        if (navigator.share) { await navigator.share(data); }
        else { await navigator.clipboard.writeText(location.href); window.SITE.toast(T.copied); }
        track("share", {});
      } catch { /* dismissed */ }
    });
  });
})();
