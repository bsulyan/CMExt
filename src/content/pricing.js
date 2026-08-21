/*
 * pricing.js — Moteur de calcul du prix de vente conseille.
 *
 * Aucun DOM, aucun reseau : uniquement des fonctions pures qui prennent une
 * liste d'offres concurrentes et rendent un prix. Le parsing des offres et
 * l'injection dans la grille vivent dans bulklisting.js.
 *
 * Principe : chaque offre est ramenee a un prix "NM-equivalent" en la divisant
 * par le coefficient de son etat. Une Played a 1 EUR vaut 1.67 EUR NM-equivalent,
 * elle ne peut donc jamais servir de reference face a des NM a 0.50 EUR. Le cas
 * "la Played est plus chere que la NM" se resout tout seul, sans cas particulier.
 *
 * Le bareme d'etat ne s'applique que dans un sens : vers le BAS. Partir d'une NM
 * a 10 EUR pour en tirer une EX a 9 EUR est raisonnable ; partir d'une PL a
 * 0.02 EUR pour en tirer une NM a 0.03 EUR ne l'est pas. Sur les cartes retro et
 * sur les cartes cheres, l'ecart entre un exemplaire abime et un bel exemplaire
 * n'a rien de lineaire : une carte massacree part a 2 centimes alors que la meme
 * en bon etat vaut 10 EUR. Une offre d'etat inferieur au notre ne dit donc rien
 * de notre prix et n'entre pas dans le calcul (voir `maxUpgradeRanks`). Faute de
 * reference d'etat egal ou meilleur, on ne propose pas de prix : c'est le seul
 * resultat honnete, et il vaut mieux qu'une carte bradee par erreur.
 *
 * On se place sous l'offre la MOINS CHERE : c'est elle que l'acheteur voit en
 * premier. Une offre n'est ecartee que si elle est anormalement basse, pas
 * simplement parce qu'elle est seule — sans quoi on sauterait par-dessus des
 * prix parfaitement legitimes.
 *
 * Detection des aberrations en deux temps :
 *   1. Reference de marche : on remonte la liste triee en cumulant quantites et
 *      vendeurs jusqu'a `minQty` exemplaires chez `minSellers` vendeurs (ou un
 *      vendeur unique detenant un gros lot : 15 exemplaires a 0.02 EUR, c'est le
 *      vrai prix, pas du bruit).
 *   2. Prix retenu : la premiere offre, en partant de la moins chere, qui vaut
 *      au moins `outlierRatio` fois cette reference. En dessous, c'est une carte
 *      bradee et on l'ignore.
 *
 * Exemple : reference 0.89, offres 0.75 / 0.89 / 0.95 -> 0.75 est a 84 % de la
 * reference, c'est un vrai prix, on passe dessous (0.74). Avec des offres
 * 0.02 / 1.00 / 1.00, le 0.02 est a 2 % de la reference : on l'ignore.
 *
 * Forme attendue d'une offre (celle produite par marketdata.js) :
 *   { price, condition, language, quantity, seller,
 *     isFirstEd, isSigned, isAltered }
 * `price` est le prix UNITAIRE en euros et `language` l'idLanguage CardMarket
 * (1 Anglais, 2 Francais, 3 Allemand, 4 Espagnol, 5 Italien, 8 Portugais),
 * le meme identifiant que le <select> de la grille BulkListing.
 */
