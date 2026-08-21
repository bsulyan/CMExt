# CardMarket YuGiOh Toolkit

Extension Chrome (Manifest V3) d'outillage pour les vendeurs YuGiOh sur CardMarket.
Uniquement de l'aide manuelle côté navigateur : **aucun bot, aucun appel réseau
automatisé**.

## Fonctionnalités

- **Navigation clavier du BulkListing** — se déplacer entre les cellules
  (commentaire / nombre / prix / état / langue) au clavier.
  - `Haut` / `Bas` changent de ligne, `Maj` + `Gauche` / `Droite` changent de
    colonne. `+` / `-` ajustent la quantité.
  - Les flèches verticales sont coupées même en haut et en bas de la grille :
    sur les menus état et langue, elles changeraient l'option sélectionnée.
- **Raccourcis d'état et de langue (BulkListing)** — sur une ligne, hors champ
  commentaire : `n` = Near Mint, `e` = Excellent, `g` = Good, `l` = Light Played,
  `p` = Played, `p` deux fois de suite = Poor, `!` fait défiler les langues,
  `f` coche ou décoche la 1re édition, `d` duplique la ligne.
  - La lettre agit depuis n'importe quelle cellule de la ligne (quantité, prix,
    menus déroulants) : le champ touché clignote pour montrer ce qui vient
    d'être posé, même quand le regard est ailleurs.
  - `p` pose Played à la première frappe et corrige en Poor à la seconde : le
    plus fréquent des deux est écrit tout de suite, sans délai d'attente. Une
    3e frappe repart de Played. `!` suit la même règle et fait le tour complet
    du menu langue, un cran par frappe : Français, Anglais, Allemand — les
    trois qui remplissent la grille — puis les autres dans l'ordre de
    CardMarket, et retour au Français. Les crans sont lus sur le menu de la
    ligne : une langue non proposée n'occupe pas de place dans la boucle.
  - `f` reste sans effet sur les extensions sans 1re édition, où CardMarket
    désactive la case (les tins, par exemple).
  - `d` amène le curseur sur la quantité de la plus basse des deux lignes —
    CardMarket insère sa copie au-dessus de la source, et on remplit la grille
    de haut en bas — et se répète autant de fois qu'on veut. Le bouton « Copier ligne » de CardMarket n'est câblé
    qu'au chargement : la ligne qu'il produit est un clone, et `cloneNode` ne
    recopie pas les écouteurs — son bouton ne répond plus à rien, on ne peut
    donc pas dupliquer une copie. Les boutons rendus par le serveur sont
    marqués, eux seuls sont cliqués ; sur les autres l'extension duplique
    elle-même (clone, identifiants de `<label>` régénérés pour que la case à
    cocher de la copie ne pilote pas celle de la source, valeurs des listes
    déroulantes reposées). La page n'ayant pas de bouton de suppression de
    ligne, la duplication maison n'intervient qu'après avoir vérifié qu'aucune
    ligne n'est apparue : jamais deux d'un coup.
  - Ces lettres remplacent la sélection par frappe des menus déroulants état et
    langue. Désactivable depuis les réglages.
- **Garde-fous de la modification de masse** — cases pour neutraliser le
  changement de prix / de nombre, cochées automatiquement après la première
  modif de masse.
- **Copie de ligne réparée (BulkListing)** — le bouton « Copier ligne » de
  CardMarket clone la ligne. Les champs texte gardent leur valeur (la spec HTML
  recopie la saisie des `<input>`), pas les listes déroulantes : la langue repart
  à Anglais et l'état à Near Mint à chaque copie. On repose les valeurs de la
  ligne d'origine sur la ligne apparue. Le nombre et le prix ne sont pas touchés,
  CardMarket les recopie déjà correctement.
