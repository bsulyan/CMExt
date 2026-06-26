# CardMarket YuGiOh Toolkit

Extension Chrome (Manifest V3) d'outillage pour les vendeurs YuGiOh sur CardMarket.
Uniquement de l'aide manuelle côté navigateur : **aucun bot, aucun appel réseau
automatisé**.

## Fonctionnalités

- **Raretés restaurées** — réaffiche les raretés YuGiOh « comme avant » sur les
  pages CardMarket.
- **Navigation clavier du BulkListing** — se déplacer entre les cellules
  (commentaire / nombre / prix / état / langue) au clavier.
  - Par défaut : `Haut` / `Bas` modifient la quantité, `Maj` + flèches déplacent
    dans la grille. `+` / `-` ajustent aussi la quantité.
  - Inversable depuis les réglages.
- **Garde-fous de la modification de masse** — cases pour neutraliser le
  changement de prix / de nombre, cochées automatiquement après la première
  modif de masse.

> État : **squelette du projet**. La plomberie (manifest, réglages, i18n) est en
> place ; les features sont stubées et seront implémentées une fois le DOM réel
> des pages inspecté.

## Installation (dev)

1. Ouvrir `chrome://extensions`.
2. Activer le **Mode développeur**.
3. **Charger l'extension non empaquetée** et sélectionner ce dossier.

## Structure

```
manifest.json            Manifest V3
_locales/                Traductions (en par défaut, fr ; suivra les langues de CardMarket)
  en/messages.json
  fr/messages.json
src/
  content/
    common.js            Réglages partagés (chrome.storage.sync) + helpers
    rarities.js          Restauration des raretés (stub)
    bulklisting.js       Navigation clavier + garde-fous modif de masse (stub)
  options/
    options.html|js|css  Page de réglages
styles/
  rarities.css           Styles raretés (stub)
  bulklisting.css        Styles BulkListing (stub)
```

## Langues

L'interface suit automatiquement la langue du navigateur (`chrome.i18n`), avec
repli sur l'anglais. Les langues prises en charge s'aligneront sur celles de
CardMarket.

## Principe

Outillage manuel uniquement. L'extension ne déclenche aucune requête vers
CardMarket de sa propre initiative : elle se contente d'améliorer l'ergonomie
des pages que l'utilisateur consulte et manipule lui-même.
