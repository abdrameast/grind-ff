# GRIND//FM

Un site d'une page : un CD 3D irisé, cliquable et rotatif, qui joue en audio seul les bandes-son de Jet Set Radio et de Jet Set Radio Future, sur un décor dessiné avec le personnage en parallaxe. Tout tient dans `index.html` (images comprises).

## Les deux disques

- **Disque 1, Jet Set Radio** (présenté par défaut à l'arrivée) : playlist « Jet Set Radio: The Complete Soundtrack ».
- **Disque 2, Jet Set Radio Future** : playlist « Jet Set Radio Future: The Complete Soundtrack ».

Pour changer de disque : le sélecteur JSR / JSRF dans le bandeau du bas, les onglets en haut de la tracklist, la touche C ou les touches 1 et 2. Le disque est éjecté puis le nouveau arrive face label, et les bâtiments du décor changent de couleur (vert pour Jet Set Radio, violet pour Jet Set Radio Future). Si la radio jouait, le nouveau disque démarre à sa première piste.

La playlist YouTube de Jet Set Radio compte 34 vidéos alors que la tracklist en a 35 : une vidéo n'est plus disponible sur YouTube. Le site rapproche chaque vidéo de la tracklist par son titre, donc l'affichage reste juste.

## Lancer en local

YouTube refuse les pages ouvertes en double-cliquant le fichier (`file://`) : il faut un petit serveur.

```
npx serve .
```

ou

```
python3 -m http.server 8000
```

Puis ouvre l'adresse affichée (par exemple http://localhost:3000).

## Mettre en ligne

Avec GitHub Pages, directement depuis ce dépôt : Settings → Pages → Build and deployment → Source « Deploy from a branch », branche `main`, dossier `/ (root)`. Le site est alors servi depuis `index.html` à la racine.

Autres hébergements statiques : Netlify Drop (glisser le dossier sur app.netlify.com/drop), Vercel, Cloudflare Pages, ton propre serveur…

N'ajoute pas de `Referrer-Policy` stricte (`no-referrer`, `same-origin`) : sans en-tête Referer, YouTube renvoie l'erreur 153.

## Commandes

| Geste ou touche | Action |
|---|---|
| Clic sur le disque | Lecture / pause |
| Glisser le disque | Le faire tourner (avec inertie) |
| Molette sur le disque | Volume |
| Clic sur le décor | Un coup de bombe |
| JSR / JSRF (bandeau) | Changer de disque |
| TRACKS | Tracklist (onglets des disques, clic sur une piste pour la lancer) |
| Espace | Lecture / pause |
| C | Disque suivant |
| 1, 2 | Disque 1 (Jet Set Radio), disque 2 (Jet Set Radio Future) |
| ← → | Piste précédente / suivante |
| ↑ ↓ | Volume |
| M | Couper le son |
| L | Label blanc ou argent |
| T | Tap tempo (mode AUTO) |
| S | Sync son |
| F | Plein écran |
| D | Réglages fins (calage du label, décor, effets, lumières) |
| ? | Aide |

## Visuels synchronisés sur le son

Le son sort d'un lecteur YouTube intégré, que la page ne peut pas écouter directement. Trois modes, choisis avec le bouton SYNC :

- **AUTO** (par défaut) : un tempo simulé, calé sur la position de lecture. Tape T en rythme pour caler le BPM ; il est mémorisé pour chaque piste.
- **LIVE** (Chrome ou Edge sur ordinateur) : « Partager l'onglet », choisis cet onglet et active le partage de l'audio. L'analyse se fait en direct dans le navigateur, rien n'est enregistré ni envoyé.
- **MICRO** : le micro écoute tes haut-parleurs. Utile sur téléphone, Firefox ou Safari.

## Personnaliser

Tout est dans l'objet `CONFIG`, en haut du script de `index.html` :

- `DEFAULT_DISC` : le disque présenté à l'arrivée (0 = Jet Set Radio).
- `DISCS` : la liste des disques. Pour chacun :
  - `playlistId` : l'identifiant de la playlist YouTube ;
  - `name`, `short`, `subtitle`, `year` : les textes affichés ;
  - `tracks` : la tracklist de référence (« Artiste - Titre »), facultative ; sans elle, les titres viennent de YouTube ;
  - `lines` : la couleur des bâtiments du décor pour ce disque (`null` = couleurs d'origine) ;
  - `label` : `url` d'un label perso (encre noire sur fond blanc, image carrée, disque centré, placée à côté de `index.html`) et calage (`offsetX`, `offsetY`, `scale`, `rotation`). La touche D permet de caler en direct.
- `labelMode` : `'white'` (sérigraphie blanche) ou `'silver'` (seul le trait est imprimé sur le miroir).
- `scene` : cadrage du décor (`focusX`, `focusXPortrait`, `focusY`, `zoom`), amplitude de la parallaxe (`parallaxBg`, `parallaxChar`), ombre tramée du personnage (`charShadow`), décalage du disque sur écran large (`discShiftX`).
- `YT_API_KEY` : clé YouTube Data API v3 facultative, pour charger tous les titres dès l'ouverture.
- `spin`, `motion`, `fx`, `audio`, `bpm`, `palette` : vitesses, effets, tempo par piste, couleurs.

Les images (labels des deux disques, décor, personnage) sont intégrées au fichier dans l'objet `ASSETS`. Le décor est ton illustration sans le personnage ; le personnage détouré est posé sur un calque séparé qui bouge un peu plus que le décor, d'où la parallaxe.

## Bon à savoir

- Sur téléphone, la première lecture peut demander de toucher une fois le lecteur YouTube (encart « TAP TO TUNE IN ») ; il redevient invisible ensuite.
- Masquer complètement le lecteur va contre les règles de l'API YouTube, qui demandent un lecteur visible d'au moins 200 × 200 px. C'est courant pour un projet perso ; pour un site public, prévois une option qui l'affiche.
- Une piste dont YouTube refuse l'intégration est marquée BLOCKED et sautée automatiquement.
- Si YouTube ne charge pas (bloqueur de pub, réseau), le site passe en mode démo : visuels sans son, avec un message.
- Sans WebGL, un disque 2D simplifié prend le relais et la radio fonctionne quand même.

Technique : Three.js 0.170 (jsDelivr), YouTube IFrame Player API, Web Audio API, polices Google Fonts (Dela Gothic One, Bungee, DotGothic16).

## Modifier le site

`index.html` est généré : on modifie les sources, puis on le reconstruit.

```
src/style.css        styles
src/body.html        structure de la page
src/js/a-core.js     CONFIG (disques, décor, effets), utilitaires, textures
src/js/b-scene.js    shaders, décor, disque 3D, animations
src/js/c-player.js   lecteur YouTube, titres, mode démo
src/js/d-audio.js    réactivité au son (AUTO, LIVE, MICRO)
src/js/e-fx2d.js     anneau spectral, gouttes, oscilloscope
src/js/f-ui.js       interface (bandeau, tracklist, sélecteur de disque)
src/js/g-main.js     boucle, entrées, changement de disque
assets_src/          images d'origine (labels scannés, décor, personnage détouré)
build/make_assets.py traite les images et écrit build/assets.json
build.py             assemble index.html
```

```
python3 build/make_assets.py   # seulement si les images de assets_src changent (Pillow, numpy, opencv-python)
python3 build.py               # régénère index.html
```

## Tests (facultatif)

`test/harness.py` ouvre le site dans Chromium sans écran, avec un faux lecteur YouTube (deux playlists simulées), et enregistre des captures dans `test/shots/`.

```
cd test && npm install
python3 harness.py discs 1440 900          # changement de disque
python3 harness.py basic 390 844 --mobile  # rendu téléphone
python3 harness.py demo_discs 1440 900 --block-yt
```

Il faut Python 3 avec Playwright (`pip install playwright`, puis `playwright install chromium`).
