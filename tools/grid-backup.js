/*
 * grid-backup.js — Sauvegarde / restauration de la grille BulkListing.
 *
 * A coller dans la console de l'onglet BulkListing (F12 > Console). Definit
 * deux fonctions :
 *
 *   cmextGridDump()     avant de recharger : lit la grille et la range dans
 *                       localStorage (+ affiche le JSON en secours).
 *   cmextGridRestore()  apres le rechargement : recree les lignes dupliquees
 *                       puis repose toutes les valeurs.
 *
 * La sauvegarde DOIT etre faite sur l'onglet encore ouvert : le HTML d'une page
 * rechargee ne contient plus rien de ce qui a ete saisi (les <input> gardent
 * l'attribut `value` d'origine, seule la propriete change a la frappe).
 *
 * Les lignes sont appariees par idProduct, pas par index : apres une copie, deux
 * lignes partagent le meme index de `name` et CardMarket ne les renumerote pas.
 */
(function () {
  "use strict";

  var KEY = "cmext.gridBackup";

  function fieldIn(tr, name) {
    return tr.querySelector('[name^="' + name + '["]');
  }

  function rows() {
    var form = document.getElementById("BulkListingForm") || document;
    return Array.prototype.slice.call(form.querySelectorAll("tr")).filter(function (tr) {
      return !!fieldIn(tr, "amount");
    });
  }

  function idOf(tr) {
    var el = fieldIn(tr, "idProduct");
    return el ? el.value : null;
  }

  function val(tr, name, fallback) {
    var el = fieldIn(tr, name);
    return el ? el.value : fallback;
  }

  function checked(tr, name) {
    var el = fieldIn(tr, name);
    return !!(el && el.checked);
  }

  // ---- Sauvegarde -----------------------------------------------------------
  function cmextGridDump() {
    var data = rows().map(function (tr) {
      var link = tr.querySelector(".col-product a");
      return {
        idProduct: idOf(tr),
        name: link ? link.textContent.trim() : "",
        idLanguage: val(tr, "idLanguage", ""),
        idCondition: val(tr, "idCondition", ""),
        isSigned: checked(tr, "isSigned"),
        isFirstEd: checked(tr, "isFirstEd"),
        comments: val(tr, "comments", ""),
        amount: val(tr, "amount", "0"),
        price: val(tr, "price", "")
      };
    });

    var filled = data.filter(function (r) {
      return (parseInt(r.amount, 10) || 0) > 0 || r.price || r.comments;
    });

    localStorage.setItem(KEY, JSON.stringify(data));
    console.log("[CMExt] Sauvegarde : " + data.length + " lignes, " +
      filled.length + " remplies. Copie de secours ci-dessous :");
    console.log(JSON.stringify(data));
    return { total: data.length, filled: filled.length };
  }

  // ---- Restauration ---------------------------------------------------------
  function setValue(el, value) {
    if (!el || el.disabled || value === undefined || value === null) return;
    // Un <select> a qui l'on donne une option inconnue se vide : mieux vaut ne
    // rien faire que d'envoyer une ligne sans etat ni langue.
    if (el.tagName === "SELECT" && !el.querySelector('option[value="' + value + '"]')) return;
    if (el.value === String(value)) return;
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setChecked(el, value) {
    if (!el || el.disabled || el.checked === !!value) return;
    el.checked = !!value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function rowsOf(id) {
    return rows().filter(function (tr) { return idOf(tr) === id; });
  }

  function cmextGridRestore(json) {
    var raw = json || localStorage.getItem(KEY);
    var data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || !data.length) {
      console.warn("[CMExt] Aucune sauvegarde trouvee.");
      return Promise.resolve(null);
    }

    // Groupe par produit, dans l'ordre de la sauvegarde : un produit liste en
    // plusieurs etats occupe plusieurs lignes.
    var order = [];
    var groups = {};
    data.forEach(function (r) {
      if (!groups[r.idProduct]) { groups[r.idProduct] = []; order.push(r.idProduct); }
      groups[r.idProduct].push(r);
    });

    var report = { rows: 0, created: 0, missing: 0, failed: [] };

    // 1) Recreer les lignes manquantes. CardMarket insere sa copie au-dessus de
    // la source : la derniere ligne du groupe reste celle rendue par le serveur,
    // la seule dont le bouton "Copier ligne" soit cable.
    function createMissing(i) {
      if (i >= order.length) return Promise.resolve();
      var id = order[i];
      var need = groups[id].length;

      function step() {
        var current = rowsOf(id);
        if (!current.length) {
          console.warn("[CMExt] Produit absent de la page :", id, groups[id][0].name);
          report.missing += need;
          return Promise.resolve();
        }
        if (current.length >= need) return Promise.resolve();
        var btn = current[current.length - 1].querySelector(".copy-row-button");
        if (!btn) { report.failed.push(id); return Promise.resolve(); }
        btn.click();
        return sleep(60).then(function () {
          if (rowsOf(id).length <= current.length) {
            report.failed.push(id);
            return;
          }
          report.created++;
          return step();
        });
      }

      return step().then(function () { return createMissing(i + 1); });
    }

    // 2) Reposer les valeurs, ligne par ligne dans l'ordre de la page.
    function fill() {
      order.forEach(function (id) {
        var target = rowsOf(id);
        groups[id].forEach(function (entry, i) {
          var tr = target[i];
          if (!tr) { report.missing++; return; }
          setValue(fieldIn(tr, "idLanguage"), entry.idLanguage);
          setValue(fieldIn(tr, "idCondition"), entry.idCondition);
          setChecked(fieldIn(tr, "isSigned"), entry.isSigned);
          setChecked(fieldIn(tr, "isFirstEd"), entry.isFirstEd);
          setValue(fieldIn(tr, "comments"), entry.comments);
          setValue(fieldIn(tr, "amount"), entry.amount);
          setValue(fieldIn(tr, "price"), entry.price);
          report.rows++;
        });
      });
    }

    return createMissing(0).then(function () {
      fill();
      console.log("[CMExt] Restauration :", report);
      return report;
    });
  }

  window.cmextGridDump = cmextGridDump;
  window.cmextGridRestore = cmextGridRestore;
  console.log("[CMExt] Pret. cmextGridDump() avant de recharger, cmextGridRestore() apres.");
})();
