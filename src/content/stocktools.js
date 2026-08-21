/*
 * stocktools.js — Panneau "Outils stock" sur les pages Stock/Offers.
 *
 * Deux features, inspirees du script console de correction des commentaires :
 *   1. Base locale du stock : bouton "Scanner le stock" qui parcourt les pages
 *      de la liste (via StockDB.scanAll) et une vue "Racks" qui montre combien
 *      de cartes par rack et quelle extension est rangee ou.
 *   2. Multi-edition : choisir une extension (ou toutes), les annonces visees
 *      (filtre commentaire et/ou filtre prix), une propriete (commentaire,
 *      prix, quantite, autre champ du formulaire), un mode (valeur fixe,
 *      rechercher/remplacer, regex, prix conseille), PREVISUALISER, puis
 *      appliquer article par article via le modal d'edition.
 *      Le mode "prix conseille" reprend le moteur de la page de vente en masse
 *      (marketdata.js + pricing.js) et ses reglages : meme calcul, appliqué au
 *      stock deja en ligne au lieu de la grille de saisie.
 *
 * Garde-fous :
 *   - aucun appel reseau sans clic explicite ;
 *   - l'application est impossible sans previsualisation prealable ;
 *   - confirmation avec le nombre de modifications avant d'ecrire ;
 *   - delais aleatoires entre chaque requete, bouton Stop.
 */
