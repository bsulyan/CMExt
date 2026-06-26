/*
 * bulklisting.js — Outillage de la page BulkListing.
 *
 * Page cible (exemple) :
 *   /fr/YuGiOh/Stock/ListingMethods/BulkListing?idExpansion=1433&sortBy=number
 *
 * Features prevues (toutes manuelles, aucun appel reseau declenche par nous) :
 *   1. Navigation clavier dans la grille (commentaire / nombre / prix / etat / langue)
 *      - Par defaut : Haut/Bas modifient la quantite, Shift+Fleches deplacent.
 *      - Reglage `invertNav` pour inverser.
 *   2. + / - pour ajouter / enlever de la quantite.
 *   3. Garde-fous "modification de masse" : cases pour neutraliser le changement
 *      de prix / de nombre, qui se cochent automatiquement apres la 1re modif.
 *
 * Ce fichier est un SQUELETTE : les handlers sont stubes, la structure est posee.
 */
(function () {
  "use strict";

  function isBulkListingPage() {
    return /\/YuGiOh\/Stock\/ListingMethods\/BulkListing/i.test(location.pathname);
  }

  if (!isBulkListingPage()) return;

  var CMExt = window.CMExt;

  // ---- Navigation clavier ---------------------------------------------------
  // TODO: identifier les cellules de la grille (selecteurs des inputs
  // commentaire/nombre/prix/etat/langue) a partir du DOM reel de la page.
  function setupKeyboardNav(settings) {
    CMExt.log("BulkListing: keyboard nav (stub)", {
      invertNav: settings.invertNav,
      step: settings.quantityStep
    });

    // Esquisse de la logique a implementer :
    //
    // document.addEventListener("keydown", function (e) {
    //   var cell = getActiveCell(e.target);
    //   if (!cell) return;
    //
    //   var navWithShift = !settings.invertNav;
    //   var isNav  = navWithShift ? e.shiftKey : !e.shiftKey;
    //   var isQty  = navWithShift ? !e.shiftKey : e.shiftKey;
    //
    //   if (isNav  && isArrow(e.key))        moveFocus(cell, e.key);      // grille
    //   if (isQty  && isVerticalArrow(e.key)) bumpQuantity(cell, e.key, settings.quantityStep);
    //   if (e.key === "+" || e.key === "-")   bumpQuantity(cell, e.key, settings.quantityStep);
    // });
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

  function init(settings) {
    if (settings.keyboardNavEnabled) setupKeyboardNav(settings);
    if (settings.massModGuardsEnabled) setupMassModGuards(settings);
  }

  CMExt.getSettings().then(function (settings) {
    CMExt.log("BulkListing toolkit charge");
    init(settings);
    // Re-lecture a chaud des reglages : pour l'instant on log, la re-init fine
    // (retrait des listeners) sera geree quand les features seront implementees.
    CMExt.onChange(function (next) {
      CMExt.log("BulkListing: reglages mis a jour", next);
    });
  });
})();
