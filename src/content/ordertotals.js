/*
 * ordertotals.js — Total des commandes sur les listes Ventes / Achats.
 *
 * Sur les pages Orders/Sales/* et Orders/Purchases/* (Payée, À payer, etc.),
 * ajoute a cote du compteur « N Commandes » la somme des totaux des commandes
 * affichees sur la page.
 *
 * Purement local : lecture du DOM, aucun appel reseau. Recalcule quand le
 * tableau est mis a jour (pagination AJAX de CardMarket).
 */
(function () {
  "use strict";

  function isOrderListPage() {
    return /\/YuGiOh\/Orders\/(Sales|Purchases)\/[A-Za-z]+\/?$/i.test(location.pathname);
  }
  if (!isOrderListPage()) return;

  var CMExt = window.CMExt;

  var BADGE_CLASS = "cmext-order-total";

  function t(key, fallback, subs) {
    var msg = chrome.i18n.getMessage(key, subs);
    if (msg) return msg;
    if (!subs) return fallback;
    return fallback.replace(/\$(\d)/g, function (_, i) {
      var v = subs[parseInt(i, 10) - 1];
      return v == null ? "" : String(v);
    });
  }

  // "1.234,56 €" -> 1234.56 ; renvoie NaN si illisible.
  function parsePrice(text) {
    var m = String(text).replace(/ /g, " ").match(/-?[\d.\s]*\d,\d{2}/);
    if (!m) return NaN;
    return parseFloat(m[0].replace(/[.\s]/g, "").replace(",", "."));
  }

  // 1234.56 -> "1.234,56 €" (meme format que CardMarket).
  function formatPrice(value) {
    var fixed = value.toFixed(2);
    var parts = fixed.split(".");
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return int + "," + parts[1] + " €";
  }

  function computeTotal() {
    var cells = document.querySelectorAll("#StatusTable .table-body .col-price");
    var sum = 0;
    var count = 0;
    for (var i = 0; i < cells.length; i++) {
      var v = parsePrice(cells[i].textContent);
      if (!isNaN(v)) {
        sum += v;
        count++;
      }
    }
    return { sum: sum, count: count };
  }

  // Plusieurs pages ? -> le total ne couvre que la page affichee.
  function hasMultiplePages() {
    var span = document.querySelector("#StatusTableWrapper .pagination span.mx-1");
    if (!span) return false;
    var m = span.textContent.match(/(\d+)\s*$/);
    return !!m && parseInt(m[1], 10) > 1;
  }

  function removeBadges() {
    var old = document.querySelectorAll("." + BADGE_CLASS);
    for (var i = 0; i < old.length; i++) old[i].remove();
  }

  function render() {
    removeBadges();

    var countEl = document.querySelector("#StatusTableWrapper .pagination .total-count");
    if (!countEl) return;

    var res = computeTotal();
    if (!res.count) return;

    var label = hasMultiplePages()
      ? t("otPageTotal", "Total page : $1", [formatPrice(res.sum)])
      : t("otTotal", "Total : $1", [formatPrice(res.sum)]);

    var badge = document.createElement("span");
    badge.className = BADGE_CLASS + " ms-2 fw-bold text-success";
    badge.textContent = "(" + label + ")";

    // Le compteur est structure « <span><span class=total-count>8</span><span> Commandes</span></span> » :
    // on accroche le badge apres ce groupe.
    var group = countEl.parentElement || countEl;
    group.appendChild(badge);

    CMExt.log("ordertotals:", res.count, "commandes,", formatPrice(res.sum));
  }

  // ---- Observation du tableau (pagination AJAX) -----------------------------
  var observer = null;
  var renderTimer = null;

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 150);
  }

  function start() {
    render();
    if (observer) return;
    var wrapper = document.getElementById("StatusTableWrapper");
    if (!wrapper) return;
    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var target = mutations[i].target;
        // Ignore nos propres ecritures pour ne pas boucler.
        if (target && target.closest && target.closest("." + BADGE_CLASS)) continue;
        if (mutations[i].addedNodes.length === 1 &&
            mutations[i].addedNodes[0].nodeType === 1 &&
            mutations[i].addedNodes[0].classList.contains(BADGE_CLASS)) continue;
        scheduleRender();
        return;
      }
    });
    observer.observe(wrapper, { childList: true, subtree: true });
  }

  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(renderTimer);
    removeBadges();
  }

  CMExt.getSettings().then(function (s) {
    if (s.orderTotalsEnabled) start();
  });

  CMExt.onChange(function (s) {
    if (s.orderTotalsEnabled) start();
    else stop();
  });
})();
