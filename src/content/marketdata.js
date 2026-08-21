/*
 * marketdata.js — Recuperation des offres concurrentes d'un produit.
 *
 * Expose `CMExt.Market` :
 *   - getOffers()   : offres d'un produit (cache local, puis reseau)
 *   - fetchOffers() : va chercher les offres sur la page produit
 *   - parsePrice()  : "1.234,56 EUR" -> 1234.56
 *   - clearCache()
 *
 * IMPORTANT : aucun appel reseau automatique. Tout part d'un clic utilisateur
 * (bouton de calcul de prix), avec des delais entre les requetes.
 *
 * La page produit affiche une premiere salve d'offres triees par prix
 * croissant, puis charge la suite via `AjaxAction/Product_LoadMoreArticles`
 * (reponse XML dont le champ <rows> est du HTML encode en base64). Comme le tri
 * est croissant, on s'arrete des qu'on a de quoi decider : les pages suivantes
 * ne contiennent que des offres plus cheres.
 *
 * Lecture d'une ligne d'offre (`div#articleRow{id}.article-row`) :
 *   - etat     : <a class="article-condition condition-nm">
 *   - langue   : icone sprite, ligne y=0, idLanguage = x / 16
 *                (16=Anglais, 32=Francais, 48=Allemand, 64=Espagnol,
 *                 80=Italien, 128=Portugais)
 *   - extras   : icones sprite `st_SpecialIcon`, ligne y=16
 *                (x=0 First Edition, x=32 Signee, x=64 Alteree)
 *   - prix     : .col-offer .price-container .color-primary
 *   - quantite : .col-offer .amount-container .item-count
 *   - vendeur  : .seller-name a
 *   - nos annonces portent un lien vers Article_EditArticleModal : on les retire.
 */