- **Prix conseillé (BulkListing)** — un bouton par ligne remplie calcule le prix
  de vente à partir des offres du produit.
  - Les lignes nées d'une copie sont suivies comme les autres : bouton de prix
    réinjecté (celui hérité du clone n'écoute plus rien) et prise en compte par
    « Calculer les prix ». Chaque champ est lu **dans** sa ligne, jamais par un
    index global, sinon une ligne dupliquée écrirait son prix dans sa source.
  - Chaque offre est ramenée à un **équivalent Near Mint** (−10 points par cran
    d'état : EX = NM −10 %, GD = NM −20 %…), puis le coefficient de notre état
    est réappliqué. Une Played vendue plus cher qu'une NM ne peut donc jamais
    servir de référence.
  - Ce barème ne s'applique **que vers le bas** : une NM à 10 € donne une EX à
    9 €, mais une Played bradée à 0,02 € ne dit rien du prix d'une NM. Sur les
    cartes rétro et les grosses cotes, l'écart entre un exemplaire massacré et
    un bel exemplaire n'a rien de linéaire. Les offres en moins bon état que le
    nôtre sont donc écartées, et faute de référence en état égal ou meilleur
    aucun prix n'est proposé — à fixer à la main. Réglable (0 cran par défaut).
  - Seules les offres de la **même langue** et des mêmes attributs (foil, 1re
    édition, signée, altérée) sont comparées.
  - Le prix se place **sous l'offre la moins chère** : c'est elle que l'acheteur
    voit en premier. Une offre n'est écartée que si elle est anormalement
    basse, pas parce qu'elle est seule.
  - Détection des aberrations : on établit d'abord une référence de marché en
    cumulant les offres de la moins chère à la plus chère jusqu'à 4 exemplaires
    chez 2 vendeurs distincts, puis on ignore toute offre valant moins de la
    moitié de cette référence. Une carte isolée bradée à 0,02 € face à un marché
    à 1 € est ainsi écartée, alors qu'une offre à 0,75 € face à une référence à
    0,89 € est un vrai prix qu'on passe. Quinze exemplaires à 0,02 € chez un
    même vendeur font foi.
  - Garde-fou : le prix ne dépasse jamais celui d'une offre en état égal ou
    meilleur. Sous-cotation d'un centime par défaut, plancher 0,02 €.
  - La page produit est demandée avec les filtres `language` et `sellerCountry`
    (France par défaut) dans l'URL : la liste arrive donc déjà restreinte aux
    offres qui comptent, complète dès le premier chargement. On s'arrête dès
    qu'un prix peut être calculé — le tri par prix croissant garantit que la
    suite ne peut plus le changer. En pratique une requête par carte, résultats
    mis en cache 24 h dans `chrome.storage.local` (clé produit + langue + pays).
  - Seuils et localisation réglables dans les options.
  - **Vérification anti-robot** — elle ne se passe pas : Cloudflare veut une
    navigation qui exécute son script et pose le cookie de dispense, ce qu'un
    `fetch` depuis la page ne fera jamais, quel que soit le nombre d'essais.
    « Calculer les prix » laisse donc passer une longue pause (compte à rebours
    visible) et retente **une** fois la ligne fautive — ce qui suffit pour un
    blocage passager (HTTP 429 après une salve un peu vive). Si la vérification
    est réelle, le lot s'arrête sur cette ligne sans la consommer, et la barre
    affiche **Ouvrir la vérification** (la page visée, dans un nouvel onglet) et
    **Reprendre**, qui repart exactement là où le calcul s'est arrêté. Recharger
    la page de vente en masse perdrait toute la grille saisie : c'est justement
    ce que le nouvel onglet évite. Le bouton Reprendre sert aussi après un Stop.

- **Total des commandes** — sur les listes de commandes Ventes/Achats
  (`Orders/Sales/Paid`, `Orders/Sales/Unpaid`, etc.), affiche à côté du
  compteur « N Commandes » la somme des totaux des commandes de la page.
- **Outils stock** (panneau flottant sur les pages `Stock/Offers`) :
  - sur la liste des cartes, le bouton intégré « Modifier en masse » ouvre la
    multi-édition avec un périmètre verrouillé aux annonces visibles. Il ne suit
    pas la pagination et ne scanne aucune extension ;
  - **Base locale des emplacements** — un scan (déclenché à la main) parcourt le
    stock et stocke les articles dans `chrome.storage.local`. Les commentaires
    au format `1-02 - MZMU` (rack `1-02`, puis extension) sont agrégés en vue
    « Racks » : combien de cartes par rack, quelle extension est rangée où.
  - **Multi-édition** — choisir une extension (ou toutes), les annonces visées,
    une propriété (commentaire, prix, quantité, autre champ), un mode (valeur
    fixe, rechercher/remplacer, regex, prix conseillé), **prévisualiser**, puis
    appliquer article par article via le modal d'édition. Confirmation avec
    décompte, délais aléatoires entre requêtes, bouton Stop.
    - **Sélection des annonces** — filtre sur le commentaire (regex) et/ou sur
      le prix (`<=`, `>=`, `==`, `<`, `>`), combinables. Les deux filtres se
      lisent sur la liste de stock ; une annonce dont le prix n'a pas pu être lu
      est écartée du filtre prix et comptée dans le journal, jamais devinée.
      Exemple : « tout ce qui est à `<= 0,05` € passe à `0,02` € ».
    - **Écriture vérifiée** — la première modification d'une série est relue
      dans le formulaire pour confirmer que le site l'a bien gardée : CardMarket
      répond `200` même quand il ignore la saisie (mauvais format de nombre,
      champ inattendu). Si la valeur relue ne correspond pas, la série s'arrête
      immédiatement en affichant ce qui a été envoyé et ce qui a été relu, au
      lieu d'enchaîner deux cents requêtes sans rien changer. Le bouton
      **Inspecter un article** liste les champs du formulaire d'édition d'une
      annonce (nom exact et format des valeurs, jeton anti-CSRF masqué) sans
      rien modifier.
    - **Prix conseillé** — au lieu d'une valeur fixe, chaque annonce est
      rechiffrée avec le moteur de la page de vente en masse (mêmes offres,
      mêmes seuils, mêmes réglages, même cache 24 h). L'état, la langue et les
      attributs sont lus sur la ligne de stock ; une ligne illisible ou sans
      prix calculable est laissée telle quelle et signalée. Les annonces déjà au
      bon prix ne sont pas réécrites. Compter une requête par annonce hors
      cache : commencer par une extension.

> État : **squelette du projet**. La plomberie (manifest, réglages, i18n) est en
> place ; les features sont stubées et seront implémentées une fois le DOM réel
> des pages inspecté.

## Installation (dev)

1. Ouvrir `chrome://extensions`.
2. Activer le **Mode développeur**.
3. **Charger l'extension non empaquetée** et sélectionner ce dossier.

## Empaquetage

```powershell
powershell -ExecutionPolicy Bypass -File tools\pack.ps1
```

Produit `dist\cmext-<version>.zip` (~54 Ko) : `manifest.json` à la racine de
l'archive, les scripts, les styles et les traductions — rien d'autre. Le dépôt
pèse 3 Mo à cause des dumps de pages CardMarket gardés pour inspecter le DOM ;
zipper le dossier les embarquerait, en plus du `.git` et du README.

Le script refuse de produire une archive si un fichier déclaré dans le manifeste
manque, et signale l'inverse (un fichier embarqué que rien ne déclare). Les noms
d'entrées sont écrits avec des `/` : `Compress-Archive` utilise des `\`, ce que
la spec ZIP interdit et que le Chrome Web Store rejette.

Pour installer le ZIP : le décompresser et le charger comme un dossier non
empaqueté. Le bouton « Empaqueter l'extension » de `chrome://extensions` produit
un `.crx` + une clé `.pem`, seulement utile pour une distribution hors Store —
Chrome refuse d'installer un `.crx` posé à la main.

> Avant un dépôt sur le Chrome Web Store : le manifeste ne déclare aucune
> `icons`, et une icône 128×128 y est obligatoire.

## Structure

```
manifest.json            Manifest V3
_locales/                Traductions (en par défaut, fr ; suivra les langues de CardMarket)
  en/messages.json
  fr/messages.json
src/
  content/
    common.js            Réglages partagés (chrome.storage.sync) + helpers
    pricing.js           Moteur de calcul du prix conseillé (fonctions pures)
    marketdata.js        Récupération et cache local des offres d'un produit
    bulklisting.js       Navigation clavier, raccourcis d'etat, copie de ligne,
                         prix conseille + garde-fous modif de masse (stub)
    ordertotals.js       Total des commandes sur les listes Ventes/Achats
    stockdb.js           Base locale du stock (racks) + crawler + édition d'article
    stocktools.js        Panneau Outils stock : scan, vue racks, multi-édition
  options/
    options.html|js|css  Page de réglages
tools/
  pack.ps1               Fabrique dist\cmext-<version>.zip
styles/
  bulklisting.css        Styles BulkListing (stub)
  stocktools.css         Styles du panneau Outils stock
```

## Langues

L'interface suit automatiquement la langue du navigateur (`chrome.i18n`), avec
repli sur l'anglais. Les langues prises en charge s'aligneront sur celles de
CardMarket.

## Principe

Outillage manuel uniquement. L'extension ne déclenche aucune requête vers
CardMarket de sa propre initiative : elle se contente d'améliorer l'ergonomie
des pages que l'utilisateur consulte et manipule lui-même. Les Outils stock
(scan, prévisualisation, application) n'émettent des requêtes que sur clic
explicite, avec des délais aléatoires entre chaque requête.
