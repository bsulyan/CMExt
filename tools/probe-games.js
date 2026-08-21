/*
 * probe-games.js — Sonde de reconnaissance, a coller dans la console du
 * navigateur sur cardmarket.com. Ne fait partie de l'extension a aucun moment.
 *
 * Pourquoi : les attributs d'une carte (1re edition, foil, signee, alteree,
 * reverse holo, playset...) ne sont pas ecrits en clair dans le HTML. Ce sont
 * des icones decoupees dans une image unique, reperees par leur position :
 * `style="background-position: -32px -16px"`. La correspondance
 * position -> attribut change d'un jeu a l'autre, et rien sur la page ne la
 * donne : il faut la relever.
 *
 * Usage (F12 -> Console -> coller -> Entree) :
 *
 *   1. CMProbe.games()    sur n'importe quelle page, une seule fois.
 *                         Releve la liste des jeux et leur segment d'URL.
 *
 *   2. CMProbe.icons()    sur une page produit de CHAQUE jeu, de preference
 *                         une carte tres vendue (beaucoup d'offres = plus de
 *                         chances de voir tous les attributs au moins une fois).
 *                         Site en anglais de preference : les libelles
 *                         releves servent a nommer les attributs.
 *
 *   3. CMProbe.fields()   sur une page BulkListing de CHAQUE jeu
 *                         (Stock > Ajouter des articles > Ajout en masse).
 *                         Releve les cases a cocher du formulaire.
 *
 * Chaque appel affiche un JSON et le copie dans le presse-papier.
 */
(function () {
  "use strict";

  function out(label, data) {
    var json = JSON.stringify(data, null, 2);
    console.log("%c" + label, "font-weight:bold;font-size:13px", data);
    console.log(json);
    try {
      copy(json); // fonction de la console, pas du JS standard
      console.log("%c-> copie dans le presse-papier", "color:green");
    } catch (e) {
      console.log("%c-> selectionner le JSON ci-dessus et le copier a la main",
                  "color:orange");
    }
    return data;
  }

  // Position de l'icone dans l'image-sprite. C'est cette paire (x, y) qui
  // identifie l'attribut ; y=0 est la ligne des langues, y=16 celle des extras
  // sur YuGiOh — a confirmer jeu par jeu, c'est tout l'objet de la sonde.
  function spritePos(node) {
    var inline = node.getAttribute("style") || "";
    var m = /background-position:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(inline);
    if (m) return { x: Math.abs(parseFloat(m[1])), y: Math.abs(parseFloat(m[2])) };

    // Repli : la position peut venir d'une classe CSS plutot que du style
    // inline. On la relit alors sur le style calcule.
    var computed = getComputedStyle(node).backgroundPosition || "";
    var c = /(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(computed);
    if (c) return { x: Math.abs(parseFloat(c[1])), y: Math.abs(parseFloat(c[2])) };
    return null;
  }

  // Ce que la page dit de l'icone, dans l'ordre de fiabilite decroissante.
  // Ces libelles sont traduits : ils servent a comprendre le releve, jamais a
  // identifier l'attribut dans le code de l'extension.
  function labelOf(node) {
    return node.getAttribute("aria-label") ||
           node.getAttribute("title") ||
           node.getAttribute("data-original-title") ||
           (node.querySelector("[title]") &&
            node.querySelector("[title]").getAttribute("title")) ||
           (node.querySelector("img") &&
            node.querySelector("img").getAttribute("alt")) ||
           "";
  }

  function gameFromPath() {
    return location.pathname.split("/")[2] || null;
  }

  var CMProbe = {

    // ---- 1. Liste des jeux -------------------------------------------------
    // Les jeux sont les liens de la forme /<langue>/<Jeu> presents dans la
    // navigation. On deduplique sur le segment de jeu.
    games: function () {
      var lang = location.pathname.split("/")[1] || "en";
      var seen = {};
      Array.prototype.slice.call(document.querySelectorAll('a[href^="/"]'))
        .forEach(function (a) {
          var m = new RegExp("^/" + lang + "/([A-Za-z0-9-]+)/?$")
            .exec(a.getAttribute("href"));
          if (!m) return;
          var seg = m[1];
          if (!seen[seg]) {
            seen[seg] = { segment: seg, label: a.textContent.trim().replace(/\s+/g, " ") };
          }
        });
      var games = Object.keys(seen).sort().map(function (k) { return seen[k]; });
      return out("Jeux detectes (" + games.length + ")", {
        siteLang: lang,
        note: "Ecarter a la main ce qui n'est pas un jeu (Account, Help, Magazine...).",
        games: games
      });
    },

    // ---- 2. Icones d'attributs sur une page produit ------------------------
    icons: function () {
      var rows = document.querySelectorAll('[id^="articleRow"]');
      var found = {};
      var containers = {};

      Array.prototype.slice.call(rows).forEach(function (row) {
        Array.prototype.slice.call(row.querySelectorAll("span.icon, .icon"))
          .forEach(function (icon) {
            var pos = spritePos(icon);
            if (!pos) return;
            var key = pos.x + "," + pos.y;
            var parent = icon.parentElement;
            var parentClass = parent ? (parent.className || "") : "";
            if (!found[key]) {
              found[key] = {
                x: pos.x,
                y: pos.y,
                label: labelOf(icon),
                classes: icon.className || "",
                parent: String(parentClass).trim(),
                seen: 0,
                sampleHTML: icon.outerHTML.slice(0, 200)
              };
            }
            found[key].seen++;
            if (!found[key].label) found[key].label = labelOf(icon);
            containers[String(parentClass).trim()] = true;
          });
      });

      var icons = Object.keys(found)
        .map(function (k) { return found[k]; })
        .sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });

      return out("Icones relevees (" + icons.length + ")", {
        game: gameFromPath(),
        url: location.pathname,
        articleRows: rows.length,
        containers: Object.keys(containers),
        warning: rows.length < 20
          ? "Peu d'offres sur cette page : certains attributs n'apparaissent probablement pas. Recommencer sur une carte plus vendue."
          : null,
        icons: icons
      });
    },

    // ---- 3. Champs du formulaire BulkListing -------------------------------
    // Ce sont eux qui disent quels attributs le jeu connait reellement
    // (`isFoil[0]`, `isFirstEd[0]`, `isReverseHolo[0]`...).
    fields: function () {
      var seen = {};
      Array.prototype.slice.call(document.querySelectorAll("input, select"))
        .forEach(function (el) {
          var name = el.getAttribute("name") || "";
          // On retire l'index de ligne : `isFoil[3]` et `isFoil[7]` sont le
          // meme champ.
          var base = name.replace(/\[\d+\]$/, "");
          if (!base) return;
          if (!/^(is[A-Z]|id[A-Z]|comments|amount|price)/.test(base)) return;
          if (!seen[base]) {
            seen[base] = { name: base, type: el.type || el.tagName.toLowerCase(), count: 0 };
            if (el.tagName === "SELECT") {
              seen[base].options = Array.prototype.slice.call(el.options)
                .map(function (o) { return o.value + " = " + o.textContent.trim(); });
            }
          }
          seen[base].count++;
        });

      var fields = Object.keys(seen).sort().map(function (k) { return seen[k]; });
      return out("Champs du formulaire (" + fields.length + ")", {
        game: gameFromPath(),
        url: location.pathname,
        fields: fields
      });
    }
  };

  window.CMProbe = CMProbe;
  console.log("%cCMProbe pret", "font-weight:bold;color:#06c",
              "— CMProbe.games() | CMProbe.icons() | CMProbe.fields()");
})();
