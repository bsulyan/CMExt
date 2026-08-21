/*
 * price-nocountry.js — Calcul des prix du BulkListing SANS filtre de pays.
 *
 * A coller dans la console de la page BulkListing. Autonome : ne depend pas de
 * l'extension (elle peut etre cassee sur l'onglet), il reprend la meme lecture
 * des offres (marketdata.js) et le meme moteur de prix (pricing.js), a une
 * difference pres : la page produit est demandee avec le seul filtre de langue,
 * sans `sellerCountry`. Les offres etrangeres entrent donc dans le calcul.
 *
 * Traite les lignes dont la quantite est > 0, une par une, avec une pause
 * aleatoire entre deux appels reseau. `cmextStop()` interrompt proprement.
 *
 * Une verification anti-robot arrete tout : elle ne se resout pas depuis un
 * fetch, il faut ouvrir la page produit dans un onglet et la valider a la main.
 */
(function () {
  "use strict";

  var CFG = {
    // false = recalcule aussi les lignes qui portent deja un prix.
    onlyEmptyPrice: true,
    // Salves d'offres chargees au maximum par produit (tri par prix croissant).
    maxPages: 3,
    // Memes seuils que les reglages de l'extension.
    minQty: 4,
    minSellers: 2,
    soloSellerQty: 10,
    outlierRatio: 0.5,
    maxUpgradeRanks: 0,
    minOffers: 3,
    undercut: 0.01
  };

  var COEF = { MT: 1, NM: 1, EX: 0.9, GD: 0.8, LP: 0.7, PL: 0.6, PO: 0.5 };
  var TIER = { MT: 0, NM: 0, EX: 1, GD: 2, LP: 3, PL: 4, PO: 5 };
  var COND_BY_ID = { 1: "MT", 2: "NM", 3: "EX", 4: "GD", 5: "LP", 6: "PL", 7: "PO" };
  var SPECIAL_BY_X = { 0: "isFirstEd", 32: "isSigned", 64: "isAltered" };
  var FLOOR = 0.02;
  var BASE = "/" + (location.pathname.split("/")[1] || "fr") + "/YuGiOh";
  var CHALLENGE = /cf-browser-verification|challenge-platform|__cf_chl|cf_chl_opt|cf-turnstile|<title>\s*Just a moment/i;

  var stopped = false;
  window.cmextStop = function () { stopped = true; console.log("[CMExt] arret demande"); };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(a, b) { return Math.floor(a + Math.random() * (b - a)); }
  function money(v) { return Number(v).toFixed(2); }

  // ---- Lecture des offres ---------------------------------------------------
  function parsePrice(text) {
    var s = String(text == null ? "" : text).replace(/[^\d.,]/g, "");
    if (!s) return NaN;
    if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1) s = s.replace(/\./g, "");
    s = s.replace(",", ".");
    var v = parseFloat(s);
    return isNaN(v) ? NaN : v;
  }

  function spritePos(el) {
    var m = /background-position:\s*(-?\d+)px\s+(-?\d+)px/.exec(el.getAttribute("style") || "");
    return m ? { x: Math.abs(parseInt(m[1], 10)), y: Math.abs(parseInt(m[2], 10)) } : null;
  }

  function txt(root, sel) {
    var el = root.querySelector(sel);
    return el ? el.textContent.trim() : "";
  }

  function parseArticleRow(row) {
    // Nos propres annonces portent le bouton "Modifier" : on ne se sous-cote pas.
    if (row.querySelector('a[data-modal*="Article_EditArticleModal"]')) return null;
    var condEl = row.querySelector(".article-condition");
    var m = condEl && /condition-([a-z]{2})/i.exec(condEl.className);
    if (!m) return null;

    var offer = {
      condition: m[1].toUpperCase(),
      language: null,
      isFirstEd: false,
      isSigned: false,
      isAltered: false,
      price: parsePrice(txt(row, ".col-offer .price-container .color-primary")),
      quantity: parseInt(txt(row, ".col-offer .amount-container .item-count"), 10) || 1,
      seller: txt(row, ".seller-name a")
    };

    var icons = row.querySelectorAll(".product-attributes span.icon");
    for (var i = 0; i < icons.length; i++) {
      var p = spritePos(icons[i]);
      if (!p) continue;
      if (p.y === 0 && p.x > 0) offer.language = p.x / 16;
      else if (p.y === 16 && SPECIAL_BY_X[p.x]) offer[SPECIAL_BY_X[p.x]] = true;
    }
    if (!(offer.price > 0) || offer.language === null) return null;
    return offer;
  }

  function extractOffers(root) {
    return Array.prototype.slice.call(root.querySelectorAll('[id^="articleRow"]'))
      .map(parseArticleRow).filter(Boolean);
  }

  // ---- Reseau ---------------------------------------------------------------
  function challenge() {
    var e = new Error("cloudflare-challenge");
    e.cmextChallenge = true;
    return e;
  }

  function fetchDoc(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (res) {
      return res.text().then(function (html) {
        if (res.status === 403 || res.status === 429 || res.status === 503 ||
            res.headers.get("cf-mitigated") || CHALLENGE.test(html)) throw challenge();
        if (!res.ok) throw new Error("HTTP " + res.status);
        return new DOMParser().parseFromString(html, "text/html");
      });
    });
  }

  function decodeB64(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function loadMore(ctx, page) {
    var fd = new FormData();
    fd.append("__cmtkn", ctx.token);
    fd.append("page", String(page));
    fd.append("filterSettings", ctx.filters);
    fd.append("idProduct", String(ctx.idProduct));
    return fetch(BASE + "/AjaxAction/Product_LoadMoreArticles", {
      method: "POST", body: fd, credentials: "same-origin"
    }).then(function (res) {
      return res.text().then(function (body) {
        if (res.status === 403 || res.status === 429 || res.status === 503 ||
            res.headers.get("cf-mitigated") || CHALLENGE.test(body)) throw challenge();
        if (!res.ok) throw new Error("HTTP " + res.status + " (LoadMoreArticles)");
        return body;
      });
    }).then(function (xml) {
      var doc = new DOMParser().parseFromString(xml, "text/xml");
      var rowsEl = doc.querySelector("rows"), pageEl = doc.querySelector("newPage");
      var newPage = pageEl ? parseInt(pageEl.textContent, 10) : -1;
      var offers = [];
      if (rowsEl && rowsEl.textContent.trim()) {
        var frag = new DOMParser().parseFromString(
          "<div>" + decodeB64(rowsEl.textContent.trim()) + "</div>", "text/html");
        offers = extractOffers(frag);
      }
      return { offers: offers, newPage: isNaN(newPage) ? -1 : newPage };
    });
  }

  // Page produit filtree sur la seule langue : PAS de sellerCountry, c'est tout
  // l'objet de ce script.
  function fetchOffers(productPath, idProduct, language, enough) {
    var url = String(productPath).split("?")[0];
    if (language) url += "?language=" + encodeURIComponent(language);

    return fetchDoc(url).then(function (doc) {
      var offers = extractOffers(doc);
      var form = doc.querySelector('form[data-ajax-action="Product_LoadMoreArticles"]');
      if (!form) return offers;

      function field(n) {
        var el = form.querySelector('input[name="' + n + '"]');
        return el ? el.value : "";
      }
      var ctx = { token: field("__cmtkn"), filters: field("filterSettings") || "[]",
                  idProduct: idProduct || field("idProduct") };
      var page = parseInt(field("page"), 10);
      if (isNaN(page)) page = 1;
      if (!ctx.token || !ctx.idProduct) return offers;

      var loaded = 0;
      function next() {
        if (page < 0 || loaded >= CFG.maxPages || enough(offers)) return offers;
        loaded++;
        return sleep(rand(400, 900))
          .then(function () { return loadMore(ctx, page); })
          .then(function (res) {
            offers = offers.concat(res.offers);
            page = res.newPage;
            return next();
          });
      }
      return Promise.resolve(next());
    });
  }

  // ---- Moteur de prix -------------------------------------------------------
  function tier(c) { var t = TIER[String(c || "").toUpperCase()]; return typeof t === "number" ? t : null; }
  function coef(c) { var k = COEF[String(c || "").toUpperCase()]; return typeof k === "number" ? k : null; }
  function floorCent(v) { return Math.floor(v * 100 + 1e-6) / 100; }
  function same(a, b) { return !!a === !!b; }
  function sortBy(list, key) { return list.slice().sort(function (a, b) { return a[key] - b[key]; }); }

  function isComparable(o, t) {
    if (!(o.price > 0) || tier(o.condition) === null) return false;
    return Number(o.language) === Number(t.language) &&
      same(o.isFirstEd, t.isFirstEd) && same(o.isSigned, t.isSigned) && same(o.isAltered, t.isAltered);
  }

  function selectMarket(offers, key) {
    var sorted = sortBy(offers, key), qty = 0, sellers = {}, count = 0, used = [];
    for (var i = 0; i < sorted.length; i++) {
      var o = sorted[i], q = o.quantity > 0 ? o.quantity : 1;
      qty += q; used.push(o);
      var k = o.seller || "?" + i;
      if (!sellers[k]) { sellers[k] = 0; count++; }
      sellers[k] += q;
      var solo = count === 1 && sellers[k] >= CFG.soloSellerQty;
      if (qty >= CFG.minQty && (count >= CFG.minSellers || solo)) {
        return { priceNM: o[key], qty: qty, sellers: count, used: used };
      }
    }
    return null;
  }

  function cheapestSane(offers, reference, key) {
    var min = reference * CFG.outlierRatio, sorted = sortBy(offers, key);
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i][key] >= min) return { value: sorted[i][key], skipped: i };
    }
    return { value: reference, skipped: sorted.length };
  }

  function ceilingFromBetter(offers, targetCondition) {
    var t = tier(targetCondition);
    var better = offers.filter(function (o) { return tier(o.condition) <= t; });
    if (!better.length) return null;
    var ref = selectMarket(better, "price");
    return ref ? cheapestSane(better, ref.priceNM, "price").value : null;
  }

  function suggest(raw, target) {
    if (coef(target.condition) === null) return { price: null, reason: "etat inconnu" };
    var matching = (raw || []).filter(function (o) { return isComparable(o, target); });
    if (!matching.length) return { price: null, reason: "aucune offre comparable", comparable: 0 };

    var comparable = matching.filter(function (o) {
      return tier(o.condition) - tier(target.condition) <= CFG.maxUpgradeRanks;
    }).map(function (o) {
      return Object.assign({}, o, { priceNM: o.price / coef(o.condition) });
    });
    var worse = matching.length - comparable.length;
    if (!comparable.length) {
      return { price: null, reason: "que des etats inferieurs", comparable: 0, worse: worse };
    }

    var ref = selectMarket(comparable, "priceNM");
    if (!ref) return { price: null, reason: "stock insuffisant", comparable: comparable.length, worse: worse };

    var market = cheapestSane(comparable, ref.priceNM, "priceNM");
    var price = floorCent(floorCent(market.value * coef(target.condition)) - CFG.undercut);

    var cappedBy = null;
    var ceiling = ceilingFromBetter(comparable, target.condition);
    if (ceiling !== null && price >= ceiling) {
      cappedBy = ceiling;
      price = floorCent(ceiling - CFG.undercut);
    }
    if (price < FLOOR) price = FLOOR;

    return {
      price: price, comparable: comparable.length, worse: worse, skipped: market.skipped,
      qty: ref.qty, sellers: ref.sellers, cappedBy: cappedBy,
      weak: comparable.length < CFG.minOffers,
      used: ref.used
    };
  }

  // ---- Grille ---------------------------------------------------------------
  function fieldIn(tr, n) { return tr.querySelector('[name^="' + n + '["]'); }

  function gridRows() {
    var form = document.getElementById("BulkListingForm") || document;
    return Array.prototype.slice.call(form.querySelectorAll("tr")).filter(function (tr) {
      return !!fieldIn(tr, "amount");
    });
  }

  function readRow(tr) {
    var link = tr.querySelector('.col-product a[href*="/Products/"]');
    var idProduct = fieldIn(tr, "idProduct");
    var amount = fieldIn(tr, "amount");
    var price = fieldIn(tr, "price");
    var language = fieldIn(tr, "idLanguage");
    var condition = fieldIn(tr, "idCondition");
    if (!link || !idProduct || !amount || !price || !language || !condition) return null;
    return {
      tr: tr, href: link.getAttribute("href"), name: link.textContent.trim(),
      idProduct: idProduct.value, amount: amount, price: price,
      target: {
        condition: COND_BY_ID[parseInt(condition.value, 10)],
        language: parseInt(language.value, 10),
        isSigned: !!(fieldIn(tr, "isSigned") || {}).checked,
        isFirstEd: !!(fieldIn(tr, "isFirstEd") || {}).checked,
        isAltered: false
      }
    };
  }

  function applyPrice(row, result) {
    if (result.price === null) {
      row.price.title = "Pas de prix : " + result.reason;
      return;
    }
    row.price.value = money(result.price);
    row.price.dispatchEvent(new Event("input", { bubbles: true }));
    row.price.dispatchEvent(new Event("change", { bubbles: true }));
    row.price.title = "sans filtre pays — " + result.comparable + " offres comparables, " +
      result.qty + " ex. chez " + result.sellers + " vendeurs" +
      (result.cappedBy !== null ? ", plafonne a " + money(result.cappedBy) : "") +
      (result.weak ? " (peu d'offres)" : "");
  }

  // ---- Boucle ---------------------------------------------------------------
  var todo = gridRows().map(readRow).filter(Boolean).filter(function (r) {
    if ((parseInt(r.amount.value, 10) || 0) <= 0) return false;
    return CFG.onlyEmptyPrice ? !r.price.value : true;
  });

  console.log("[CMExt] " + todo.length + " lignes a chiffrer, sans filtre de pays. " +
    "cmextStop() pour interrompre.");

  var done = 0, filled = 0;

  function step(i) {
    if (stopped || i >= todo.length) {
      console.log("[CMExt] termine : " + done + " lignes traitees, " + filled + " prix poses" +
        (stopped ? " (interrompu)" : ""));
      return Promise.resolve({ done: done, filled: filled, stopped: stopped });
    }
    var row = todo[i];
    console.log("[" + (i + 1) + "/" + todo.length + "] " + row.name);

    return fetchOffers(row.href, row.idProduct, row.target.language, function (offers) {
      // Tri par prix croissant : des qu'un prix sort, les salves suivantes
      // (plus cheres) ne peuvent plus le changer.
      return suggest(offers, row.target).price !== null;
    }).then(function (offers) {
      var result = suggest(offers, row.target);
      applyPrice(row, result);
      done++;
      if (result.price !== null) { filled++; console.log("   -> " + money(result.price)); }
      else console.log("   -> pas de prix (" + result.reason + ")");
      return sleep(rand(800, 1600)).then(function () { return step(i + 1); });
    }).catch(function (e) {
      if (e && e.cmextChallenge) {
        console.warn("[CMExt] verification anti-robot. Ouvre " + row.href +
          " dans un onglet, valide-la, puis relance le script. " +
          "NE RECHARGE PAS cette page.");
        return { done: done, filled: filled, challenge: row.href };
      }
      console.warn("   erreur :", e && e.message || e);
      done++;
      return sleep(rand(800, 1600)).then(function () { return step(i + 1); });
    });
  }

  return step(0);
})();
