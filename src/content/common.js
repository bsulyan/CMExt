/*
 * common.js — Plomberie partagee par tous les content scripts et la page d'options.
 *
 * Expose un objet global `CMExt` avec :
 *   - DEFAULTS      : valeurs par defaut des reglages
 *   - getSettings() : lit les reglages (Promise), fusionnes avec les defauts
 *   - setSettings() : ecrit des reglages partiels (Promise)
 *   - onChange()    : s'abonne aux changements de reglages
 *   - log()         : log prefixe, actif seulement si le reglage `debug` est vrai
 *
 * Aucun appel reseau ici. Tout est local (chrome.storage.sync).
 */
(function () {
  "use strict";

  // Evite la double-initialisation si le script est injecte plusieurs fois.
  if (window.CMExt && window.CMExt.__ready) return;

  var STORAGE_KEY = "cmext.settings";

  // ---- Reglages par defaut --------------------------------------------------
  // Chaque feature lit ce dont elle a besoin ici. Ajouter un reglage = ajouter
  // une cle ici + un controle dans options.html/options.js.
  var DEFAULTS = {
    // Feature : raretes restaurees
    raritiesEnabled: true,

    // Feature : navigation clavier dans le BulkListing
    keyboardNavEnabled: true,
    // false => Haut/Bas modifient la quantite, Shift+Fleches deplacent dans la grille
    // true  => comportement inverse (Fleches deplacent, Shift+Haut/Bas modifient)
    invertNav: false,
    // Pas d'increment applique avec +/- et Haut/Bas
    quantityStep: 1,

    // Feature : garde-fous de la modification de masse
    massModGuardsEnabled: true,
    // Etat memorise des cases "ne pas toucher au prix / au nombre".
    // Se cochent automatiquement apres la premiere modif de masse.
    lockPriceOnMassMod: false,
    lockQuantityOnMassMod: false,

    // Divers
    debug: false
  };

  function getSettings() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(STORAGE_KEY, function (data) {
        var stored = (data && data[STORAGE_KEY]) || {};
        resolve(Object.assign({}, DEFAULTS, stored));
      });
    });
  }

  function setSettings(partial) {
    return getSettings().then(function (current) {
      var next = Object.assign({}, current, partial);
      return new Promise(function (resolve) {
        var payload = {};
        payload[STORAGE_KEY] = next;
        chrome.storage.sync.set(payload, function () {
          resolve(next);
        });
      });
    });
  }

  // Callback recoit (newSettings). Renvoie une fonction de desabonnement.
  function onChange(callback) {
    function listener(changes, area) {
      if (area !== "sync" || !changes[STORAGE_KEY]) return;
      var next = Object.assign({}, DEFAULTS, changes[STORAGE_KEY].newValue || {});
      callback(next);
    }
    chrome.storage.onChanged.addListener(listener);
    return function () {
      chrome.storage.onChanged.removeListener(listener);
    };
  }

  var _debug = false;
  function log() {
    if (!_debug) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("%c[CMExt]", "color:#7c3aed;font-weight:bold");
    console.log.apply(console, args);
  }
  // Synchronise le flag debug pour log().
  getSettings().then(function (s) { _debug = !!s.debug; });
  onChange(function (s) { _debug = !!s.debug; });

  window.CMExt = {
    __ready: true,
    STORAGE_KEY: STORAGE_KEY,
    DEFAULTS: DEFAULTS,
    getSettings: getSettings,
    setSettings: setSettings,
    onChange: onChange,
    log: log
  };
})();
