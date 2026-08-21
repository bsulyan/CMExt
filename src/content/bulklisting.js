/*
 * bulklisting.js — Outillage de la page BulkListing.
 *
 * Page cible (exemple) :
 *   /fr/YuGiOh/Stock/ListingMethods/BulkListing?idExpansion=1433&sortBy=number
 *
 * Features prevues (toutes manuelles, aucun appel reseau declenche par nous) :
 *   1. Navigation clavier dans la grille (commentaire / nombre / prix / etat / langue)
 *      - Haut/Bas changent de ligne, Shift+Gauche/Droite changent de colonne.
 *   2. + / - pour ajouter / enlever de la quantite, et raccourcis sur la ligne
 *      courante (n/e/g/l/p, p deux fois = Poor, ! pour la langue, f = 1re
 *      edition, d = dupliquer).
 *   3. Garde-fous "modification de masse" : cases pour neutraliser le changement
 *      de prix / de nombre, qui se cochent automatiquement apres la 1re modif.
 *   4. Prix conseille : un bouton par ligne remplie calcule le prix de vente a
 *      partir des offres du produit (marketdata.js + pricing.js), plus un
 *      bouton global qui enchaine les lignes.
 *   5. Rustine "Copier ligne" : CardMarket clone la ligne au lieu de recopier
 *      les valeurs saisies, la langue repart donc a Anglais a chaque copie.
 *
 * Les garde-fous de modification de masse sont encore stubes.
 */