(function () {
  "use strict";

  function isOffersPage() {
    return /\/YuGiOh\/Stock\/Offers/i.test(location.pathname);
  }
  if (!isOffersPage()) return;

  var CMExt = window.CMExt;
  var DB = CMExt.StockDB;
  if (!DB) return;

  // ---- i18n avec repli ------------------------------------------------------
  function t(key, fallback, subs) {
    var msg = chrome.i18n.getMessage(key, subs);
    if (msg) return msg;
    if (!subs) return fallback;
    return fallback.replace(/\$(\d)/g, function (_, i) {
      var v = subs[parseInt(i, 10) - 1];
      return v == null ? "" : String(v);
    });
  }

  // ---- Petit constructeur de DOM (texte uniquement, jamais d'innerHTML avec
  // des donnees issues du stock) ----------------------------------------------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "text") node.textContent = attrs[k];
        else if (k === "className") node.className = attrs[k];
        else if (k === "hidden") node.hidden = !!attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function option(value, label) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }

  // ---- Etat -----------------------------------------------------------------
  var state = {
    running: false,   // scan ou application en cours
    stop: false,      // demande d'arret
    targets: null,    // resultat de la derniere previsualisation
    plan: null,       // { field, mutate, showAfter } de la previsualisation
    pageOnly: false,  // true = uniquement les lignes deja affichees dans le DOM
    settings: {}      // reglages, relus a chaud (seuils du prix conseille)
  };

  function money(value) { return Number(value).toFixed(2); }

  // Comparaisons de prix en centimes entiers : en flottant, 0.1 + 0.2 ne vaut
  // pas 0.3, et un filtre "= 0,30" doit trouver les annonces a 30 centimes.
  function cents(value) { return Math.round(value * 100); }

  var ui = {}; // references vers les noeuds du panneau

  // ---- Journal --------------------------------------------------------------
  function logLine(text, cls) {
    var line = el("div", { text: text, className: cls || "" });
    ui.log.appendChild(line);
    while (ui.log.childNodes.length > 300) ui.log.removeChild(ui.log.firstChild);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function setBusy(busy) {
    state.running = busy;
    state.stop = false;
    ui.scanBtn.disabled = busy;
    ui.clearBtn.disabled = busy;
    ui.previewBtn.disabled = busy;
    ui.applyBtn.disabled = busy || !state.targets || !state.targets.length;
    ui.stopBtn.disabled = !busy;
    ui.inspectBtn.disabled = busy;
    if (ui.pageBtn) ui.pageBtn.disabled = busy;
  }

  // ---- Resume de la base + vue racks ---------------------------------------
  function refreshDbSummary() {
    return DB.getDB().then(function (db) {
      var expIds = Object.keys(db.expansions);
      var articles = expIds.reduce(function (n, id) {
        return n + (db.expansions[id].articles || []).length;
      }, 0);
      if (!expIds.length) {
        ui.dbSummary.textContent = t("stDbEmpty", "Aucune donnee locale. Lancez un scan.");
      } else {
        ui.dbSummary.textContent = t(
          "stDbState",
          "$1 annonces dans $2 extensions — scan du $3",
          [String(articles), String(expIds.length), new Date(db.updatedAt).toLocaleString()]
        );
      }
      return db;
    });
  }

  function labelSummary(labels) {
    return Object.keys(labels).sort().map(function (k) {
      return k + " ×" + labels[k];
    }).join(", ");
  }

  function renderRacks(db) {
    var agg = DB.buildRacks(db);
    ui.racksBox.textContent = "";

    // Table 1 : par rack
    var rackIds = Object.keys(agg.racks).sort(DB.compareRacks);
    var t1Head = el("tr", null, [
      el("th", { text: t("stRack", "Rack") }),
      el("th", { text: t("stListings", "Annonces") }),
      el("th", { text: t("stCards", "Cartes") }),
      el("th", { text: t("stSets", "Extensions") })
    ]);
    var t1Body = rackIds.map(function (r) {
      var v = agg.racks[r];
      return el("tr", null, [
        el("td", { text: r }),
        el("td", { text: String(v.listings) }),
        el("td", { text: String(v.cards) }),
        el("td", { text: labelSummary(v.labels) })
      ]);
    });
    ui.racksBox.appendChild(el("table", { className: "cmext-table" }, [t1Head].concat(t1Body)));

    // Table 2 : par extension
    var expNames = Object.keys(agg.byExpansion).sort();
    var t2Head = el("tr", null, [
      el("th", { text: t("stExpansion", "Extension") }),
      el("th", { text: t("stListings", "Annonces") }),
      el("th", { text: t("stCards", "Cartes") }),
      el("th", { text: t("stRacks", "Racks") }),
      el("th", { text: t("stUnplaced", "Sans emplacement") })
    ]);
    var t2Body = expNames.map(function (name) {
      var v = agg.byExpansion[name];
      var racksTxt = Object.keys(v.racks).sort(DB.compareRacks)
        .map(function (r) { return r + " (×" + v.racks[r] + ")"; }).join(", ");
      return el("tr", null, [
        el("td", { text: name }),
        el("td", { text: String(v.listings) }),
        el("td", { text: String(v.cards) }),
        el("td", { text: racksTxt }),
        el("td", { text: String(v.unplaced) })
      ]);
    });
    ui.racksBox.appendChild(el("table", { className: "cmext-table" }, [t2Head].concat(t2Body)));

    if (!rackIds.length && !expNames.length) {
      ui.racksBox.appendChild(el("p", { className: "cmext-hint", text: t("stDbEmpty", "Aucune donnee locale. Lancez un scan.") }));
    }
  }

  // ---- Scan -----------------------------------------------------------------
  function onScan() {
    if (state.running) return;
    setBusy(true);
    logLine(t("stScanStart", "Scan du stock…"));
    DB.scanAll({
      shouldStop: function () { return state.stop; },
      onExpansion: function (exp, i, total) {
        logLine(t("stScanExp", "[$1/$2] $3", [String(i + 1), String(total), exp.name]));
      },
      onProgress: function (page, nbPages) {
        if (nbPages > 1) logLine("  " + t("stScanPage", "page $1/$2", [String(page), String(nbPages)]), "cmext-dim");
      },
      onEmpty: function (exp) {
        logLine("  " + t("stScanEmpty", "$1 : aucune ligne lue, donnees precedentes conservees.", [exp.name]), "cmext-err");
      }
    }).then(function (res) {
      logLine(res.stopped
        ? t("stScanStopped", "Scan interrompu ($1/$2 extensions).", [String(res.scanned), String(res.expansions)])
        : t("stScanDone", "Scan termine : $1 extensions.", [String(res.expansions)]), "cmext-ok");
    }).catch(function (e) {
      logLine(e && e.cmextChallenge
        ? t("stChallenge", "Verification anti-robot de CardMarket. Ouvrez une page du site, validez la verification, puis relancez.")
        : t("stError", "Erreur : $1", [String(e && e.message || e)]), "cmext-err");
    }).then(function () {
      setBusy(false);
      return refreshDbSummary().then(function (db) {
        if (!ui.racksBox.hidden) renderRacks(db);
      });
    });
  }

  function onClear() {
    if (!window.confirm(t("stConfirmClear", "Effacer la base locale ?"))) return;
    DB.clearDB().then(refreshDbSummary).then(function (db) {
      ui.racksBox.hidden = true;
      logLine(t("stCleared", "Base locale effacee."));
    });
  }

  function onToggleRacks() {
    if (!ui.racksBox.hidden) { ui.racksBox.hidden = true; return; }
    DB.getDB().then(function (db) {
      renderRacks(db);
      ui.racksBox.hidden = false;
    });
  }

  // ---- Multi-edition --------------------------------------------------------
  var FIELD_PRESETS = ["comments", "price", "count"];

  function currentField() {
    var v = ui.fieldSelect.value;
    return v === "__other" ? ui.fieldOther.value.trim() : v;
  }

  // ---- Filtres : quelles annonces sont visees -------------------------------
  var PRICE_TESTS = {
    "<=": function (a, b) { return a <= b; },
    ">=": function (a, b) { return a >= b; },
    "==": function (a, b) { return a === b; },
    "<": function (a, b) { return a < b; },
    ">": function (a, b) { return a > b; }
  };

  // Filtre sur le prix affiche dans la liste. Renvoie { test } (test nul = pas
  // de filtre) ou { error }.
  function buildPriceFilter() {
    var op = ui.priceOp.value;
    if (!op) return { test: null };
    var raw = ui.priceValue.value.trim().replace(",", ".");
    var value = parseFloat(raw);
    if (!raw || isNaN(value)) {
      return { error: t("stNeedPriceValue", "Renseigner le prix a comparer.") };
    }
    var cmp = PRICE_TESTS[op];
    var target = cents(value);
    return {
      label: op + " " + money(value),
      test: function (price) {
        // Prix illisible : on ne devine pas, l'annonce sort de la selection.
        return price == null ? false : cmp(cents(price), target);
      }
    };
  }

  // Le filtre commentaire, inchange : une regex, ou rien.
  function buildCommentFilter() {
    var raw = ui.filterInput.value.trim();
    if (!raw) return { test: null };
    try { var re = new RegExp(raw); }
    catch (e) { return { error: t("stBadRegex", "Regex invalide : $1", [String(e.message)]) }; }
    return { test: function (comment) { return re.test(comment); } };
  }

  // ---- Prix conseille -------------------------------------------------------
  // Le prix ecrit doit repartir dans le format du formulaire ("1,50" sur un
  // site en francais) : sans ca, une valeur identique au centime pres passerait
  // pour un changement et on reecrirait tout le stock pour rien.
  function priceMutator(value) {
    return function (before) {
      var s = money(value);
      return String(before).indexOf(",") !== -1 ? s.replace(".", ",") : s;
    };
  }

  // Prix conseille d'une annonce, avec le moteur et les reglages de la page de
  // vente en masse. Renvoie { result } ou { reason } quand la ligne n'est pas
  // chiffrable.
  function autoPriceFor(row) {
    if (!CMExt.Pricing || !CMExt.Market) {
      return Promise.resolve({ reason: "engine" });
    }
    var target = {
      condition: row.condition,
      language: row.language,
      isSigned: !!row.isSigned,
      isFirstEd: !!row.isFirstEd,
      isAltered: !!row.isAltered
    };
    // Sans etat, sans langue ou sans lien produit, il n'y a rien a comparer :
    // sauter la ligne vaut mieux que chiffrer sur des suppositions.
    if (!target.condition || !target.language || !row.href) {
      return Promise.resolve({ reason: "attrs" });
    }

    var opts = CMExt.Pricing.optsFromSettings(state.settings);
    return CMExt.Market.getOffers(null, row.href, {
      // Les lignes de stock n'ont pas d'idProduct : le chemin produit fait la
      // cle de cache, sinon toutes les cartes partageraient la meme entree.
      cacheKey: String(row.href).split("?")[0],
      ttlMs: (parseFloat(state.settings.priceCacheHours) || 24) * 3600 * 1000,
      language: target.language,
      sellerCountry: parseInt(state.settings.priceSellerCountry, 10) || 0,
      enough: function (offers) {
        return CMExt.Pricing.suggest(offers, target, opts).price !== null;
      }
    }).then(function (res) {
      return {
        result: CMExt.Pricing.suggest(res.offers, target, opts),
        fromCache: res.fromCache
      };
    });
  }

  // Construit la fonction de transformation selon le mode choisi.
  // Renvoie { mutate } ou { error }.
  function buildMutator() {
    var mode = ui.modeSelect.value;
    if (mode === "auto") {
      // Chaque cible porte son propre prix, calcule a la previsualisation.
      // Ce mutateur de repli s'abstient plutot que d'ecrire au hasard.
      return { mutate: function () { return null; } };
    }
    if (mode === "set") {
      var value = ui.valueInput.value;
      // Sur le prix, on repose la valeur dans le format du formulaire : le
      // modal d'un site en francais rend "0,30", et lui renvoyer "0.30" (ou
      // l'inverse) est le genre de detail que CardMarket accepte sans rien
      // enregistrer. On refuse aussi ce qui n'est pas un nombre.
      if (currentField() === "price") {
        var n = parseFloat(String(value).trim().replace(",", "."));
        if (isNaN(n) || n < 0) return { error: t("stBadPrice", "Prix invalide : « $1 »", [value]) };
        return { mutate: priceMutator(n) };
      }
      return { mutate: function () { return value; } };
    }
    var search = ui.searchInput.value;
    var replace = ui.replaceInput.value;
    if (!search) return { error: t("stNeedSearch", "Renseigner le texte a rechercher.") };
    if (mode === "replace") {
      return { mutate: function (v) { return v.split(search).join(replace); } };
    }
    // mode === "regex"
    try {
      var re = new RegExp(search, "g");
      return { mutate: function (v) { return v.replace(re, replace); } };
    } catch (e) {
      return { error: t("stBadRegex", "Regex invalide : $1", [String(e.message)]) };
    }
  }

  function selectedExpansions() {
    var v = ui.expSelect.value;
    return DB.listExpansions().then(function (all) {
      if (v === "all") return all;
      return all.filter(function (e) { return String(e.id) === v; });
    });
  }

  function renderPreview(targets, showAfter) {
    ui.previewBox.textContent = "";
    var head = el("tr", null, [
      el("th", { text: t("stArticle", "Article") }),
      el("th", { text: t("stComment", "Commentaire") }),
      el("th", { text: t("stPropPrice", "Prix") }),
      showAfter ? el("th", { text: t("stAfter", "Apres") })
                : el("th", { text: t("stChange", "Modification") })
    ]);
    var rows = targets.slice(0, 200).map(function (r) {
      return el("tr", null, [
        el("td", { text: r.name || r.id }),
        el("td", { text: r.comment }),
        el("td", { text: r.price == null ? "?" : money(r.price) }),
        el("td", { text: showAfter ? r.after : r.changeLabel })
      ]);
    });
    ui.previewBox.appendChild(el("table", { className: "cmext-table" }, [head].concat(rows)));
    if (targets.length > 200) {
      ui.previewBox.appendChild(el("p", {
        className: "cmext-hint",
        text: t("stPreviewTruncated", "Apercu limite aux 200 premiers ($1 au total).", [String(targets.length)])
      }));
    }
  }

  // Parcourt les extensions selectionnees et rend les lignes qui passent les
  // filtres. La liste est relue a chaque previsualisation : la base locale peut
  // dater, et on n'ecrit jamais a partir de donnees perimees.
  function collectRows(expansions, filters) {
    var rows = [];
    var noPriceRead = 0;
    var i = 0;

    function next() {
      if (i >= expansions.length || state.stop) return Promise.resolve();
      var exp = expansions[i];
      logLine(t("stScanExp", "[$1/$2] $3", [String(i + 1), String(expansions.length), exp.name]), "cmext-dim");
      return DB.scanExpansion(exp.id, { shouldStop: function () { return state.stop; } })
        .then(function (list) {
          list.forEach(function (r) {
            if (filters.comment && !filters.comment(r.comment)) return;
            if (filters.price) {
              // Prix illisible + filtre prix : l'annonce est ecartee, et on le
              // dit. Sans ce compteur, un selecteur casse ressemblerait a un
              // stock qui ne correspond simplement a rien.
              if (r.price == null) { noPriceRead++; return; }
              if (!filters.price(r.price)) return;
            }
            rows.push(r);
          });
          i++;
          if (i >= expansions.length || state.stop) return null;
          return DB.sleep(DB.rand(1500, 3000)).then(next);
        });
    }

    return next().then(function () {
      return { rows: rows, noPriceRead: noPriceRead };
    });
  }

  // Le bouton integre a la page ne doit jamais elargir silencieusement son
  // perimetre. On part donc exclusivement des lignes qui existent deja dans la
  // table courante : aucun fetch de page, aucune pagination, aucun scan de
  // l'extension. Les filtres restent disponibles pour reduire ce sous-ensemble.
  function collectDisplayedRows(filters) {
    var rows = [];
    var noPriceRead = 0;
    Array.prototype.slice.call(document.querySelectorAll(
      '#UserOffersTable .table-body > [id^="stockRow"]'
    )).forEach(function (node) {
      var row = DB.parseStockRow(node);
      if (filters.comment && !filters.comment(row.comment)) return;
      if (filters.price) {
        if (row.price == null) { noPriceRead++; return; }
        if (!filters.price(row.price)) return;
      }
      rows.push(row);
    });
    return { rows: rows, noPriceRead: noPriceRead };
  }

  // Cibles des modes classiques : aucun appel reseau, tout se decide sur ce que
  // la liste a deja donne.
  function plainTargets(rows, field, mutate, changeLabel) {
    var targets = [];
    rows.forEach(function (r) {
      var base = { id: r.id, name: r.name, comment: r.comment, price: r.price };
      if (field === "comments") {
        // Le commentaire est connu depuis la liste : on ne garde que ce qui
        // change vraiment.
        var after = mutate(r.comment);
        if (after === r.comment) return;
        base.after = after;
      } else {
        // Valeur actuelle inconnue ici : elle sera lue dans le modal au moment
        // de l'application (et les inchangees seront ignorees).
        base.changeLabel = changeLabel;
      }
      targets.push(base);
    });
    return Promise.resolve({ targets: targets, noPrice: 0, unchanged: 0 });
  }

  // Cibles du mode "prix conseille" : une requete vers la page produit par
  // annonce (le cache de marketdata.js en absorbe une bonne part), delais
  // aleatoires entre deux appels reseau, arret sur Stop.
  function autoTargets(rows) {
    var targets = [];
    var noPrice = 0;
    var unchanged = 0;
    var i = 0;

    function next() {
      if (i >= rows.length || state.stop) return Promise.resolve();
      var r = rows[i];
      return autoPriceFor(r).then(function (res) {
        var prefix = "[" + (i + 1) + "/" + rows.length + "] " + (r.name || r.id) + " : ";
        var price = res.result ? res.result.price : null;

        if (price === null) {
          noPrice++;
          logLine(prefix + (res.reason === "attrs"
            ? t("stAutoNoAttrs", "etat ou langue illisible sur la ligne")
            : t("stAutoNoPrice", "pas de prix : donnees insuffisantes")), "cmext-dim");
        } else if (r.price != null && cents(r.price) === cents(price)) {
          unchanged++;
        } else {
          targets.push({
            id: r.id,
            name: r.name,
            comment: r.comment,
            price: r.price,
            after: money(price),
            mutate: priceMutator(price)
          });
          logLine(prefix + (r.price == null ? "?" : money(r.price)) + " -> " + money(price),
            res.result.confidence === "ok" ? "cmext-ok" : "");
        }

        i++;
        if (i >= rows.length || state.stop) return null;
        // Une reponse servie par le cache n'a rien coute au site : pas d'attente.
        return res.fromCache ? next() : DB.sleep(DB.rand(800, 1600)).then(next);
      });
    }

    return next().then(function () {
      return { targets: targets, noPrice: noPrice, unchanged: unchanged };
    });
  }

  // Diagnostic : lit le formulaire d'edition de la premiere annonce de la page
  // et affiche ses champs. C'est ce qui repond a "pourquoi le prix ne change
  // pas" — nom exact du champ et format de sa valeur — sans rien modifier ni
  // lancer de serie. Le jeton anti-CSRF est masque : il n'apprend rien et n'a
  // rien a faire dans un journal qu'on recopie ailleurs.
  function onInspect() {
    if (state.running) return;
    var row = document.querySelector('[id^="stockRow"]');
    if (!row) {
      logLine(t("stNoRowHere", "Aucune annonce sur cette page : ouvrez une page de stock qui en liste."), "cmext-err");
      return;
    }
    var id = row.id.replace("stockRow", "");
    setBusy(true);
    logLine(t("stInspecting", "Lecture du formulaire d'edition de l'article $1…", [id]));

    DB.loadArticleForm(id).then(function (loaded) {
      if (loaded.error) { logLine(loaded.error, "cmext-err"); return; }
      var names = Object.keys(loaded.fields);
      names.forEach(function (name) {
        var value = name === "__cmtkn" ? "(masque)" : JSON.stringify(loaded.fields[name]);
        logLine("  " + name + " = " + value, "cmext-dim");
      });
      logLine(t("stInspectDone",
        "$1 champ(s). La propriete a modifier doit figurer dans cette liste, et sa valeur montre le format attendu.",
        [String(names.length)]), "cmext-ok");
    }).catch(function (e) {
      logLine(e && e.cmextChallenge
        ? t("stChallenge", "Verification anti-robot de CardMarket. Ouvrez une page du site, validez la verification, puis relancez.")
        : t("stError", "Erreur : $1", [String(e && e.message || e)]), "cmext-err");
    }).then(function () {
      setBusy(false);
    });
  }

  function onPreview() {
    if (state.running) return;
    var mode = ui.modeSelect.value;
    // Le prix conseille n'ecrit que le prix : la propriete ne se discute pas.
    var field = mode === "auto" ? "price" : currentField();
    if (!field) { logLine(t("stNeedField", "Choisir une propriete."), "cmext-err"); return; }

    var built = buildMutator();
    if (built.error) { logLine(built.error, "cmext-err"); return; }

    var commentFilter = buildCommentFilter();
    if (commentFilter.error) { logLine(commentFilter.error, "cmext-err"); return; }
    var priceFilter = buildPriceFilter();
    if (priceFilter.error) { logLine(priceFilter.error, "cmext-err"); return; }
    var filters = { comment: commentFilter.test, price: priceFilter.test };

    state.targets = null;
    state.plan = null;
    ui.previewBox.textContent = "";
    setBusy(true);
    logLine(t("stPreviewStart", "Previsualisation…"));
    if (priceFilter.label) {
      logLine(t("stPriceFilterOn", "Filtre prix : $1 EUR", [priceFilter.label]), "cmext-dim");
    }

    var changeLabel = mode === "set"
      ? field + " := " + ui.valueInput.value
      : field + " : " + ui.searchInput.value + " -> " + ui.replaceInput.value;
    var showAfter = mode === "auto" || field === "comments";

    var source;
    if (state.pageOnly) {
      var displayed = collectDisplayedRows(filters);
      logLine(t("stPageRows", "$1 annonce(s) lue(s) sur la page affichee.",
        [String(displayed.rows.length)]), "cmext-dim");
      source = Promise.resolve(displayed);
    } else {
      source = selectedExpansions().then(function (expansions) {
        if (!expansions.length) throw new Error(t("stNoExpansion", "Aucune extension selectionnee."));
        return collectRows(expansions, filters);
      });
    }

    source.then(function (collected) {
      if (collected.noPriceRead) {
        logLine(t("stNoPriceRead", "$1 annonce(s) sans prix lisible, ecartee(s) par le filtre prix.",
          [String(collected.noPriceRead)]), "cmext-err");
      }
      if (mode !== "auto") return plainTargets(collected.rows, field, built.mutate, changeLabel);
      if (collected.rows.length) {
        logLine(t("stAutoStart", "Calcul du prix conseille sur $1 annonce(s)…",
          [String(collected.rows.length)]));
      }
      return autoTargets(collected.rows);
    }).then(function (res) {
      state.targets = res.targets;
      state.plan = {
        field: field,
        mutate: built.mutate,
        showAfter: showAfter,
        pageOnly: state.pageOnly
      };
      renderPreview(res.targets, showAfter);
      if (res.unchanged) {
        logLine(t("stAutoUnchanged", "$1 annonce(s) deja au bon prix.", [String(res.unchanged)]), "cmext-dim");
      }
      if (res.noPrice) {
        logLine(t("stAutoNoPriceCount", "$1 annonce(s) sans prix calculable, laissee(s) telle(s) quelle(s).",
          [String(res.noPrice)]), "cmext-dim");
      }
      logLine(res.targets.length
        ? t("stPreviewCount", "$1 article(s) cible(s). Verifier l'apercu puis Appliquer.", [String(res.targets.length)])
        : t("stNoTargets", "Aucun article a modifier."), res.targets.length ? "cmext-ok" : "");
    }).catch(function (e) {
      logLine(e && e.cmextChallenge
        ? t("stChallenge", "Verification anti-robot de CardMarket. Ouvrez une page du site, validez la verification, puis relancez.")
        : t("stError", "Erreur : $1", [String(e && e.message || e)]), "cmext-err");
    }).then(function () {
      setBusy(false);
    });
  }

  function onApply() {
    if (state.running || !state.targets || !state.targets.length || !state.plan) return;
    var targets = state.targets;
    var plan = state.plan;
    var confirmKey = plan.pageOnly ? "stConfirmApplyPage" : "stConfirmApply";
    var confirmFallback = plan.pageOnly
      ? "Appliquer $1 modification(s) aux annonces de cette page uniquement ?"
      : "Appliquer $1 modification(s) ?";
    if (!window.confirm(t(confirmKey, confirmFallback, [String(targets.length)]))) return;

    setBusy(true);
    var done = 0, skipped = 0, errors = 0;
    var applied = {}; // idArticle -> nouvelle valeur (pour rafraichir la base locale)
    var i = 0;
    // La premiere ecriture reelle est relue pour confirmer que le site l'a
    // gardee. CardMarket repond HTTP 200 meme quand il ignore la saisie : sans
    // ce controle, une modification de masse peut tourner de bout en bout sans
    // rien changer. Une requete de plus, une seule fois par serie.
    var verified = false;

    function next() {
      if (i >= targets.length || state.stop) return Promise.resolve();
      var tgt = targets[i];
      // Le mode "prix conseille" pose un prix par article, calcule a la
      // previsualisation ; les autres modes partagent la meme transformation.
      var mutate = tgt.mutate || plan.mutate;
      return DB.editArticle(tgt.id, plan.field, mutate, { verify: !verified }).then(function (r) {
        var prefix = "[" + (i + 1) + "/" + targets.length + "] " + (tgt.name || tgt.id) + " : ";
        if (r.challenge) {
          // Chaque tentative supplementaire renforce la verification : on arrete.
          errors++;
          logLine(prefix + t("stChallenge", "Verification anti-robot de CardMarket. Ouvrez une page du site, validez la verification, puis relancez."), "cmext-err");
          state.stop = true;
        } else if (!r.ok) {
          errors++;
          logLine(prefix + (r.error || ("HTTP " + r.status)), "cmext-err");
          if (r.fieldNames) {
            // Le champ n'existe pas sous ce nom : la serie entiere echouera
            // pareil. On donne les noms reels du formulaire et on s'arrete.
            logLine(t("stFormFields", "Champs du formulaire : $1", [r.fieldNames.join(", ")]), "cmext-err");
            state.stop = true;
          }
        } else if (r.skipped) {
          skipped++;
          logLine(prefix + t("stSkipped", "inchange"), "cmext-dim");
        } else if (r.verified === false) {
          // Le site a repondu OK et n'a rien garde : insister 200 fois ne
          // changerait que le nombre de requetes.
          errors++;
          logLine(prefix + t("stNotKept",
            "le site n'a pas garde la valeur — envoye « $1 », relu « $2 ». Rien d'autre ne sera modifie.",
            [String(r.after), String(r.actual)]), "cmext-err");
          state.stop = true;
        } else {
          done++;
          if (r.verified === true) {
            verified = true;
            logLine(t("stVerifiedOnce", "Ecriture confirmee par relecture : la suite s'enchaine."), "cmext-dim");
          }
          applied[tgt.id] = r.after;
          logLine(prefix + '"' + r.before + '" -> "' + r.after + '"', "cmext-ok");
        }
        i++;
        if (i >= targets.length || state.stop) return null;
        return DB.sleep(DB.rand(2000, 5000)).then(next);
      });
    }

    next().then(function () {
      logLine(t("stApplyDone", "Termine : $1 modifies, $2 inchanges, $3 erreurs.",
        [String(done), String(skipped), String(errors)]), errors ? "cmext-err" : "cmext-ok");
      if (state.stop) logLine(t("stStoppedAt", "Arrete a $1/$2.", [String(i), String(targets.length)]));

      // En mode page, la reponse Ajax ne remplace pas les lignes comme le ferait
      // le modal CardMarket. On synchronise les valeurs visibles afin que la
      // page ne continue pas d'afficher les anciennes donnees.
      if (plan.pageOnly) updateDisplayedRows(applied, plan.field);

      // Repercute les valeurs ecrites dans la base locale si elle existe, pour
      // les deux champs qu'elle connait.
      if (!Object.keys(applied).length) return null;
      if (plan.field !== "comments" && plan.field !== "price") return null;
      return DB.getDB().then(function (db) {
        var touched = false;
        Object.keys(db.expansions).forEach(function (idExp) {
          (db.expansions[idExp].articles || []).forEach(function (a) {
            if (applied[a.id] == null) return;
            if (plan.field === "comments") {
              a.comment = applied[a.id];
            } else {
              var value = parseFloat(String(applied[a.id]).replace(",", "."));
              a.price = isNaN(value) ? a.price : value;
            }
            touched = true;
          });
        });
        return touched ? DB.setDB(db) : null;
      });
    }).then(function () {
      state.targets = null;
      state.plan = null;
      ui.previewBox.textContent = "";
      setBusy(false);
      refreshDbSummary();
    });
  }

  function replaceDisplayedNumber(text, value) {
    var formatted = String(value);
    if (text.indexOf(",") !== -1) formatted = formatted.replace(".", ",");
    return text.replace(/[0-9]+(?:[.,][0-9]+)?/, formatted);
  }

  function updateDisplayedRows(applied, field) {
    Object.keys(applied).forEach(function (id) {
      var row = document.getElementById("stockRow" + id);
      if (!row) return;
      var value = String(applied[id]);
      var nodes;
      if (field === "comments") {
        nodes = row.querySelectorAll(".product-comments span");
        Array.prototype.forEach.call(nodes, function (node) {
          if (node.classList.contains("fonticon-comments")) {
            node.setAttribute("aria-label", value);
            node.setAttribute("data-bs-original-title", value);
          } else {
            node.textContent = value;
          }
        });
      } else if (field === "price") {
        nodes = row.querySelectorAll(".price-container .color-primary, .mobile-offer-container .color-primary");
        Array.prototype.forEach.call(nodes, function (node) {
          node.textContent = replaceDisplayedNumber(node.textContent, value);
        });
      } else if (field === "count") {
        nodes = row.querySelectorAll(".item-count");
        Array.prototype.forEach.call(nodes, function (node) { node.textContent = value; });
      }
    });
  }

  // ---- Construction du panneau ---------------------------------------------
  function syncModeInputs() {
    var mode = ui.modeSelect.value;
    var auto = mode === "auto";
    // Le prix conseille calcule lui-meme sa valeur : ni saisie, ni choix de
    // propriete a faire.
    if (auto) ui.fieldSelect.value = "price";
    ui.fieldSelect.disabled = auto;
    ui.valueRow.hidden = auto || mode !== "set";
    ui.searchRow.hidden = auto || mode === "set";
    ui.fieldOther.hidden = auto || ui.fieldSelect.value !== "__other";
    ui.autoHint.hidden = !auto;
  }

  function labeledRow(labelText, control) {
    return el("label", { className: "cmext-row" }, [
      el("span", { text: labelText }),
      control
    ]);
  }

  function clearPreview() {
    state.targets = null;
    state.plan = null;
    if (ui.previewBox) ui.previewBox.textContent = "";
    if (ui.applyBtn) ui.applyBtn.disabled = true;
  }

  function setPageOnly(enabled) {
    enabled = !!enabled;
    if (state.running || state.pageOnly === enabled) return;
    state.pageOnly = enabled;
    clearPreview();
    if (ui.dbSection) ui.dbSection.hidden = enabled;
    if (ui.expRow) ui.expRow.hidden = enabled;
    if (ui.scopeSummary) ui.scopeSummary.hidden = !enabled;
    if (ui.panelTitle) {
      ui.panelTitle.textContent = enabled
        ? t("stEditPageTitle", "Modifier la page affichee")
        : t("stPanelTitle", "Outils stock");
    }
    if (ui.autoHint) {
      ui.autoHint.textContent = enabled
        ? t("stAutoHintPage", "Le prix est recalcule uniquement pour les annonces affichees sur cette page.")
        : t("stAutoHint",
          "Le prix est recalcule pour chaque annonce a partir des offres du produit, avec les reglages de la page de vente en masse. Une requete par annonce (hors cache) : commencez par une extension.");
    }
  }

  function buildPanel() {
    var root = el("div", { id: "cmext-stocktools", className: "cmext-collapsed" });

    var tab = el("button", { type: "button", className: "cmext-tab", text: "CMExt" });
    tab.addEventListener("click", function () {
      if (root.classList.contains("cmext-collapsed")) {
        setPageOnly(false);
        root.classList.remove("cmext-collapsed");
      } else {
        root.classList.add("cmext-collapsed");
      }
    });

    // --- Section base locale ---
    ui.dbSummary = el("p", { className: "cmext-summary" });
    ui.scanBtn = el("button", { type: "button", text: t("stScan", "Scanner le stock") });
    ui.racksBtn = el("button", { type: "button", text: t("stRacks", "Racks") });
    ui.clearBtn = el("button", { type: "button", text: t("stClear", "Effacer la base") });
    ui.racksBox = el("div", { className: "cmext-racks", hidden: true });
    ui.scanBtn.addEventListener("click", onScan);
    ui.racksBtn.addEventListener("click", onToggleRacks);
    ui.clearBtn.addEventListener("click", onClear);

    // --- Section multi-edition ---
    ui.expSelect = el("select");
    ui.expSelect.appendChild(option("all", t("stAllExpansions", "Toutes les extensions")));
    // Le filtre extension de la page stock est reutilise tel quel (pas de reseau).
    Array.prototype.slice.call(document.querySelectorAll("#IdExpansion option"))
      .forEach(function (o) {
        var id = parseInt(o.value, 10);
        if (id > 0) ui.expSelect.appendChild(option(String(id), o.textContent.trim()));
      });

    ui.filterInput = el("input", { type: "text", placeholder: "^1-.* - MZMU" });

    // Filtre prix : un operateur et un montant. "—" laisse tout passer.
    ui.priceOp = el("select");
    ui.priceOp.appendChild(option("", t("stPriceOpNone", "— (pas de filtre)")));
    ["<=", ">=", "==", "<", ">"].forEach(function (op) {
      ui.priceOp.appendChild(option(op, op));
    });
    ui.priceValue = el("input", { type: "number", step: "0.01", min: "0", placeholder: "0.30" });
    ui.priceRow = labeledRow(t("stPriceFilter", "Filtre prix (optionnel)"),
      el("span", { className: "cmext-inline" }, [ui.priceOp, ui.priceValue]));

    ui.fieldSelect = el("select");
    ui.fieldSelect.appendChild(option("comments", t("stPropComment", "Commentaire")));
    ui.fieldSelect.appendChild(option("price", t("stPropPrice", "Prix")));
    ui.fieldSelect.appendChild(option("count", t("stPropCount", "Quantite")));
    ui.fieldSelect.appendChild(option("__other", t("stPropOther", "Autre champ…")));
    ui.fieldOther = el("input", { type: "text", placeholder: "isFoil", hidden: true });

    ui.modeSelect = el("select");
    ui.modeSelect.appendChild(option("set", t("stModeSet", "Valeur fixe")));
    ui.modeSelect.appendChild(option("replace", t("stModeReplace", "Rechercher / remplacer")));
    ui.modeSelect.appendChild(option("regex", t("stModeRegex", "Regex (remplacement global)")));
    ui.modeSelect.appendChild(option("auto", t("stModeAuto", "Prix conseille (moteur de la vente en masse)")));

    ui.autoHint = el("p", {
      className: "cmext-hint",
      hidden: true,
      text: t("stAutoHint",
        "Le prix est recalcule pour chaque annonce a partir des offres du produit, avec les reglages de la page de vente en masse. Une requete par annonce (hors cache) : commencez par une extension.")
    });

    ui.valueInput = el("input", { type: "text" });
    ui.valueRow = labeledRow(t("stValue", "Nouvelle valeur"), ui.valueInput);

    ui.searchInput = el("input", { type: "text" });
    ui.replaceInput = el("input", { type: "text" });
    ui.searchRow = el("div", null, [
      labeledRow(t("stSearch", "Rechercher"), ui.searchInput),
      labeledRow(t("stReplace", "Remplacer par"), ui.replaceInput)
    ]);

    ui.fieldSelect.addEventListener("change", syncModeInputs);
    ui.modeSelect.addEventListener("change", syncModeInputs);

    ui.inspectBtn = el("button", { type: "button", text: t("stInspect", "Inspecter un article") });
    ui.inspectBtn.addEventListener("click", onInspect);

    ui.previewBtn = el("button", { type: "button", text: t("stPreview", "Previsualiser") });
    ui.applyBtn = el("button", { type: "button", text: t("stApply", "Appliquer"), disabled: "disabled" });
    ui.stopBtn = el("button", { type: "button", text: t("stStop", "Stop"), disabled: "disabled" });
    ui.previewBtn.addEventListener("click", onPreview);
    ui.applyBtn.addEventListener("click", onApply);
    ui.stopBtn.addEventListener("click", function () { state.stop = true; });

    ui.previewBox = el("div", { className: "cmext-preview" });
    ui.log = el("div", { className: "cmext-log" });

    ui.panelTitle = el("h3", { text: t("stPanelTitle", "Outils stock") });
    ui.scopeSummary = el("p", {
      className: "cmext-page-scope",
      hidden: true,
      text: t("stPageScope", "Perimetre verrouille : annonces visibles sur cette page uniquement.")
    });
    ui.dbSection = el("section", null, [
      ui.dbSummary,
      el("div", { className: "cmext-btnrow" }, [ui.scanBtn, ui.racksBtn, ui.clearBtn]),
      ui.racksBox
    ]);
    ui.expRow = labeledRow(t("stExpansion", "Extension"), ui.expSelect);

    var body = el("div", { className: "cmext-body" }, [
      ui.panelTitle,
      ui.scopeSummary,

      ui.dbSection,

      el("section", null, [
        el("h4", { text: t("stMultiEdit", "Multi-edition") }),
        ui.expRow,
        labeledRow(t("stCommentFilter", "Filtre commentaire (regex, optionnel)"), ui.filterInput),
        ui.priceRow,
        labeledRow(t("stProperty", "Propriete"), ui.fieldSelect),
        ui.fieldOther,
        labeledRow(t("stMode", "Mode"), ui.modeSelect),
        ui.autoHint,
        ui.valueRow,
        ui.searchRow,
        el("div", { className: "cmext-btnrow" }, [ui.previewBtn, ui.applyBtn, ui.stopBtn, ui.inspectBtn]),
        ui.previewBox
      ]),

      ui.log
    ]);

    root.appendChild(tab);
    root.appendChild(body);
    syncModeInputs();
    return root;
  }

  // ---- Cycle de vie ---------------------------------------------------------
  var panel = null;
  var pageLauncher = null;

  function displayedRowCount() {
    return document.querySelectorAll('#UserOffersTable .table-body > [id^="stockRow"]').length;
  }

  function mountPageLauncher() {
    if (pageLauncher) return;
    var table = document.getElementById("UserOffersTable");
    var count = displayedRowCount();
    if (!table || !count) return;

    pageLauncher = el("div", {
      id: "cmext-page-bulk-actions",
      className: "d-flex justify-content-end align-items-center mb-2"
    });
    ui.pageBtn = el("button", {
      type: "button",
      className: "btn btn-secondary btn-sm",
      title: t("stEditPageHint", "Modifier uniquement les annonces actuellement affichees."),
      text: t("stEditPage", "Modifier en masse ($1)", [String(count)])
    });
    ui.pageBtn.addEventListener("click", function () {
      if (state.running) return;
      setPageOnly(true);
      panel.classList.remove("cmext-collapsed");
    });
    pageLauncher.appendChild(ui.pageBtn);
    table.parentNode.insertBefore(pageLauncher, table);
  }

  function mount() {
    if (panel) return;
    panel = buildPanel();
    document.body.appendChild(panel);
    mountPageLauncher();
    refreshDbSummary();
    CMExt.log("StockTools: panneau monte");
  }

  function unmount() {
    // On ne demonte jamais pendant un scan/une application en cours.
    if (!panel || state.running) return;
    if (pageLauncher) pageLauncher.remove();
    pageLauncher = null;
    ui.pageBtn = null;
    panel.remove();
    panel = null;
  }

  CMExt.getSettings().then(function (settings) {
    // Les reglages servent au mode "prix conseille" : memes seuils que la page
    // de vente en masse, relus a chaud pour rester a jour entre deux calculs.
    state.settings = settings;
    if (settings.stockToolsEnabled) mount();
    CMExt.onChange(function (next) {
      state.settings = next;
      if (next.stockToolsEnabled) mount();
      else unmount();
    });
  });
})();
