/*
 * rarities.js — Restaure l'affichage des raretes YuGiOh "comme avant".
 *
 * S'applique a toutes les pages YuGiOh de CardMarket (listings, stock, etc.).
 *
 * POINT DUR A VALIDER avant d'implementer : la rarete est-elle encore presente
 * dans le DOM (masquee / deplacee par CSS) ou bien retiree du HTML ?
 *   - Si presente -> on la re-affiche ici + styles/rarities.css (100% local).
 *   - Si retiree  -> a rediscuter (on s'interdit les appels reseau automatiques).
 *
 * Ce fichier est un SQUELETTE : detection de page + point d'entree, sans logique.
 */
(function () {
  "use strict";

  var CMExt = window.CMExt;

  // TODO: restreindre aux pages pertinentes une fois le DOM reel inspecte.
  function isRarityRelevantPage() {
    return /\/YuGiOh\//i.test(location.pathname);
  }

  if (!isRarityRelevantPage()) return;

  // TODO: localiser les noeuds de rarete (data-attribut, span cache, tooltip...)
  // et les re-afficher a l'emplacement voulu.
  function restoreRarities() {
    CMExt.log("Rarities: restoration (stub) — en attente du DOM reel de la page");
  }

  CMExt.getSettings().then(function (settings) {
    if (!settings.raritiesEnabled) return;
    CMExt.log("Rarities toolkit charge");
    restoreRarities();

    // Le contenu CardMarket peut etre injecte/pagine dynamiquement : on observera
    // les mutations pour re-appliquer. Stub pour l'instant.
    // var obs = new MutationObserver(restoreRarities);
    // obs.observe(document.body, { childList: true, subtree: true });
  });
})();