(function () {
  "use strict";

  function isBulkListingPage() {
    return /\/YuGiOh\/Stock\/ListingMethods\/BulkListing/i.test(location.pathname);
  }

  if (!isBulkListingPage()) return;

  var CMExt = window.CMExt;

  // ---- Navigation clavier ---------------------------------------------------
  // La grille (#BulkListingForm > table) a une ligne `#BulkListingRow{N}` par
  // carte. Les cellules editables, de gauche a droite, sont nommees `champ[N]`.
  // On navigue d'une cellule a l'autre au clavier et on ajuste la quantite sans
  // quitter la cellule courante.
  //
  // Le N du `name` ne sert a rien ici : une ligne dupliquee garde celui de sa
  // source tant que CardMarket ne renumerote pas, et deux lignes le partagent.
  // Se deplacer par index sauterait la copie (une recherche globale ne ramene
  // que la premiere des deux) et `+` irait grossir la quantite de l'autre
  // ligne. On se deplace donc de <tr> en <tr>, dans l'ordre de la page.
  var COLUMNS = ["idLanguage", "idCondition", "comments", "amount", "price"];

  // Nombre de lignes de la grille (les inputs `amount[N]` sont contigus).
  function rowCount() {
    return document.querySelectorAll('input[name^="amount["]').length;
  }

  // Decompose l'element focalise en { col, tr } s'il s'agit d'une cellule.
  function locate(el) {
    if (!el || !el.name) return null;
    var m = /^([A-Za-z]+)\[\d+\]$/.exec(el.name);
    if (!m) return null;
    var col = COLUMNS.indexOf(m[1]);
    if (col === -1) return null;
    var tr = rowOf(el);
    return tr ? { col: col, tr: tr } : null;
  }

  function focusCell(tr, field) {
    var el = fieldIn(tr, field);
    if (!el) return false;
    el.focus();
    // Pour les champs texte, on selectionne le contenu : la frappe suivante
    // ecrase, ce qui est le geste attendu en saisie de masse.
    if (el.select && (el.type === "text" || el.type === "number")) {
      try { el.select(); } catch (_) {}
    }
    return true;
  }

  // Deplace le focus dans la grille a partir de la cellule courante.
  function moveFocus(pos, dCol, dRow) {
    var col = Math.max(0, Math.min(COLUMNS.length - 1, pos.col + dCol));
    var tr = pos.tr;
    if (dRow) {
      // Relu a chaque frappe : la grille gagne des lignes au fil de la saisie.
      var rows = rowElements();
      var i = rows.indexOf(pos.tr);
      if (i === -1) return false;
      tr = rows[Math.max(0, Math.min(rows.length - 1, i + dRow))];
    }
    if (tr === pos.tr && col === pos.col) return false;
    return focusCell(tr, COLUMNS[col]);
  }

  // Ajuste la quantite de la ligne de `delta`, en respectant min/max.
  function bumpQuantity(tr, delta) {
    var el = fieldIn(tr, "amount");
    if (!el) return false;
    var min = el.min !== "" ? parseInt(el.min, 10) : -Infinity;
    var max = el.max !== "" ? parseInt(el.max, 10) : Infinity;
    var cur = parseInt(el.value, 10);
    if (isNaN(cur)) cur = 0;
    var next = Math.max(min, Math.min(max, cur + delta));
    if (next === cur) return true;
    el.value = String(next);
    // CardMarket reagit aux evenements natifs : on les rejoue.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // Haut/Bas changent de ligne, Gauche/Droite de colonne. Les colonnes ne
  // bougent qu'avec Shift : dans un champ texte, les fleches horizontales nues
  // servent a se placer dans la valeur saisie.
  var ARROWS = {
    ArrowLeft:  { dCol: -1, dRow: 0, needsShift: true },
    ArrowRight: { dCol: 1,  dRow: 0, needsShift: true },
    ArrowUp:    { dCol: 0,  dRow: -1, needsShift: false },
    ArrowDown:  { dCol: 0,  dRow: 1,  needsShift: false }
  };

  function setupKeyboardNav(settings) {
    CMExt.log("BulkListing: keyboard nav actif", { step: settings.quantityStep });

    function onKeyDown(e) {
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      var pos = locate(e.target);
      if (!pos) return;

      var step = parseInt(settings.quantityStep, 10) || 1;

      // + / - ajustent toujours la quantite, quelle que soit la cellule.
      if (e.key === "+" || e.key === "-") {
        if (bumpQuantity(pos.tr, e.key === "+" ? step : -step)) e.preventDefault();
        return;
      }

      var arrow = ARROWS[e.key];
      if (!arrow) return;
      if (arrow.needsShift && !e.shiftKey) return;

      // Coupe la frappe meme quand le focus ne bouge pas (haut de la 1re ligne,
      // bas de la derniere) : sur les menus etat et langue, une fleche verticale
      // change l'option selectionnee, et une ligne changerait de langue sans
      // qu'on l'ait demande.
      e.preventDefault();
      moveFocus(pos, arrow.dCol, arrow.dRow);
    }

    document.addEventListener("keydown", onKeyDown, true);
    return function teardown() {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }

  // ---- Garde-fous de la modification de masse -------------------------------
  // TODO: localiser le bloc "modification de masse", injecter les cases a cocher,
  // intercepter le submit pour neutraliser le champ verrouille, et cocher
  // automatiquement apres le premier usage (persiste via CMExt.setSettings).
  function setupMassModGuards(settings) {
    CMExt.log("BulkListing: mass-mod guards (stub)", {
      lockPrice: settings.lockPriceOnMassMod,
      lockQuantity: settings.lockQuantityOnMassMod
    });
  }

  // ---- Lignes de la grille --------------------------------------------------
  // Toute lecture de champ passe par la ligne elle-meme, jamais par un
  // `document.querySelector('[name="champ[3]"]')` : sur une ligne dupliquee, les
  // index des `name` et l'id de la ligne sont ceux de la ligne source tant que
  // CardMarket ne les a pas renumerotes. Une recherche globale ramenerait alors
  // les cellules de la ligne d'origine — on ecrirait le prix dans la mauvaise
  // ligne. Chercher DANS le <tr> est vrai dans tous les cas.
  function fieldIn(tr, name) {
    return tr.querySelector('[name^="' + name + '["]');
  }

  // Une ligne de carte : la presence du champ quantite suffit a la distinguer
  // des lignes d'en-tete, et ne depend pas de l'id (que la copie duplique).
  function isRow(el) {
    return !!el && el.tagName === "TR" && !!fieldIn(el, "amount");
  }

  function rowElements() {
    var form = document.getElementById("BulkListingForm") || document;
    return Array.prototype.slice.call(form.querySelectorAll("tr")).filter(isRow);
  }

  // CardMarket ajoute des lignes a la volee (bouton "Copier ligne"). Sans
  // observation, ces lignes n'existent pour nous que si la page est rechargee.
  //
  // Le traitement est repousse d'un tour de boucle : le gestionnaire de copie de
  // CardMarket finit son travail (renumerotation, valeurs) apres l'insertion, et
  // ce qu'on ecrirait avant serait ecrase.
  function observeNewRows(onRows) {
    var target = document.getElementById("BulkListingForm");
    if (!target || !window.MutationObserver) return function () {};

    var observer = new MutationObserver(function (records) {
      var added = [];
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes, function (node) {
          if (!node || node.nodeType !== 1) return;
          if (isRow(node)) added.push(node);
          else if (node.querySelectorAll) {
            Array.prototype.forEach.call(node.querySelectorAll("tr"), function (tr) {
              if (isRow(tr)) added.push(tr);
            });
          }
        });
      });
      if (added.length) setTimeout(function () { onRows(added); }, 0);
    });

    observer.observe(target, { childList: true, subtree: true });
    return function () { observer.disconnect(); };
  }

  // ---- Rustine "Copier ligne" -----------------------------------------------
  // CardMarket duplique la ligne en clonant le <tr>. La specification HTML fait
  // recopier aux <input> leur valeur et leur cochage — quantite, prix et
  // commentaire arrivent donc intacts. Les <select> n'ont pas cette regle : ils
  // retombent sur l'option portant `selected` dans le markup. `idCondition` en a
  // une (Near Mint), `idLanguage` n'en a aucune, donc la langue repart a Anglais
  // a chaque copie et l'etat retombe a Near Mint, meme sur une grille en
  // Francais et en Excellent.
  //
  // On note les valeurs de la ligne source au clic et on les repose sur la ligne
  // apparue. La liste couvre plus que les deux <select> casses : c'est un filet
  // si CardMarket change de methode. Quantite et prix restent hors de la liste,
  // ils sont deja justes et ce n'est pas a nous de les decider.
  var COPY_BUTTON = ".copy-row-button";
  var COPIED_FIELDS = ["idLanguage", "idCondition", "isSigned", "isFirstEd", "comments"];

  function readCopiedFields(tr) {
    var snapshot = {};
    COPIED_FIELDS.forEach(function (name) {
      var el = fieldIn(tr, name);
      if (!el) return;
      snapshot[name] = el.type === "checkbox" ? el.checked : el.value;
    });
    return snapshot;
  }

  function writeCopiedFields(tr, snapshot) {
    var restored = [];
    Object.keys(snapshot).forEach(function (name) {
      var el = fieldIn(tr, name);
      if (!el || el.disabled) return;
      if (el.type === "checkbox") {
        if (el.checked === snapshot[name]) return;
        el.checked = snapshot[name];
      } else {
        if (el.value === snapshot[name]) return;
        // Un <select> a qui l'on donne une valeur inconnue se vide : on verifie
        // que l'option existe plutot que de casser la ligne.
        if (el.tagName === "SELECT" &&
            !el.querySelector('option[value="' + snapshot[name] + '"]')) return;
        el.value = snapshot[name];
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      restored.push(name);
    });
    return restored;
  }

  function setupRowCopy() {
    var pending = null;

    function onClick(e) {
      var btn = e.target && e.target.closest ? e.target.closest(COPY_BUTTON) : null;
      if (!btn) return;
      var tr = btn.closest("tr");
      if (!isRow(tr)) return;
      pending = readCopiedFields(tr);
    }

    document.addEventListener("click", onClick, true);
    var unobserve = observeNewRows(function (rows) {
      if (!pending) return;
      var snapshot = pending;
      pending = null;
      rows.forEach(function (tr) {
        CMExt.log("BulkListing: ligne copiee, champs restaures", writeCopiedFields(tr, snapshot));
      });
    });

    CMExt.log("BulkListing: rustine copie de ligne active");
    return function teardown() {
      document.removeEventListener("click", onClick, true);
      unobserve();
    };
  }

  // ---- Raccourcis de ligne --------------------------------------------------
  // Sur une ligne, hors champ commentaire, une touche pose l'etat ou la langue
  // sans quitter la cellule courante : en saisie de masse, la main ne quitte pas
  // le clavier.
  //
  // `p` seul donne Played, deux `p` a la suite donnent Poor. La premiere frappe
  // agit tout de suite (Played est de loin le plus frequent des deux) et la
  // seconde corrige : rien a retenir, rien a attendre.
  //
  // `!` marche pareil et fait le tour de toutes les langues, un cran par
  // frappe : Francais, Anglais, Allemand d'abord — les trois qui remplissent la
  // grille — puis les autres dans l'ordre du menu, et retour au Francais.
  var CONDITION_KEYS = { n: 2, e: 3, g: 4, l: 5, p: 6 };
  var POOR_ID = 7;
  var LANGUAGE_KEY = "!";
  var LANGUAGE_HEAD = [2, 1, 3]; // Francais, Anglais, Allemand
  var DOUBLE_TAP_MS = 600;

  // Les langues du menu de la ligne, dans l'ordre de defilement. Lues sur le
  // menu plutot que codees en dur : une langue que CardMarket ne propose pas
  // ne doit pas prendre un cran dans la boucle, et une langue ajoutee un jour
  // s'y trouve sans qu'on ait rien a faire.
  function languageCycle(tr) {
    var sel = fieldIn(tr, "idLanguage");
    if (!sel) return [];
    var ids = Array.prototype.map.call(sel.options, function (o) {
      return parseInt(o.value, 10);
    }).filter(function (id) {
      return id > 0; // ecarte l'entree vide en tete de menu, s'il y en a une
    });
    var head = LANGUAGE_HEAD.filter(function (id) { return ids.indexOf(id) !== -1; });
    return head.concat(ids.filter(function (id) { return head.indexOf(id) === -1; }));
  }

  function rowOf(el) {
    var tr = el && el.closest ? el.closest("tr") : null;
    return isRow(tr) ? tr : null;
  }

  function isComments(el) {
    return !!(el && el.name && el.name.indexOf("comments[") === 0);
  }

  // Le focus est souvent ailleurs sur la ligne (quantite, prix) : sans ce
  // clignotement, rien ne dit que la lettre a ete prise en compte.
  function flashField(el) {
    el.classList.remove("cmext-key-set");
    // Forcer un reflow relance l'animation meme sur deux frappes rapprochees.
    void el.offsetWidth;
    el.classList.add("cmext-key-set");
    clearTimeout(el.cmextFlash);
    el.cmextFlash = setTimeout(function () {
      el.classList.remove("cmext-key-set");
    }, DOUBLE_TAP_MS);
  }

  // Pose une valeur sur un menu de la ligne (etat ou langue).
  function setSelect(tr, name, id) {
    var sel = fieldIn(tr, name);
    if (!sel || sel.disabled) return false;
    // Une valeur absente du menu viderait le <select> : la ligne partirait a
    // l'envoi sans etat. On prefere ne rien faire.
    if (!sel.querySelector('option[value="' + id + '"]')) return false;
    if (sel.value !== String(id)) {
      sel.value = String(id);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    flashField(sel);
    return true;
  }

  // Bascule la 1re edition. La case est desactivee sur les extensions qui n'en
  // ont pas (les tins, par exemple) : la frappe reste alors sans effet.
  function toggleFirstEd(tr) {
    var box = fieldIn(tr, "isFirstEd");
    if (!box || box.disabled) return false;
    box.checked = !box.checked;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    flashField(box);
    return true;
  }

  // ---- Duplication de ligne -------------------------------------------------
  // Le bouton "Copier ligne" de CardMarket n'est cable qu'une fois, au
  // chargement : la ligne qu'il produit est un clone, et cloneNode ne recopie
  // pas les listeners. Le bouton de la copie ne repond donc plus a rien, et on
  // ne peut pas dupliquer deux fois de suite.
  //
  // On marque les boutons rendus par le serveur, les seuls que CardMarket ait
  // cables. Sur les autres, on duplique nous-memes.
  var nativeCopyMarked = false;

  function markNativeCopyButtons() {
    if (nativeCopyMarked) return;
    nativeCopyMarked = true;
    Array.prototype.forEach.call(document.querySelectorAll(COPY_BUTTON), function (btn) {
      btn.cmextNative = true;
    });
  }

  // Les id generes par CardMarket sont uniques par ligne et servent a lier les
  // cases a cocher a leur <label>. Laisses tels quels sur le clone, cliquer le
  // label de la copie cocherait la case de la ligne source.
  var cloneSeq = 0;
  function refreshIds(copy) {
    var stamp = "-cmext" + (++cloneSeq);
    var map = {};
    Array.prototype.forEach.call(copy.querySelectorAll("[id]"), function (el) {
      if (!el.id) return;
      map[el.id] = el.id + stamp;
      el.id = map[el.id];
    });
    Array.prototype.forEach.call(copy.querySelectorAll("label[for]"), function (label) {
      if (map[label.htmlFor]) label.htmlFor = map[label.htmlFor];
    });
    // L'id du <tr> reste celui de la source, comme apres une copie native : les
    // index des `name` non plus ne sont pas renumerotes, tout est lu dans la
    // ligne (voir fieldIn) et rien ici ne doit s'en ecarter.
  }

  function cloneRow(tr) {
    if (!tr.parentNode) return false;
    var copy = tr.cloneNode(true);
    refreshIds(copy);
    tr.parentNode.insertBefore(copy, tr.nextSibling);
    // La spec HTML propage la saisie et le cochage des <input> au clonage, mais
    // pas la selection des <select> : ils retombent sur l'option `selected` du
    // markup (Anglais, Near Mint). Meme rustine que sur la copie native.
    CMExt.log("BulkListing: ligne dupliquee, champs restaures",
      writeCopiedFields(copy, readCopiedFields(tr)));
    return true;
  }

  function duplicateRow(tr) {
    var btn = tr.querySelector(COPY_BUTTON);
    // Bouton d'origine : on laisse CardMarket faire, la rustine de copie suit.
    if (btn && btn.cmextNative) {
      btn.click();
      return true;
    }
    // Bouton clone, donc muet — sauf si CardMarket a change de methode entre
    // temps. On le tente quand meme et on ne duplique nous-memes que si rien
    // n'est apparu : deux lignes ajoutees d'un coup ne se retirent pas, la page
    // n'a pas de bouton de suppression.
    var before = rowCount();
    if (btn) btn.click();
    if (rowCount() > before) return true;
    return cloneRow(tr);
  }

  // La derniere des lignes citees dans l'ordre de la page, donc la plus basse
  // a l'ecran.
  function lowestRow(rows) {
    return rows.reduce(function (best, tr) {
      if (!tr || !tr.isConnected) return best;
      if (!best) return tr;
      var after = best.compareDocumentPosition(tr) & Node.DOCUMENT_POSITION_FOLLOWING;
      return after ? tr : best;
    }, null);
  }

  function setupConditionKeys() {
    // Serie de frappes en cours : la meme touche, sur la meme ligne, dans la
    // fenetre de double-frappe.
    var tap = { tr: null, key: null, n: 0, at: 0 };
    var awaitingCopy = null;

    // Rang de la frappe dans la serie, de 1 a `cycle`. Au dela on repart de 1 :
    // un menu bloque sur sa derniere valeur ne se corrigerait plus.
    function tapCount(tr, key, cycle) {
      var now = Date.now();
      var again = tap.tr === tr && tap.key === key && now - tap.at < DOUBLE_TAP_MS;
      var n = again && tap.n < cycle ? tap.n + 1 : 1;
      tap = { tr: tr, key: key, n: n, at: now };
      return n;
    }

    function onKeyDown(e) {
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      // Le commentaire est du texte libre : les lettres y sont de la saisie.
      if (isComments(e.target)) return;
      var tr = rowOf(e.target);
      if (!tr) return;
      var raw = String(e.key || "");
      var key = raw.toLowerCase();
      var isCondition = Object.prototype.hasOwnProperty.call(CONDITION_KEYS, key);
      if (!isCondition && raw !== LANGUAGE_KEY && key !== "d" && key !== "f") return;

      // La touche appartient a la feature des qu'on est sur une ligne : on la
      // retire dans tous les cas, y compris quand elle ne peut rien faire (1re
      // edition desactivee), sinon elle irait s'ecrire dans la case du prix.
      e.preventDefault();

      if (raw === LANGUAGE_KEY) {
        var cycle = languageCycle(tr);
        if (cycle.length) setSelect(tr, "idLanguage", cycle[tapCount(tr, raw, cycle.length) - 1]);
        return;
      }
      if (key === "d") {
        // La ligne source sert de repere pour placer le curseur : elle seule
        // dit ou la copie est apparue.
        awaitingCopy = duplicateRow(tr) ? tr : null;
        return;
      }
      if (key === "f") {
        toggleFirstEd(tr);
        return;
      }
      if (key === "p") {
        // Une 3e frappe repart de Played : un va-et-vient Played/Poor serait
        // impossible a suivre.
        setSelect(tr, "idCondition", tapCount(tr, key, 2) === 2 ? POOR_ID : CONDITION_KEYS.p);
        return;
      }
      tap.tr = null;
      setSelect(tr, "idCondition", CONDITION_KEYS[key]);
    }

    // On duplique une ligne pour lister le meme exemplaire dans un autre etat :
    // la suite du geste est toujours la quantite, on l'amene sous les doigts.
    //
    // Sur la plus basse des deux lignes, pas sur la copie : CardMarket insere la
    // sienne au-dessus de la source, et remplir de haut en bas veut dire laisser
    // la ligne deja saisie derriere soi.
    var unobserve = observeNewRows(function (rows) {
      if (!awaitingCopy) return;
      var target = lowestRow(rows.concat([awaitingCopy]));
      awaitingCopy = null;
      var amount = target ? fieldIn(target, "amount") : null;
      if (!amount) return;
      amount.focus();
      try { amount.select(); } catch (_) {}
    });

    document.addEventListener("keydown", onKeyDown, true);
    CMExt.log("BulkListing: raccourcis de ligne actifs");
    return function teardown() {
      document.removeEventListener("keydown", onKeyDown, true);
      unobserve();
    };
  }

  // ---- Prix conseille -------------------------------------------------------
  // Un bouton par ligne remplie calcule le prix de vente a partir des offres du
  // produit (voir marketdata.js pour la recuperation, pricing.js pour le calcul).
  // Chaque ligne porte tout ce dont on a besoin :
  //   - un lien vers la page produit dans .col-product
  //   - `idProduct[N]` en champ cache
  //   - `idLanguage[N]`, `idCondition[N]`, `isSigned[N]`, `isFirstEd[N]`
  //   - `lowPrice` / `trendPrice` / `avg30Price` (champs desactives, jamais
  //     soumis) que l'on affiche a titre indicatif dans l'infobulle.
  var BTN_CLASS = "cmext-price-btn";

  // Les boutons sont injectes une fois pour toutes ; ils relisent les reglages
  // ici a chaque clic, pour rester a jour apres un changement d'options.
  var priceSettings = {};

  function msg(key, subs) {
    return chrome.i18n.getMessage(key, subs) || key;
  }

  function money(value) {
    return Number(value).toFixed(2);
  }

  // Rassemble les champs d'une ligne. Renvoie null si la ligne n'est pas
  // exploitable (pas de lien produit ou pas d'identifiant).
  function readRow(tr) {
    var link = tr.querySelector('.col-product a[href*="/Products/"]');
    var idProduct = fieldIn(tr, "idProduct");
    var amount = fieldIn(tr, "amount");
    var price = fieldIn(tr, "price");
    var language = fieldIn(tr, "idLanguage");
    var condition = fieldIn(tr, "idCondition");
    if (!link || !idProduct || !amount || !price || !language || !condition) return null;

    // Index lu sur un champ de la ligne, pas sur `tr.id` : le clone d'une copie
    // porte l'id de sa source jusqu'a ce que CardMarket le renumerote.
    var m = /\[(\d+)\]$/.exec(amount.name || "");

    function hidden(name) {
      var el = tr.querySelector('input[name="' + name + '"]');
      return el && el.value !== "" ? parseFloat(el.value) : null;
    }
    return {
      index: m ? m[1] : null,
      tr: tr,
      href: link.getAttribute("href"),
      name: link.textContent.trim(),
      idProduct: idProduct.value,
      amount: amount,
      price: price,
      language: language,
      condition: condition,
      isSigned: fieldIn(tr, "isSigned"),
      isFirstEd: fieldIn(tr, "isFirstEd"),
      stats: { low: hidden("lowPrice"), trend: hidden("trendPrice"), avg30: hidden("avg30Price") }
    };
  }

  function allRows() {
    return rowElements().map(readRow).filter(Boolean);
  }

  function quantityOf(row) {
    return parseInt(row.amount.value, 10) || 0;
  }

  // Ce que l'on cherche a vendre, au format attendu par CMExt.Pricing.
  function targetOf(row) {
    return {
      condition: CMExt.Pricing.CONDITION_BY_ID[parseInt(row.condition.value, 10)],
      language: parseInt(row.language.value, 10),
      isSigned: !!(row.isSigned && row.isSigned.checked),
      isFirstEd: !!(row.isFirstEd && row.isFirstEd.checked),
      isAltered: false
    };
  }

  // Les seuils du moteur, lus dans les reglages (voir Pricing.optsFromSettings :
  // les Outils stock chiffrent avec exactement les memes).
  function pricingOpts() {
    return CMExt.Pricing.optsFromSettings(priceSettings);
  }

  // Les offres retenues comme comparables, de la moins chere a la plus chere.
  // C'est la reponse a "pourquoi ce prix ?" et surtout a "pourquoi pas de
  // prix ?" : on voit d'un coup d'oeil ce que le filtre langue + 1re edition a
  // laisse passer.
  function offerLines(result) {
    var used = result.used || [];
    if (!used.length) return [];
    var lines = used.slice(0, 6).map(function (o) {
      return "  " + o.condition + " " + money(o.price) + " x" + o.quantity + " — " + o.seller;
    });
    if (used.length > 6) lines.push("  …");
    return [msg("apOffers", [String(result.comparable)])].concat(lines);
  }

  // Detail lisible : d'ou sort le prix, et les reperes de la page pour comparer.
  function explain(row, result) {
    var parts = [];
    if (result.price !== null) {
      parts.push(msg("apDetail", [
        money(result.price), money(result.marketNM),
        money(result.referenceNM), String(result.qty), String(result.sellers)
      ]));
      if (result.skipped > 0) parts.push(msg("apSkipped", [String(result.skipped)]));
      if (result.cappedBy !== null && result.cappedBy !== undefined) {
        parts.push(msg("apCapped", [money(result.cappedBy)]));
      }
      if (result.confidence === "weak") parts.push(msg("apWeak"));
    } else if (result.challenge) {
      // CardMarket a repondu par une verification anti-robot : le prix n'est
      // pas "introuvable", il n'a pas pu etre demande.
      parts.push(msg("apChallenge"));
    } else if (result.error) {
      // Panne technique (reseau, page inattendue) : le texte brut de l'erreur
      // n'a pas de traduction, on le montre tel quel.
      parts.push(msg("apError", [result.error]));
    } else {
      parts.push(msg("apNoData") + " — " + msg("apReason_" + result.reason));
    }
    // Les exemplaires en moins bon etat ecartes : c'est souvent la reponse a
    // "pourquoi pas de prix alors qu'il y a des offres a 2 centimes ?".
    if (result.worseIgnored > 0) {
      parts.push(msg("apWorseIgnored", [String(result.worseIgnored)]));
    }
    parts = parts.concat(offerLines(result));
    var s = row.stats;
    if (s.low !== null || s.trend !== null || s.avg30 !== null) {
      parts.push(msg("apStats", [
        s.low === null ? "-" : money(s.low),
        s.trend === null ? "-" : money(s.trend),
        s.avg30 === null ? "-" : money(s.avg30)
      ]));
    }
    return parts.join("\n");
  }

  function applyResult(row, result) {
    var btn = row.tr.querySelector("." + BTN_CLASS);
    row.price.classList.remove("cmext-price-ok", "cmext-price-weak", "cmext-price-none");

    if (result.price === null) {
      row.price.classList.add("cmext-price-none");
      if (btn) btn.textContent = result.challenge ? "⚠" : "?";
    } else {
      row.price.value = money(result.price);
      // CardMarket ecoute les evenements natifs : on les rejoue.
      row.price.dispatchEvent(new Event("input", { bubbles: true }));
      row.price.dispatchEvent(new Event("change", { bubbles: true }));
      row.price.classList.add(result.confidence === "ok" ? "cmext-price-ok" : "cmext-price-weak");
      if (btn) btn.textContent = money(result.price);
    }

    var detail = explain(row, result);
    row.price.title = detail;
    if (btn) btn.title = detail;

    // Une verification anti-robot ne se resout pas depuis un `fetch` : il faut
    // une vraie navigation. La barre montre alors le lien vers la page qui l'a
    // declenchee, y compris quand la ligne a ete chiffree seule.
    if (result.challenge && onChallengeRow) onChallengeRow(row);
  }

  // Calcule et applique le prix d'une ligne. Renvoie le resultat de Pricing.
  function priceRow(row) {
    var target = targetOf(row);
    var opts = pricingOpts();
    var btn = row.tr.querySelector("." + BTN_CLASS);
    if (btn) {
      btn.classList.add("is-busy");
      btn.textContent = "…";
    }

    return CMExt.Market.getOffers(row.idProduct, row.href, {
      ttlMs: (parseFloat(priceSettings.priceCacheHours) || 24) * 3600 * 1000,
      // Filtres poses cote serveur : la liste arrive deja restreinte a notre
      // langue et aux vendeurs qui comptent, donc complete des la 1re page.
      language: target.language,
      sellerCountry: parseInt(priceSettings.priceSellerCountry, 10) || 0,
      // Les offres arrivent triees par prix croissant : des qu'un prix sort, les
      // salves suivantes (plus cheres) ne peuvent plus le changer.
      enough: function (offers) {
        return CMExt.Pricing.suggest(offers, target, opts).price !== null;
      }
    }).then(function (res) {
      var result = CMExt.Pricing.suggest(res.offers, target, opts);
      applyResult(row, result);
      CMExt.log("BulkListing: prix", row.name, result, res.fromCache ? "(cache)" : "");
      return result;
    }).catch(function (e) {
      var result = {
        price: null,
        confidence: "none",
        reason: null,
        challenge: !!(e && e.cmextChallenge),
        error: String(e && e.message || e),
        comparable: 0
      };
      applyResult(row, result);
      // Renvoye plutot qu'avale : le calcul en lot doit pouvoir s'arreter net
      // sur une verification anti-robot au lieu de la declencher a chaque ligne.
      return result;
    }).then(function (result) {
      if (btn) btn.classList.remove("is-busy");
      return result;
    });
  }

  // Ajoute la colonne des boutons (en-tete + une cellule par ligne).
  function injectButtons(rows) {
    var headRow = document.querySelector("#BulkListingForm thead tr");
    if (headRow && !headRow.querySelector(".cmext-price-head")) {
      var th = document.createElement("th");
      th.className = "cmext-price-head";
      th.textContent = msg("apButton");
      headRow.appendChild(th);
    }

    rows.forEach(function (row) {
      var existing = row.tr.querySelector("." + BTN_CLASS);
      // `cmextWired` est une propriete JS, pas un attribut : elle ne survit pas
      // au clonage. Un bouton clone par la copie de ligne a donc l'air normal
      // mais n'ecoute plus rien — cloneNode ne copie pas les listeners. On jette
      // la cellule pour en reposer une vivante, en meme temps que l'etat de prix
      // herite de la ligne source, qui ne veut plus rien dire ici.
      if (existing && existing.cmextWired) return;
      if (existing) {
        var stale = existing.parentNode;
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
        row.price.classList.remove("cmext-price-ok", "cmext-price-weak", "cmext-price-none");
        row.price.title = "";
      }
      var td = document.createElement("td");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm btn-outline-primary " + BTN_CLASS;
      btn.textContent = msg("apButton");
      btn.title = msg("apButtonHint");
      btn.disabled = quantityOf(row) <= 0;
      btn.cmextWired = true;
      btn.addEventListener("click", function () {
        priceRow(row);
      });
      // Le bouton suit la quantite : inutile de chiffrer une ligne a zero.
      row.amount.addEventListener("input", function () {
        btn.disabled = quantityOf(row) <= 0;
      });
      td.appendChild(btn);
      row.tr.appendChild(td);
    });
  }

  // Barre "tout calculer" : parcourt les lignes remplies, une par une, avec des
  // delais aleatoires entre deux appels reseau (les lignes servies par le cache
  // n'attendent pas). Boutons Stop et Reprendre.
  //
  // Les lignes sont relues au clic et non a l'injection : celles nees d'une
  // copie apres le chargement de la page doivent etre chiffrees comme les autres.
  //
  // Verification anti-robot : on ne peut pas la passer. Cloudflare veut une
  // navigation qui execute son script et pose le cookie de dispense ; un `fetch`
  // depuis la page n'en fait rien, quel que soit le nombre d'essais. La ligne
  // fautive reste donc en tete du lot, la barre offre un lien vers la page a
  // valider et un bouton Reprendre. Recharger la page de vente en masse, elle,
  // perdrait toute la grille saisie — d'ou le lien qui ouvre un onglet.
  //
  // Un seul nouvel essai automatique, apres une longue pause : le meme test
  // couvre le blocage passager (HTTP 429 apres une salve un peu vive), qui lui
  // se leve tout seul. S'il echoue aussi, c'est un vrai defi et on rend la main.
  var CHALLENGE_RETRY_MS = 15000;

  // Signale a la barre qu'une ligne a bute sur une verification anti-robot.
  var onChallengeRow = null;

  function injectRunAll() {
    var anchor = document.getElementById("BulkSubmit");
    if (!anchor || document.getElementById("cmext-price-bar")) return;

    var bar = document.createElement("div");
    bar.id = "cmext-price-bar";
    bar.className = "cmext-price-bar";

    function button(variant, label, hidden) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm " + variant;
      b.textContent = label;
      b.hidden = !!hidden;
      bar.appendChild(b);
      return b;
    }

    var run = button("btn-primary", msg("apAll"), false);
    var resume = button("btn-primary", msg("apResume"), true);
    resume.title = msg("apResumeHint");
    var stop = button("btn-secondary", msg("apStop"), true);

    // Un lien, pas un bouton : seule une vraie navigation leve la verification.
    var check = document.createElement("a");
    check.className = "btn btn-sm btn-warning cmext-price-check";
    check.target = "_blank";
    check.rel = "noopener";
    check.textContent = msg("apOpenCheck");
    check.title = msg("apOpenCheckHint");
    check.hidden = true;
    bar.appendChild(check);

    var status = document.createElement("span");
    status.className = "cmext-price-status";
    bar.appendChild(status);

    anchor.parentNode.insertBefore(bar, anchor);

    // Lot en cours ou interrompu. `i` designe la prochaine ligne a traiter et
    // n'avance qu'une fois la ligne chiffree : reprendre, c'est relancer la
    // meme boucle sans rien y toucher.
    var batch = null;
    var stopped = false;
    var running = false;

    function showCheck(row) {
      if (!row || !row.href) return;
      check.href = row.href;
      check.hidden = false;
    }

    onChallengeRow = function (row) {
      if (!running) showCheck(row);
    };

    stop.addEventListener("click", function () { stopped = true; });

    function runBatch() {
      stopped = false;
      running = true;
      run.disabled = true;
      stop.hidden = false;
      resume.hidden = true;
      check.hidden = true;

      var retried = false;

      function counters() {
        return [String(batch.filled), String(batch.done)];
      }

      function halt(text, challengedRow) {
        running = false;
        run.disabled = false;
        stop.hidden = true;
        // Reprendre n'a de sens que s'il reste des lignes.
        resume.hidden = batch.i >= batch.todo.length;
        showCheck(challengedRow);
        status.textContent = text;
      }

      // Attente visible : un compte a rebours muet passerait pour un blocage.
      function countdown(ms) {
        var until = Date.now() + ms;
        function tick() {
          var left = Math.ceil((until - Date.now()) / 1000);
          if (stopped || left <= 0) return Promise.resolve();
          status.textContent = msg("apChallengeRetry", [String(left)]);
          return CMExt.Market.sleep(Math.min(1000, Math.max(0, until - Date.now()))).then(tick);
        }
        return tick();
      }

      function next() {
        if (batch.i >= batch.todo.length) {
          halt(msg("apDone", counters()), null);
          return Promise.resolve();
        }
        if (stopped) {
          halt(msg("apStopped", counters()), null);
          return Promise.resolve();
        }

        var row = batch.todo[batch.i];
        // La grille a pu bouger pendant l'interruption : une ligne remise a
        // zero ou disparue ne vaut pas une requete.
        if (!row.tr.isConnected || quantityOf(row) <= 0) {
          batch.i++;
          return next();
        }

        status.textContent = msg("apProgress", [
          String(batch.i + 1), String(batch.todo.length), row.name
        ]);
        return priceRow(row).then(function (result) {
          if (result && result.challenge) {
            if (retried || stopped) {
              halt(msg("apChallengeStop", counters().concat([row.name])), row);
              return Promise.resolve();
            }
            retried = true;
            showCheck(row);
            return countdown(CHALLENGE_RETRY_MS).then(next);
          }
          retried = false;
          batch.i++;
          batch.done++;
          if (result && result.price !== null) batch.filled++;
          if (batch.i >= batch.todo.length || stopped) return next();
          return CMExt.Market.sleep(CMExt.Market.rand(800, 1600)).then(next);
        });
      }
      return next();
    }

    run.addEventListener("click", function () {
      var todo = allRows().filter(function (r) { return quantityOf(r) > 0; });
      if (!todo.length) {
        status.textContent = msg("apNothing");
        return;
      }
      batch = { todo: todo, i: 0, done: 0, filled: 0 };
      runBatch();
    });

    resume.addEventListener("click", function () {
      if (!batch || batch.i >= batch.todo.length) {
        resume.hidden = true;
        return;
      }
      runBatch();
    });
  }

  function setupAutoPrice(settings) {
    priceSettings = settings;
    if (!CMExt.Pricing || !CMExt.Market) {
      CMExt.log("BulkListing: prix conseille indisponible (modules manquants)");
      return null;
    }
    var rows = allRows();
    if (!rows.length) return null;
    injectButtons(rows);
    injectRunAll();
    CMExt.log("BulkListing: prix conseille actif", rows.length + " lignes");

    // Une ligne nee d'une copie n'a pas de bouton : on l'equipe a son apparition.
    return observeNewRows(function (added) {
      injectButtons(added.map(readRow).filter(Boolean));
    });
  }

  // Liste des fonctions de teardown des features actives, videe a chaque re-init.
  var teardowns = [];

  function init(settings) {
    // Avant tout le reste, et une seule fois : passe ce point, une ligne peut
    // deja avoir ete copiee a la souris, et son bouton clone serait pris pour
    // un bouton d'origine.
    markNativeCopyButtons();
    while (teardowns.length) {
      var fn = teardowns.pop();
      if (typeof fn === "function") fn();
    }
    if (settings.keyboardNavEnabled) teardowns.push(setupKeyboardNav(settings));
    if (settings.massModGuardsEnabled) teardowns.push(setupMassModGuards(settings));
    if (settings.rowCopyFixEnabled) teardowns.push(setupRowCopy());
    // Apres la rustine de copie : son observateur repose les valeurs de la
    // ligne source, le notre place ensuite le focus sur la ligne apparue.
    if (settings.conditionKeysEnabled) teardowns.push(setupConditionKeys());
    if (settings.autoPriceEnabled) teardowns.push(setupAutoPrice(settings));
  }

  CMExt.getSettings().then(function (settings) {
    CMExt.log("BulkListing toolkit charge");
    init(settings);
    // Re-lecture a chaud : on retire les listeners en place et on re-applique
    // les reglages a jour.
    CMExt.onChange(function (next) {
      CMExt.log("BulkListing: reglages mis a jour", next);
      init(next);
    });
  });
})();
