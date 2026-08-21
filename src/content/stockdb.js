/*
 * stockdb.js — Base locale du stock + crawler des pages Stock/Offers/Singles.
 *
 * Expose `CMExt.StockDB` :
 *   - getDB() / setDB() / clearDB() : la base dans chrome.storage.local
 *   - parseLocation()               : "1-02 - MZMU" -> { rack, slot, label }
 *   - buildRacks()                  : agrege la base par rack et par extension
 *   - listExpansions()              : lit le filtre extension de la page stock
 *   - scanExpansion() / scanAll()   : parcourent les pages de la liste stock
 *   - editArticle()                 : ouvre le modal d'edition et POste un champ
 *
 * IMPORTANT : aucun appel reseau automatique. Tout fetch part d'un clic
 * utilisateur explicite (scan, previsualisation, application), avec des delais
 * aleatoires entre chaque requete.
 *
 * Format d'emplacement attendu dans le commentaire : "RACK - CODE" ou le nom
 * du rack est un bloc "N-N", ex. "1-02 - MZMU" = rack "1-02", extension MZMU.
 */
(function () {
  "use strict";

  if (!window.CMExt || window.CMExt.StockDB) return;
  var CMExt = window.CMExt;

  var DB_KEY = "cmext.stockdb";
  // Prefixe de langue du site ("fr", "en"...) pris sur l'URL courante.
  var LANG = location.pathname.split("/")[1] || "fr";
  var BASE = "/" + LANG + "/YuGiOh";

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(min, max) { return Math.floor(min + Math.random() * (max - min)); }

  // ---- Base locale (chrome.storage.local : pas de quota sync, reste local) --
  function emptyDB() {
    return { version: 1, updatedAt: 0, expansions: {} };
  }

  function getDB() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(DB_KEY, function (data) {
        resolve((data && data[DB_KEY]) || emptyDB());
      });
    });
  }

  function setDB(db) {
    return new Promise(function (resolve) {
      var payload = {};
      payload[DB_KEY] = db;
      chrome.storage.local.set(payload, function () { resolve(db); });
    });
  }

  function clearDB() {
    return new Promise(function (resolve) {
      chrome.storage.local.remove(DB_KEY, resolve);
    });
  }

  // ---- Emplacement physique -------------------------------------------------
  // Le nom du rack est le bloc "N-N" entier ("1-1", "1-15", "2-2"...).
  // "1-02 - MZMU" -> { rack: "1-02", label: "MZMU" }
  var LOC_RE = /^(\d+)-(\d+)\s*-\s*(.+)$/;
  function parseLocation(comment) {
    var m = LOC_RE.exec(String(comment || "").trim());
    if (!m) return null;
    // Normalise les zeros de tete : "1-02" et "1-2" designent le meme rack.
    return { rack: Number(m[1]) + "-" + Number(m[2]), label: m[3].trim() };
  }

  // Tri naturel des noms de rack : "1-3" avant "1-15", "1-x" avant "2-x".
  function compareRacks(a, b) {
    var pa = String(a).split("-"), pb = String(b).split("-");
    var d = Number(pa[0]) - Number(pb[0]);
    return d !== 0 ? d : Number(pa[1]) - Number(pb[1]);
  }

  // Agrege la base :
  //   racks       : rack -> { listings, cards, labels: { CODE: nbAnnonces } }
  //   byExpansion : nomExtension -> { listings, cards, racks: { rack: n }, unplaced }
  function buildRacks(db) {
    var racks = {};
    var byExpansion = {};
    Object.keys(db.expansions).forEach(function (idExp) {
      var exp = db.expansions[idExp];
      var e = byExpansion[exp.name] = { listings: 0, cards: 0, racks: {}, unplaced: 0 };
      (exp.articles || []).forEach(function (a) {
        var qty = a.quantity > 0 ? a.quantity : 1;
        e.listings++;
        e.cards += qty;
        var loc = parseLocation(a.comment);
        if (!loc) { e.unplaced++; return; }
        var r = racks[loc.rack] || (racks[loc.rack] = { listings: 0, cards: 0, labels: {} });
        r.listings++;
        r.cards += qty;
        r.labels[loc.label] = (r.labels[loc.label] || 0) + 1;
        e.racks[loc.rack] = (e.racks[loc.rack] || 0) + 1;
      });
    });
    return { racks: racks, byExpansion: byExpansion };
  }

  // ---- Crawler --------------------------------------------------------------
  // Le corps est lu avant de decider : une verification anti-robot arrive
  // parfois en HTTP 200, et la prendre pour une page de stock vide reviendrait
  // a effacer une extension de la base.
  function fetchDoc(url) {
    return fetch(url).then(function (res) {
      return res.text().then(function (html) {
        if (CMExt.isChallenge(res, html)) {
          CMExt.warn("verification anti-robot sur", url, "— scan interrompu");
          throw CMExt.challengeError();
        }
        if (!res.ok) throw new Error("HTTP " + res.status + " sur " + url);
        return new DOMParser().parseFromString(html, "text/html");
      });
    });
  }

  function offersUrl(idExpansion, page) {
    var url = BASE + "/Stock/Offers/Singles";
    var params = [];
    if (idExpansion) params.push("idExpansion=" + idExpansion);
    if (page > 1) params.push("site=" + page);
    return params.length ? url + "?" + params.join("&") : url;
  }

  // Extrait les extensions du <select id="IdExpansion"> d'un document
  // (la page stock elle-meme, ou une page recuperee via fetch).
  function expansionsFromDoc(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll("#IdExpansion option"))
      .map(function (o) {
        return {
          id: parseInt(o.value, 10),
          name: o.textContent.trim(),
          count: parseInt((o.textContent.match(/\((\d+)\)\s*$/) || [0, 0])[1], 10)
        };
      })
      .filter(function (e) { return e.id > 0 && e.count > 0; });
  }

  // Liste des extensions presentes dans le stock (fetch de la page si besoin).
  function listExpansions() {
    var local = expansionsFromDoc(document);
    if (local.length) return Promise.resolve(local);
    return fetchDoc(offersUrl(null, 1)).then(expansionsFromDoc);
  }

  // Nombre de pages : max des liens "?site=N" + libelle "Page 1 sur N"
  // (double lecture pour rester independant de la langue du site).
  function pageCount(doc) {
    var max = 1;
    Array.prototype.slice.call(doc.querySelectorAll('.pagination a[href*="site="]'))
      .forEach(function (a) {
        var m = /[?&]site=(\d+)/.exec(a.getAttribute("href") || "");
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
    var text = Array.prototype.slice.call(doc.querySelectorAll(".pagination span"))
      .map(function (s) { return s.textContent; }).join(" ");
    var m2 = /(?:sur|of|von|de|di)\s+(\d+)/i.exec(text);
    if (m2) max = Math.max(max, parseInt(m2[1], 10));
    return max;
  }

  // ---- Lecture d'une ligne de stock ----------------------------------------
  // Les lignes de stock reprennent le gabarit des lignes d'offre de la page
  // produit : meme colonne prix, memes icones sprite pour la langue et les
  // extras. On lit donc la ligne comme marketdata.js lit une offre.
  //
  // Prix, etat et langue ne servent qu'aux filtres et au prix conseille, jamais
  // au placement en rack : `null` est une valeur normale ici, et c'est a
  // l'appelant d'ecarter la ligne plutot que de deviner.
  var SPECIAL_BY_X = { 0: "isFirstEd", 32: "isSigned", 64: "isAltered" };

  function spritePos(node) {
    var m = /background-position:\s*(-?\d+)px\s+(-?\d+)px/.exec(node.getAttribute("style") || "");
    if (!m) return null;
    return { x: Math.abs(parseInt(m[1], 10)), y: Math.abs(parseInt(m[2], 10)) };
  }

  function textOf(root, selector) {
    var node = root.querySelector(selector);
    return node ? node.textContent.trim() : "";
  }

  function parsePrice(text) {
    if (!text) return null;
    var value = CMExt.Market ? CMExt.Market.parsePrice(text) : NaN;
    return isNaN(value) || !(value > 0) ? null : value;
  }

  function parseStockRow(row) {
    // Le premier lien produit de la ligne : son texte est le nom de la carte,
    // son href la page ou lire les offres concurrentes.
    var link = row.querySelector('a[href*="/Products/"]');
    var qtyEl = row.querySelector(".item-count, .amount");
    var qty = qtyEl ? parseInt(qtyEl.textContent.replace(/\D+/g, ""), 10) : NaN;

    // L'etat se lit sur la classe "condition-xx", portee tantot par le lien,
    // tantot par le badge qu'il contient : on prend le premier qui la porte.
    var condition = null;
    Array.prototype.slice.call(row.querySelectorAll("[class*='condition-']"))
      .some(function (node) {
        var m = /condition-([a-z]{2})\b/i.exec(node.className || "");
        if (!m) return false;
        condition = m[1].toUpperCase();
        return true;
      });

    var out = {
      id: row.id.replace("stockRow", ""),
      name: link ? link.textContent.trim() : "",
      // Chemin de la page produit : c'est lui qui permet d'aller chercher les
      // offres concurrentes plus tard (les lignes n'ont pas d'idProduct).
      href: link ? link.getAttribute("href") : null,
      comment: textOf(row, ".product-comments .text-truncate"),
      quantity: isNaN(qty) ? 1 : qty,
      price: parsePrice(textOf(row, ".col-offer .price-container .color-primary") ||
                        textOf(row, ".price-container")),
      condition: condition,
      language: null,
      isFirstEd: false,
      isSigned: false,
      isAltered: false
    };

    // Sur les icones hors du bloc d'attributs (symbole d'extension, rarete) le
    // style porte une image, pas une position : elles sortent d'elles-memes.
    var iconRoot = row.querySelector(".product-attributes") || row;
    Array.prototype.slice.call(iconRoot.querySelectorAll("span.icon")).forEach(function (icon) {
      var pos = spritePos(icon);
      if (!pos) return;
      if (pos.y === 0 && pos.x > 0) out.language = pos.x / 16;
      else if (pos.y === 16 && SPECIAL_BY_X[pos.x]) out[SPECIAL_BY_X[pos.x]] = true;
    });

    return out;
  }

  function extractRows(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll('[id^="stockRow"]'))
      .map(parseStockRow);
  }

  // Ce qu'on garde en base : de quoi dresser les racks et filtrer. Le lien
  // produit en est absent — il ne sert qu'au calcul du prix conseille, toujours
  // fait sur des lignes fraichement relues, et il pese a lui seul plus que tout
  // le reste de l'article.
  function storableRow(r) {
    return {
      id: r.id,
      name: r.name,
      comment: r.comment,
      quantity: r.quantity,
      price: r.price,
      condition: r.condition,
      language: r.language,
      isFirstEd: r.isFirstEd,
      isSigned: r.isSigned,
      isAltered: r.isAltered
    };
  }

  // Parcourt toutes les pages d'une extension et renvoie ses lignes.
  // opts : { onProgress(pageActuelle, nbPages), shouldStop() }
  function scanExpansion(idExpansion, opts) {
    opts = opts || {};
    return fetchDoc(offersUrl(idExpansion, 1)).then(function (firstDoc) {
      var nbPages = pageCount(firstDoc);
      var rows = extractRows(firstDoc);
      if (opts.onProgress) opts.onProgress(1, nbPages);

      var p = 2;
      function next() {
        if (p > nbPages) return Promise.resolve(rows);
        if (opts.shouldStop && opts.shouldStop()) return Promise.resolve(rows);
        return sleep(rand(1000, 2000)).then(function () {
          return fetchDoc(offersUrl(idExpansion, p));
        }).then(function (doc) {
          rows.push.apply(rows, extractRows(doc));
          if (opts.onProgress) opts.onProgress(p, nbPages);
          p++;
          return next();
        });
      }
      return next();
    });
  }

  // Scanne tout le stock et enregistre la base au fil de l'eau (une ecriture
  // par extension : un scan interrompu garde ce qui est deja fait).
  // opts : { onExpansion(exp, index, total), onProgress(page, nbPages), shouldStop() }
  function scanAll(opts) {
    opts = opts || {};
    var stopped = false;
    function shouldStop() {
      if (opts.shouldStop && opts.shouldStop()) stopped = true;
      return stopped;
    }

    return Promise.all([listExpansions(), getDB()]).then(function (both) {
      var expansions = both[0];
      var db = both[1];

      var i = 0;
      function next() {
        if (i >= expansions.length || shouldStop()) {
          db.updatedAt = Date.now();
          return setDB(db).then(function () {
            return { expansions: expansions.length, scanned: i, stopped: stopped };
          });
        }
        var exp = expansions[i];
        if (opts.onExpansion) opts.onExpansion(exp, i, expansions.length);
        return scanExpansion(exp.id, { onProgress: opts.onProgress, shouldStop: shouldStop })
          .then(function (rows) {
            // Le filtre extension annonce un compte non nul : zero ligne
            // signifie que la page n'a pas ete lue comme prevu, pas que le
            // stock est vide. On garde ce que la base contient deja.
            if (!rows.length && exp.count > 0) {
              CMExt.warn("scan: aucune ligne lue pour", exp.name,
                "(" + exp.count + " annonces attendues) — extension laissee intacte");
              if (opts.onEmpty) opts.onEmpty(exp);
              return null;
            }
            db.expansions[exp.id] = {
              id: exp.id,
              name: exp.name,
              scannedAt: Date.now(),
              articles: rows.map(storableRow)
            };
            return setDB(db);
          })
          .then(function () {
            i++;
            if (i >= expansions.length || shouldStop()) return next();
            return sleep(rand(2000, 4000)).then(next);
          });
      }
      return next();
    });
  }

  // ---- Edition d'un article -------------------------------------------------
  // Recupere le formulaire du modal d'edition, applique `mutate` au champ
  // `field`, puis POste le formulaire complet (le token CSRF et les autres
  // champs viennent du formulaire lui-meme).
  //
  // `mutate(valeurActuelle, champsDuFormulaire)` peut rendre une valeur ou une
  // promesse : un prix conseille se calcule a partir de la page produit, donc
  // apres un aller-retour reseau. Rendre `null` laisse l'article intact — c'est
  // ainsi qu'un calcul sans resultat s'abstient au lieu d'ecrire n'importe quoi.
  // Les autres champs du formulaire sont passes en second argument : l'etat, la
  // langue et la 1re edition y sont exacts, contrairement a ce qu'on a pu lire
  // dans la liste.
  //
  // `opts.verify` relit le formulaire apres l'ecriture et compare : le seul
  // moyen de savoir si le site a vraiment garde la valeur. CardMarket repond
  // HTTP 200 meme quand il jette la saisie (mauvais format de nombre, champ
  // qu'il ne traite pas ainsi) — sans relecture, une modification de masse peut
  // enchainer deux cents ecritures sans rien changer du tout.
  //
  // Renvoie { ok, skipped, before, after, status?, error?, fieldNames?,
  //           verified?, actual? }.
  //
  // `fieldNames` accompagne un "field-not-found" : c'est la liste des champs
  // que le formulaire porte reellement, la seule facon de trouver le bon nom
  // sans ouvrir le modal a la main.

  // Charge le formulaire du modal d'edition. Renvoie { fd, fields } ou { error }.
  function loadArticleForm(idArticle) {
    var url = BASE + "/Modal/Article_EditArticleModal?showUserOffersRow=1&idArticle=" + idArticle;
    return fetch(url).then(function (res) {
      return res.text().then(function (body) {
        if (CMExt.isChallenge(res, body)) {
          CMExt.warn("verification anti-robot sur le modal d'edition — article", idArticle, "non modifie");
          throw CMExt.challengeError();
        }
        return body;
      });
    }).then(function (modalHtml) {
      try {
        var j = JSON.parse(modalHtml);
        modalHtml = j.content || j.html || modalHtml;
      } catch (e) { /* deja du HTML */ }

      var doc = new DOMParser().parseFromString(modalHtml, "text/html");
      var form = doc.querySelector("form");
      if (!form) return { error: "form-not-found" };

      var fd = new FormData(form);
      var fields = {};
      fd.forEach(function (v, k) { if (typeof v === "string") fields[k] = v; });
      return { fd: fd, fields: fields };
    });
  }

  // "0,30", "0.30" et "0.3" designent la meme valeur : des que les deux cotes
  // sont des nombres, on les compare comme tels.
  function sameValue(a, b) {
    if (String(a) === String(b)) return true;
    var na = parseFloat(String(a).replace(",", "."));
    var nb = parseFloat(String(b).replace(",", "."));
    if (isNaN(na) || isNaN(nb)) return false;
    return Math.abs(na - nb) < 1e-9;
  }

  function editArticle(idArticle, field, mutate, opts) {
    opts = opts || {};
    return loadArticleForm(idArticle).then(function (loaded) {
      if (loaded.error) return { ok: false, error: loaded.error };

      var fd = loaded.fd;
      var fields = loaded.fields;
      if (!fd.has(field)) {
        return {
          ok: false,
          error: "field-not-found:" + field,
          fieldNames: Object.keys(fields)
        };
      }

      var before = fd.get(field) == null ? "" : String(fd.get(field));
      return Promise.resolve(mutate(before, fields)).then(function (raw) {
        // `null` : le mutateur s'abstient (prix introuvable, attributs
        // illisibles). On ne touche pas a l'article.
        if (raw == null) return { ok: true, skipped: true, before: before, after: before };
        var after = String(raw);
        if (after === before) return { ok: true, skipped: true, before: before, after: after };

        fd.set(field, after);
        fd.set("idArticle", idArticle);
        fd.set("showUserOffersRow", "1");

        return fetch(BASE + "/AjaxAction/Article_EditSingleArticle", {
          method: "POST",
          body: fd
        }).then(function (post) {
          return post.text().then(function (body) {
            if (CMExt.isChallenge(post, body)) {
              CMExt.warn("verification anti-robot sur l'enregistrement — article", idArticle, "non modifie");
              throw CMExt.challengeError();
            }
            return { ok: post.ok, status: post.status, before: before, after: after };
          });
        }).then(function (res) {
          if (!res.ok || !opts.verify) return res;
          // Relecture : le site vient de repondre OK, reste a savoir ce qu'il a
          // reellement enregistre.
          return sleep(rand(500, 1200))
            .then(function () { return loadArticleForm(idArticle); })
            .then(function (again) {
              if (again.error || !again.fd.has(field)) return res;
              var actual = String(again.fd.get(field));
              res.actual = actual;
              res.verified = sameValue(actual, after);
              if (!res.verified) {
                CMExt.warn("article", idArticle, ": valeur non conservee pour", field,
                  "— envoye", after, ", relu", actual);
              }
              return res;
            });
        });
      });
    }).catch(function (e) {
      return { ok: false, challenge: !!(e && e.cmextChallenge), error: String(e && e.message || e) };
    });
  }

  CMExt.StockDB = {
    BASE: BASE,
    sleep: sleep,
    rand: rand,
    getDB: getDB,
    setDB: setDB,
    clearDB: clearDB,
    parseLocation: parseLocation,
    compareRacks: compareRacks,
    buildRacks: buildRacks,
    parseStockRow: parseStockRow,
    listExpansions: listExpansions,
    scanExpansion: scanExpansion,
    scanAll: scanAll,
    loadArticleForm: loadArticleForm,
    editArticle: editArticle
  };
})();
