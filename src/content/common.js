/*
 * common.js — Plomberie partagee par tous les content scripts et la page d'options.
 *
 * Expose un objet global `CMExt` avec :
 *   - DEFAULTS      : valeurs par defaut des reglages
 *   - getSettings() : lit les reglages (Promise), fusionnes avec les defauts
 *   - setSettings() : ecrit des reglages partiels (Promise)
 *   - onChange()    : s'abonne aux changements de reglages
 *   - log()         : log prefixe, actif seulement si le reglage `debug` est vrai
 *   - warn()        : idem mais toujours actif (console.warn) — pannes silencieuses
 *   - isChallenge() : detecte une page de verification Cloudflare
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
    // Feature : navigation clavier dans le BulkListing
    // Haut/Bas changent de ligne, Shift+Gauche/Droite changent de colonne.
    keyboardNavEnabled: true,
    // Pas d'increment applique avec + / -
    quantityStep: 1,

    // Feature : raccourcis sur une ligne du BulkListing, hors champ commentaire
    // (n/e/g/l/p pour l'etat, p deux fois = Poor, ! fait defiler les langues,
    // f pour la 1re edition, d pour dupliquer).
    conditionKeysEnabled: true,

    // Feature : garde-fous de la modification de masse
    massModGuardsEnabled: true,
    // Etat memorise des cases "ne pas toucher au prix / au nombre".
    // Se cochent automatiquement apres la premiere modif de masse.
    lockPriceOnMassMod: false,
    lockQuantityOnMassMod: false,

    // Feature : rustine du bouton "Copier ligne" de CardMarket, qui clone la
    // ligne au lieu d'en recopier les valeurs — la langue repart a Anglais.
    rowCopyFixEnabled: true,

    // Feature : prix conseille sur le BulkListing (voir pricing.js).
    autoPriceEnabled: true,
    // Reference de marche : quantite cumulee et nombre de vendeurs distincts a
    // atteindre en remontant depuis l'offre la moins chere. Cette reference ne
    // fixe pas le prix, elle sert d'etalon pour reperer les cartes bradees.
    priceMinQty: 4,
    priceMinSellers: 2,
    // Exception : un vendeur unique fait foi s'il detient au moins ce nombre
    // d'exemplaires au meme prix (15 cartes a 0.02 EUR = c'est le vrai prix).
    priceSoloSellerQty: 10,
    // Une offre valant moins que cette fraction de la reference est ignoree.
    priceOutlierRatio: 0.5,
    // Crans d'etat qu'on accepte de remonter pour deduire un prix. 0 = seules
    // les offres d'etat egal ou meilleur comptent : une PL bradee a 0.02 EUR ne
    // dit rien du prix d'une NM, surtout en retro et sur les grosses cotes.
    priceMaxUpgradeRanks: 0,
    // Localisation du vendeur pour la recherche d'offres (identifiant CardMarket,
    // 12 = France). Vide ou 0 : tous les pays. Le prix se compare a ce que
    // l'acheteur voit vraiment, pas a une offre expediee d'Italie.
    priceSellerCountry: 12,
    // En dessous de ce nombre d'offres comparables, le prix est marque "faible".
    priceMinOffers: 3,
    // Montant retire au prix de marche pour passer devant (en euros).
    priceUndercut: 0.01,
    // Duree de validite du cache des offres, en heures.
    priceCacheHours: 24,

    // Feature : outils stock (base locale des racks + multi-edition).
    // La base elle-meme vit dans chrome.storage.local (cle "cmext.stockdb").
    stockToolsEnabled: true,

    // Feature : total des commandes sur les listes Ventes / Achats
    orderTotalsEnabled: true,

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

  // Toujours actif : sert aux pannes qui, sans ca, ne laissent aucune trace
  // (verification anti-robot, page dont le HTML a change sous nos pieds).
  function warn() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[CMExt]");
    console.warn.apply(console, args);
  }

  // ---- Verification anti-robot ---------------------------------------------
  // Cloudflare sert sa page de verification a la place du contenu demande, et
  // parfois en HTTP 200. Sans ce test on parse une page sans annonces et on
  // conclut "aucune offre" — resultat faux, et pire, mis en cache.
  var CHALLENGE_RE = /cf-browser-verification|challenge-platform|__cf_chl|cf_chl_opt|cf-turnstile|<title>\s*Just a moment/i;

  function isChallenge(res, body) {
    if (res.status === 403 || res.status === 429 || res.status === 503) return true;
    if (res.headers && res.headers.get("cf-mitigated")) return true;
    return CHALLENGE_RE.test(body || "");
  }

  // Erreur reconnaissable en aval : l'UI doit dire "valide la verification",
  // pas "donnees insuffisantes".
  function challengeError() {
    var err = new Error("cloudflare-challenge");
    err.cmextChallenge = true;
    return err;
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
    log: log,
    warn: warn,
    isChallenge: isChallenge,
    challengeError: challengeError
  };
})();