(function () {
  "use strict";

  if (!window.CMExt || window.CMExt.Market) return;
  var CMExt = window.CMExt;

  var SITE_LANG = location.pathname.split("/")[1] || "fr";
  var BASE = "/" + SITE_LANG + "/YuGiOh";
  var CACHE_KEY = "cmext.offercache";
  // Au-dela, on jette les entrees les plus anciennes : la base reste petite.
  var MAX_CACHE_ENTRIES = 400;

  // Position horizontale de l'icone d'extra -> attribut correspondant.
  var SPECIAL_BY_X = { 0: "isFirstEd", 32: "isSigned", 64: "isAltered" };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(min, max) { return Math.floor(min + Math.random() * (max - min)); }

  // ---- Helpers de lecture ---------------------------------------------------

  // Accepte "0,49 EUR", "1.234,56 EUR" et "1.50".
  function parsePrice(text) {
    var s = String(text == null ? "" : text).replace(/[^\d.,]/g, "");
    if (!s) return NaN;
    // Les deux separateurs presents : le point est un separateur de milliers.
    if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1) s = s.replace(/\./g, "");
    s = s.replace(",", ".");
    var value = parseFloat(s);
    return isNaN(value) ? NaN : value;
  }

  function spritePos(el) {
    var m = /background-position:\s*(-?\d+)px\s+(-?\d+)px/.exec(el.getAttribute("style") || "");
    if (!m) return null;
    return { x: Math.abs(parseInt(m[1], 10)), y: Math.abs(parseInt(m[2], 10)) };
  }

  function textOf(root, selector) {
    var el = root.querySelector(selector);
    return el ? el.textContent.trim() : "";
  }

  // ---- Parsing d'une ligne d'offre ------------------------------------------
  function parseArticleRow(row) {
    // Nos propres annonces portent le bouton "Modifier" : elles ne sont pas de
    // la concurrence, on ne se sous-cote pas soi-meme.
    if (row.querySelector('a[data-modal*="Article_EditArticleModal"]')) return null;

    var condEl = row.querySelector(".article-condition");
    var condMatch = condEl && /condition-([a-z]{2})/i.exec(condEl.className);
    if (!condMatch) return null;

    var offer = {
      idArticle: row.id.replace("articleRow", ""),
      condition: condMatch[1].toUpperCase(),
      language: null,
      isFirstEd: false,
      isSigned: false,
      isAltered: false,
      price: parsePrice(textOf(row, ".col-offer .price-container .color-primary")),
      quantity: parseInt(textOf(row, ".col-offer .amount-container .item-count"), 10) || 1,
      seller: textOf(row, ".seller-name a")
    };

    var icons = row.querySelectorAll(".product-attributes span.icon");
    for (var i = 0; i < icons.length; i++) {
      var pos = spritePos(icons[i]);
      if (!pos) continue;
      if (pos.y === 0 && pos.x > 0) offer.language = pos.x / 16;
      else if (pos.y === 16 && SPECIAL_BY_X[pos.x]) offer[SPECIAL_BY_X[pos.x]] = true;
    }

    if (!(offer.price > 0) || offer.language === null) return null;
    return offer;
  }

  function extractOffers(root) {
    return Array.prototype.slice.call(root.querySelectorAll('[id^="articleRow"]'))
      .map(parseArticleRow)
      .filter(Boolean);
  }

  // ---- Reseau ---------------------------------------------------------------
  // On lit le corps avant de decider : une verification anti-robot arrive
  // parfois en HTTP 200, seul le contenu la trahit.
  function fetchDoc(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (res) {
      return res.text().then(function (html) {
        if (CMExt.isChallenge(res, html)) {
          CMExt.warn("verification anti-robot sur", url, "— offres non recuperees");
          throw CMExt.challengeError();
        }
        if (!res.ok) throw new Error("HTTP " + res.status + " sur " + url);
        return new DOMParser().parseFromString(html, "text/html");
      });
    });
  }

  function decodeBase64Utf8(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  // Charge la salve d'offres suivante. Renvoie { offers, newPage } ou newPage
  // vaut -1 quand il n'y a plus rien a charger.
  function loadMore(ctx, page) {
    var fd = new FormData();
    fd.append("__cmtkn", ctx.token);
    fd.append("page", String(page));
    fd.append("filterSettings", ctx.filters);
    fd.append("idProduct", String(ctx.idProduct));

    return fetch(BASE + "/AjaxAction/Product_LoadMoreArticles", {
      method: "POST",
      body: fd,
      credentials: "same-origin"
    }).then(function (res) {
      return res.text().then(function (body) {
        if (CMExt.isChallenge(res, body)) {
          CMExt.warn("verification anti-robot sur LoadMoreArticles — salve abandonnee");
          throw CMExt.challengeError();
        }
        if (!res.ok) throw new Error("HTTP " + res.status + " (LoadMoreArticles)");
        return body;
      });
    }).then(function (xml) {
      var doc = new DOMParser().parseFromString(xml, "text/xml");
      var rowsEl = doc.querySelector("rows");
      var pageEl = doc.querySelector("newPage");
      var newPage = pageEl ? parseInt(pageEl.textContent, 10) : -1;
      var offers = [];
      if (rowsEl && rowsEl.textContent.trim()) {
        var html = decodeBase64Utf8(rowsEl.textContent.trim());
        var frag = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
        offers = extractOffers(frag);
      }
      return { offers: offers, newPage: isNaN(newPage) ? -1 : newPage };
    });
  }

  /*
   * Recupere les offres d'un produit.
   *
   * productPath : chemin de la page produit. La query string d'origine est
   *               jetee, on pose la notre : `language` et `sellerCountry`
   *               filtrent cote serveur, ce qui donne une liste complete dans
   *               notre langue des le premier chargement au lieu d'une poignee
   *               d'offres noyees dans toutes les langues.
   * opts        : { language, sellerCountry, enough(offers) -> bool, maxPages }
   *               `enough` est reevalue apres chaque salve : des qu'il repond
   *               vrai, on arrete de charger (le tri par prix croissant garantit
   *               que la suite ne peut plus changer la decision).
   *
   * Renvoie { offers, complete }. `complete` est faux quand on s'est arrete en
   * cours de route : la liste ne vaut alors que pour la question posee, ce dont
   * le cache doit tenir compte.
   */
  // Chemin produit + nos filtres. On ne touche pas a l'etat de condition : les
  // etats moins bons servent au calcul une fois ramenes en NM-equivalent.
  function filteredUrl(productPath, opts) {
    var params = [];
    if (opts.language) params.push("language=" + encodeURIComponent(opts.language));
    if (opts.sellerCountry) params.push("sellerCountry=" + encodeURIComponent(opts.sellerCountry));
    var url = String(productPath).split("?")[0];
    return params.length ? url + "?" + params.join("&") : url;
  }

  function fetchOffers(productPath, idProduct, opts) {
    opts = opts || {};
    var maxPages = opts.maxPages || 3;
    var url = filteredUrl(productPath, opts);

    return fetchDoc(url).then(function (doc) {
      var offers = extractOffers(doc);
      var form = doc.querySelector('form[data-ajax-action="Product_LoadMoreArticles"]');
      if (!form) return { offers: offers, complete: true };

      function field(name) {
        var el = form.querySelector('input[name="' + name + '"]');
        return el ? el.value : "";
      }
      var ctx = {
        token: field("__cmtkn"),
        filters: field("filterSettings") || "[]",
        idProduct: idProduct || field("idProduct")
      };
      var page = parseInt(field("page"), 10);
      if (isNaN(page)) page = 1;
      if (!ctx.token || !ctx.idProduct) return { offers: offers, complete: false };

      var loaded = 0;
      function next() {
        // page < 0 : CardMarket signale qu'il n'y a plus rien a charger.
        if (page < 0) return { offers: offers, complete: true };
        if (loaded >= maxPages) return { offers: offers, complete: false };
        if (opts.enough && opts.enough(offers)) return { offers: offers, complete: false };
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

  // ---- Cache local ----------------------------------------------------------
  function readCache() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(CACHE_KEY, function (data) {
        resolve((data && data[CACHE_KEY]) || {});
      });
    });
  }

  function writeCache(cache) {
    // Purge LRU : on garde les entrees les plus recemment ecrites.
    var keys = Object.keys(cache);
    if (keys.length > MAX_CACHE_ENTRIES) {
      keys.sort(function (a, b) { return cache[b].at - cache[a].at; })
        .slice(MAX_CACHE_ENTRIES)
        .forEach(function (k) { delete cache[k]; });
    }
    return new Promise(function (resolve) {
      var payload = {};
      payload[CACHE_KEY] = cache;
      chrome.storage.local.set(payload, function () { resolve(cache); });
    });
  }

  function clearCache() {
    return new Promise(function (resolve) {
      chrome.storage.local.remove(CACHE_KEY, resolve);
    });
  }

  /*
   * Offres d'un produit, cache d'abord.
   * opts : { ttlMs, language, sellerCountry, enough, maxPages, force, cacheKey }
   * Renvoie { offers, fromCache, at }.
   *
   * La cle de cache porte les filtres : une liste recuperee en francais ne dit
   * rien des offres allemandes.
   *
   * `cacheKey` remplace l'identifiant produit dans la cle. Les lignes de stock
   * ne portent pas d'`idProduct`, seulement un lien : sans cette porte de
   * sortie, elles partageraient toutes la meme cle et le cache renverrait les
   * offres d'une autre carte. On passe alors le chemin du produit, qui est
   * unique, et `idProduct` reste nul — la page produit le fournira elle-meme.
   *
   * Une entree de cache incomplete (chargement interrompu des qu'on en savait
   * assez) ne sert que si elle repond a la question posee : sinon on relance la
   * recuperation, sans quoi on annoncerait "donnees insuffisantes" alors qu'on
   * a simplement arrete de charger trop tot la fois precedente.
   */
  function getOffers(idProduct, productPath, opts) {
    opts = opts || {};
    var ttl = opts.ttlMs || 24 * 3600 * 1000;
    var key = [opts.cacheKey || idProduct, opts.language || "all", opts.sellerCountry || "all"].join("/");

    return readCache().then(function (cache) {
      var hit = cache[key];
      // Une entree vide ne vaut pas d'etre gardee : soit le produit n'a
      // vraiment aucune offre (rare, une requete de plus ne coute rien), soit
      // la recuperation avait echoue. Relire coute moins cher que d'annoncer
      // pendant 24 h "donnees insuffisantes" sur une page qui, elle, en a.
      var usable = !opts.force && hit && (hit.offers || []).length > 0 &&
        Date.now() - hit.at < ttl &&
        (hit.complete || !opts.enough || opts.enough(hit.offers || []));
      if (usable) {
        return { offers: hit.offers || [], fromCache: true, at: hit.at };
      }
      return fetchOffers(productPath, idProduct, opts).then(function (res) {
        var at = Date.now();
        if (!res.offers.length) {
          // Rien a memoriser, et surtout rien qui puisse masquer un vrai
          // resultat au prochain appel.
          delete cache[key];
          return writeCache(cache).then(function () {
            return { offers: [], fromCache: false, at: at };
          });
        }
        cache[key] = { at: at, offers: res.offers, complete: res.complete };
        return writeCache(cache).then(function () {
          return { offers: res.offers, fromCache: false, at: at };
        });
      });
    });
  }

  CMExt.Market = {
    BASE: BASE,
    sleep: sleep,
    rand: rand,
    parsePrice: parsePrice,
    parseArticleRow: parseArticleRow,
    extractOffers: extractOffers,
    fetchOffers: fetchOffers,
    getOffers: getOffers,
    clearCache: clearCache
  };
})();