(function () {
  "use strict";

  if (!window.CMExt || window.CMExt.Pricing) return;
  var CMExt = window.CMExt;

  // Echelle CardMarket, du meilleur au pire etat.
  var CONDITIONS = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];

  // Coefficient applique au prix NM-equivalent : -10 points par cran depuis NM
  // (EX = NM -10 %, GD = NM -20 %...). Baremes lineaires, pas composes.
  // MT est traite comme NM : on ne paie pas de prime pour un "Mint" declaratif,
  // et on ne se laisse pas tirer vers le haut par une annonce MT.
  var COEF = { MT: 1.00, NM: 1.00, EX: 0.90, GD: 0.80, LP: 0.70, PL: 0.60, PO: 0.50 };

  // Palier d'etat : le cran du bareme, pas la position dans CONDITIONS. MT et NM
  // partagent le palier 0 puisqu'ils partagent le coefficient — sans quoi une
  // ligne MT ne pourrait se comparer a aucune NM, alors qu'on les paie pareil.
  var TIER = { MT: 0, NM: 0, EX: 1, GD: 2, LP: 3, PL: 4, PO: 5 };

  // Valeurs du <select name="idCondition[N]"> de la grille BulkListing.
  var CONDITION_BY_ID = { 1: "MT", 2: "NM", 3: "EX", 4: "GD", 5: "LP", 6: "PL", 7: "PO" };

  // Prix plancher CardMarket.
  var FLOOR = 0.02;

  var DEFAULT_OPTS = {
    // Reference de marche : quantite cumulee a atteindre en remontant depuis
    // l'offre la moins chere. Ne fixe pas le prix, sert d'etalon aux aberrations.
    minQty: 4,
    // Nombre de vendeurs distincts a atteindre en meme temps.
    minSellers: 2,
    // ... sauf si un vendeur unique detient au moins ce nombre d'exemplaires :
    // un gros lot au meme prix est une information de marche, pas du bruit.
    soloSellerQty: 10,
    // Une offre valant moins que cette fraction de la reference est traitee
    // comme une carte bradee et ignoree. 0.5 = "moitie prix ou moins".
    outlierRatio: 0.5,
    // Nombre minimum d'offres comparables sous peine de renvoyer "none".
    minOffers: 3,
    // Nombre de crans d'etat qu'on accepte de remonter depuis une offre pour en
    // deduire notre prix. 0 = aucune extrapolation vers le haut : seules les
    // offres d'etat egal ou meilleur font le prix. Le mettre a 1 autorise une EX
    // a servir de reference pour une NM (+11 %), et ainsi de suite. Au-dela de 1,
    // on parle de cartes abimees bradees : elles ne disent rien du prix d'un bel
    // exemplaire, surtout en retro et sur les grosses cotes.
    maxUpgradeRanks: 0,
    // Montant retire au prix retenu pour passer devant.
    undercut: 0.01
  };

  // Traduit les reglages utilisateur (des chaines, telles que sorties du
  // storage) en options du moteur. Partage par le BulkListing et les Outils
  // stock : les deux doivent chiffrer exactement de la meme facon.
  function optsFromSettings(settings) {
    var s = settings || {};
    return {
      minQty: parseInt(s.priceMinQty, 10) || DEFAULT_OPTS.minQty,
      minSellers: parseInt(s.priceMinSellers, 10) || DEFAULT_OPTS.minSellers,
      soloSellerQty: parseInt(s.priceSoloSellerQty, 10) || DEFAULT_OPTS.soloSellerQty,
      outlierRatio: parseFloat(s.priceOutlierRatio) || DEFAULT_OPTS.outlierRatio,
      // Volontairement sans `||` : 0 est la valeur utile, pas une valeur vide.
      maxUpgradeRanks: Math.max(0, parseInt(s.priceMaxUpgradeRanks, 10) || 0),
      minOffers: parseInt(s.priceMinOffers, 10) || DEFAULT_OPTS.minOffers,
      undercut: parseFloat(s.priceUndercut) || DEFAULT_OPTS.undercut
    };
  }

  function rank(condition) {
    return CONDITIONS.indexOf(String(condition || "").toUpperCase());
  }

  function coef(condition) {
    var c = COEF[String(condition || "").toUpperCase()];
    return typeof c === "number" ? c : null;
  }

  function tier(condition) {
    var t = TIER[String(condition || "").toUpperCase()];
    return typeof t === "number" ? t : null;
  }

  // Une offre ne fait le prix que si son etat est au moins aussi bon que le
  // notre, a `maxUpgradeRanks` crans de tolerance pres. Sens unique assume : le
  // bareme sait descendre un prix, il ne sait pas le remonter.
  function isUsableCondition(offer, target, opts) {
    var to = tier(offer.condition);
    var tt = tier(target.condition);
    if (to === null || tt === null) return false;
    return to - tt <= (opts.maxUpgradeRanks || 0);
  }

  // Arrondi au centime inferieur : on ne monte jamais un prix par arrondi.
  function floorCent(value) {
    return Math.floor(value * 100 + 1e-6) / 100;
  }

  function sameFlag(a, b) {
    return !!a === !!b;
  }

  // Une offre est comparable si elle porte exactement les memes attributs que
  // notre ligne : une 1re edition et une unlimited n'ont rien a voir, une carte
  // signee ou alteree non plus.
  function isComparable(offer, target) {
    if (!offer || typeof offer.price !== "number" || !(offer.price > 0)) return false;
    if (rank(offer.condition) === -1) return false;
    if (Number(offer.language) !== Number(target.language)) return false;
    if (!sameFlag(offer.isFirstEd, target.isFirstEd)) return false;
    if (!sameFlag(offer.isSigned, target.isSigned)) return false;
    if (!sameFlag(offer.isAltered, target.isAltered)) return false;
    if (target.excludeSellers && target.excludeSellers.indexOf(offer.seller) !== -1) return false;
    return true;
  }

  // Prix NM-equivalent d'une offre.
  function normalize(offer) {
    return offer.price / coef(offer.condition);
  }

  function sortBy(offers, key) {
    return offers.slice().sort(function (a, b) { return a[key] - b[key]; });
  }

  // Reference de marche : on remonte la liste triee par prix croissant (`key`)
  // en cumulant quantites et vendeurs distincts, et on s'arrete au premier
  // palier ou les seuils sont atteints — le prix auquel un acheteur peut
  // reellement se fournir.
  //
  // Ce n'est PAS le prix de vente : il sert d'etalon pour reperer les offres
  // anormalement basses (voir cheapestSane).
  //
  // Renvoie { priceNM, qty, sellers, used } ou null si le stock disponible
  // n'atteint jamais les seuils.
  function selectMarket(offers, opts, key) {
    key = key || "priceNM";
    var sorted = sortBy(offers, key);

    var qty = 0;
    var sellers = {};
    var sellerCount = 0;
    var used = [];

    for (var i = 0; i < sorted.length; i++) {
      var o = sorted[i];
      var q = o.quantity > 0 ? o.quantity : 1;
      qty += q;
      used.push(o);
      var sellerKey = o.seller || "?" + i;
      if (!sellers[sellerKey]) {
        sellers[sellerKey] = 0;
        sellerCount++;
      }
      sellers[sellerKey] += q;

      // Un lot suffisamment gros chez un seul vendeur vaut confirmation.
      var solo = sellerCount === 1 && sellers[sellerKey] >= opts.soloSellerQty;
      var confirmed = qty >= opts.minQty && (sellerCount >= opts.minSellers || solo);

      if (confirmed) {
        return { priceNM: o[key], qty: qty, sellers: sellerCount, used: used };
      }
    }
    return null;
  }

  // L'offre la moins chere qui ne soit pas une aberration : la premiere, en
  // partant du bas, a valoir au moins `outlierRatio` fois la reference. La
  // reference elle-meme passe toujours le test, la recherche aboutit donc.
  //
  // Renvoie { value, skipped } ou `skipped` compte les offres ecartees.
  function cheapestSane(offers, reference, opts, key) {
    key = key || "priceNM";
    var minimum = reference * opts.outlierRatio;
    var sorted = sortBy(offers, key);
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i][key] >= minimum) return { value: sorted[i][key], skipped: i };
    }
    return { value: reference, skipped: sorted.length };
  }

  // Plafond : on ne se place pas au-dessus des etats egaux ou meilleurs que le
  // notre. Ce garde-fou ne peut que baisser le prix, jamais le monter.
  //
  // Meme logique que le calcul principal, sur les prix bruts cette fois : une
  // carte isolee bradee en Near Mint ne doit pas plus faire le prix ici
  // qu'ailleurs, sinon le plafond rouvrirait la porte aux aberrations.
  function ceilingFromBetterConditions(offers, targetCondition, opts) {
    var t = tier(targetCondition);
    var better = offers.filter(function (o) {
      return tier(o.condition) <= t; // palier plus petit = etat egal ou meilleur
    });
    if (!better.length) return null;
    var reference = selectMarket(better, opts, "price");
    if (!reference) return null;
    return cheapestSane(better, reference.priceNM, opts, "price").value;
  }

  /*
   * Calcule le prix conseille.
   *
   * target : { condition, language, isFoil, isSigned, isAltered, isFirstEd,
   *            excludeSellers }
   * opts   : surcharges de DEFAULT_OPTS
   *
   * Renvoie :
   *   { price, marketNM, referenceNM, skipped, confidence, reason,
   *     comparable, qty, sellers, cappedBy, used }
   *   marketNM    : l'offre retenue, en NM-equivalent (celle qu'on sous-cote)
   *   referenceNM : l'etalon ayant servi a juger les aberrations
   *   skipped     : nombre d'offres ecartees comme anormalement basses
   *   confidence  : "ok"   -> prix utilisable
   *                 "weak" -> calcule mais peu d'offres, a verifier
   *                 "none" -> pas de prix, `reason` dit pourquoi
   */
  function suggest(rawOffers, target, opts) {
    opts = Object.assign({}, DEFAULT_OPTS, opts || {});

    if (coef(target.condition) === null) {
      return { price: null, confidence: "none", reason: "unknownCondition", comparable: 0 };
    }

    var matching = (rawOffers || []).filter(function (o) {
      return isComparable(o, target);
    });

    if (!matching.length) {
      return { price: null, confidence: "none", reason: "noComparableOffer", comparable: 0 };
    }

    // Les exemplaires d'etat inferieur sortent du calcul : ils tireraient le prix
    // vers le bas sans rien prouver. On garde leur nombre pour l'expliquer.
    var comparable = matching.filter(function (o) {
      return isUsableCondition(o, target, opts);
    }).map(function (o) {
      return Object.assign({}, o, { priceNM: normalize(o) });
    });
    var worseIgnored = matching.length - comparable.length;

    if (!comparable.length) {
      return {
        price: null,
        confidence: "none",
        reason: "noBetterCondition",
        comparable: 0,
        worseIgnored: worseIgnored,
        used: sortBy(matching, "price")
      };
    }

    var reference = selectMarket(comparable, opts);
    if (!reference) {
      // Pas de reference : on rend quand meme ce qu'on a trouve, c'est la seule
      // facon de comprendre pourquoi le sous-ensemble comparable est trop mince.
      return {
        price: null,
        confidence: "none",
        reason: "notEnoughStock",
        comparable: comparable.length,
        worseIgnored: worseIgnored,
        used: sortBy(comparable, "priceNM")
      };
    }

    // On vise l'offre la moins chere qui tienne debout, pas la reference : c'est
    // celle-la que l'acheteur voit en premier, et la seule qu'il faille passer.
    var market = cheapestSane(comparable, reference.priceNM, opts);

    // Prix retenu ramene a notre etat, puis sous-cotation.
    var price = floorCent(market.value * coef(target.condition));
    price = floorCent(price - opts.undercut);

    // Plafond : jamais au-dessus d'une offre d'etat egal ou meilleur.
    var cappedBy = null;
    var ceiling = ceilingFromBetterConditions(comparable, target.condition, opts);
    if (ceiling !== null && price >= ceiling) {
      cappedBy = ceiling;
      price = floorCent(ceiling - opts.undercut);
    }

    if (price < FLOOR) price = FLOOR;

    return {
      price: price,
      marketNM: market.value,
      referenceNM: reference.priceNM,
      skipped: market.skipped,
      confidence: comparable.length >= opts.minOffers ? "ok" : "weak",
      reason: null,
      comparable: comparable.length,
      worseIgnored: worseIgnored,
      qty: reference.qty,
      sellers: reference.sellers,
      cappedBy: cappedBy,
      used: reference.used
    };
  }

  CMExt.Pricing = {
    CONDITIONS: CONDITIONS,
    CONDITION_BY_ID: CONDITION_BY_ID,
    COEF: COEF,
    TIER: TIER,
    FLOOR: FLOOR,
    DEFAULT_OPTS: DEFAULT_OPTS,
    optsFromSettings: optsFromSettings,
    rank: rank,
    coef: coef,
    tier: tier,
    floorCent: floorCent,
    isComparable: isComparable,
    isUsableCondition: isUsableCondition,
    normalize: normalize,
    selectMarket: selectMarket,
    cheapestSane: cheapestSane,
    suggest: suggest
  };
})();
