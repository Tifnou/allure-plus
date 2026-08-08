# Allure+

App perso de suivi sportif (Node.js/Express + JS vanilla), intégrée à Garmin Connect et Campus Coach. Utilisateur : Stéphane Martin (compte in-app `shiznogoud@gmail.com`).

## Architecture

- `server.js` — toutes les routes API, sessions en mémoire (cookie `sid`), auto-login via `.env`.
- `garmin_client.js` — wrapper autour de la lib `garmin-connect` (activités, VO2max, records calculés, etc.).
- `campus_client.js` — client Campus Coach (plans d'entraînement).
- `frontend/index.html` — page unique, toutes les "pages" sont des `<div class="page" id="page-X">` togglées en JS.
- `frontend/js/app.js` — dashboard, profil, activités, records (page shell), helpers globaux (`el`, `formatDate`, `formatPace`, `showToast`, `showConfirmModal`...).
- `frontend/js/campus.js` — Entraînements, Objectifs, tout ce qui touche aux plans Campus/importés.
- `frontend/js/plans.js` — catalogue de plans (wizard de recherche), chargement d'un plan.
- `frontend/js/stats.js` — page Statistiques (lignes par année, comparaison).
- `frontend/js/records.js` — page "Records et courses" (records éditables + tableau de courses).
- `frontend/js/health.js` — page "Santé/Performance" (2 catégories, cartes valeur+historique+commentaire personnalisé par indicateur).
- `frontend/css/style.css` — styles globaux ; `frontend/css/plans.css` — styles spécifiques à la page Plans.
- `zones.js` — source de vérité serveur des zones d'allure (`ALLURE_PLUS_ZONES`), utilisée par `server.js` et `xlsx_export.js`.
- Scripts chargés dans cet ordre dans `index.html` : `app.js`, `campus.js`, `stats.js`, `records.js`, `health.js`, `plans.js` — un `const`/`function` défini dans un script est utilisable par les scripts suivants (scope global partagé).

### Données persistantes protégées (jamais commitées, jamais écrasées par l'installeur)
- `data/records_overrides.json` — corrections manuelles des 5 records personnels.
- `data/races.json` — tableau "Mes courses" (saisie libre).
- `uploads/` — avatar utilisateur, diplômes de course (PDF/image).
- `Images/` — photos du diaporama de fond (jamais écrasé au reinstall si non-vide, voir `ShouldSeedImages` dans le `.iss`).
- Tous listés dans `.gitignore` ET exclus explicitement dans `installer/allure-plus.iss` (`Excludes` + `Check: ShouldSeedImages` pour `Images/`).

### Points d'architecture notables
- **Records personnels** (`/api/records`) : calculés par défaut depuis Garmin (`getPersonalRecords`, limité aux 200 dernières activités), mais **n'affichent rien tant que l'utilisateur n'a pas saisi une première valeur manuelle** (pas de pré-remplissage automatique). Une fois une correction manuelle en place, si une activité Garmin plus récente la bat, un bandeau propose de l'adopter (jamais de remplacement silencieux) — refus mémorisé dans `localStorage` pour ne pas reproposer la même activité en boucle.
- **Paliers D+ trail** (`TRAIL_DPLUS_TIERS` dans `server.js`) : référence unique (Peu vallonné/Vallonné/Montagneux/Très montagneux) par catégorie de distance (court/moyen/long/ultra), affichée sur la page Admin. Utilisée pour classer les plans du catalogue (`plans/trail/...`).
- **Barre "Avancement du plan"** (Objectifs) : position continue au prorata des jours écoulés (pas par semaine entière), graduations + numéro de semaine par section.
- **Version app** : `package.json` → champ `version`, affiché dans la sidebar (`v{version}`), exposé via `/api/status`. L'installeur (`#define MyAppVersion`) doit être synchronisé manuellement. Convention : bump à chaque fonctionnalité/correctif notable (minor pour feature, patch pour fix).
- **Page Santé/Performance** (`frontend/js/health.js`) : certaines métriques Garmin (Âge physique, Prédicteur de course, Score de montée, Score d'endurance, Tolérance de course) sont passées côté Garmin sur un proxy web `connect.garmin.com/gc-api/...` qui exige une session de navigateur (cookies + jeton anti-CSRF) — inaccessible depuis notre client OAuth (`connectapi.garmin.com`, utilisé par `garmin_client.js`), qui renvoie 403 sur ce chemin. Vérifié via DevTools sur le compte réel : aucune requête directe vers `connectapi.garmin.com` n'existe pour ces 5 métriques. Elles ne sont donc pas exposées dans Allure+ (chantier d'authentification navigateur complet jugé disproportionné pour 5 indicateurs secondaires) — ne pas retenter sans nouvelle piste concrète.
- **Statut d'entraînement** (Santé/Performance) : Garmin n'expose pas d'historique par API pour cet indicateur — Allure+ construit sa propre courbe en capturant un instantané par jour (`captureHealthSnapshot`, `data/health_snapshots.json`) à chaque consultation. Affiché en bande "façon Garmin Connect" (une case par jour, vide si non visité ce jour-là) plutôt qu'en tableau texte.
- **Zones d'allure (`ALLURE_PLUS_ZONES`)** : source de vérité **unique** dans `frontend/js/campus.js`, mirroir strict dans `zones.js` (serveur) — les deux fichiers doivent rester synchronisés manuellement (commentaires croisés dans chaque fichier). Toutes les autres surfaces qui affichent ces zones (tableau Allures du Profil, modale "Voir mes allures" dans Objectifs, carte "Allure EF" des indicateurs, `xlsx_export.js`) **lisent directement `ALLURE_PLUS_ZONES`** (via `calcAllureRef`/`calcAllureRefTrail` côté front, `getZoneRange` côté serveur) — ne jamais recréer une copie locale des % VMA, c'est exactement ce qui a causé un bug de zones incohérentes entre deux tableaux (nov. 2026). Le champ `fcZone` sur chaque entrée est une correspondance FC qualitative fournie par l'utilisateur (pas calculée), affichée en plage ("Z3 haute à Z4 basse") — jamais en valeur unique, une zone FC (%FC réserve) et une zone d'allure (%VMA) ne se recouvrant jamais exactement.
- **PPS (Pass Prévention Santé)** : à l'import d'un PDF, extraction du numéro/nom/date **en priorité via le QR code** du document (`pdfjs-dist` + `jsQR` dans `server.js`, fonction `extractPpsFromQr`) — le QR pointe vers une URL `pps.athle.fr` dont le paramètre `data` est un JSON structuré (base64url + zlib deflate), bien plus fiable que l'ancienne heuristique de position dans le texte brut du PDF (conservée en repli si le QR est absent/illisible, autre gabarit de PPS).
- **Cohérence des `page-header`** : tous les headers de page partagent la même position (coin haut-gauche, largeur) car `.page` (style.css) fixe un padding unique — **ne jamais ajouter de padding spécifique à une page** (`#page-X{padding:...}`) sans reprendre exactement `32px`/`36px` en haut/côtés, sous peine de décaler ce header par rapport aux autres. `scrollbar-gutter:stable` sur `html` évite aussi un décalage de ~4px selon qu'une page a ou non une barre de défilement.

## Conventions de travail

- **Commit après chaque correctif/fonctionnalité discrète**, message en français, format `Type: description courte` (Fix/Feat/Chore...).
- **Vérifier empiriquement dans le navigateur** après tout changement UI — les captures d'écran ne s'affichent pas dans cet environnement, utiliser `get_page_text`/`javascript_exec`/inspection DOM à la place.
- **Redémarrer le process Node** après tout changement dans `server.js`, `garmin_client.js` ou `campus_client.js` (pas de hot-reload).
- **Bump du `?v=` de cache-busting** dans `index.html` après tout changement dans un fichier JS/CSS frontend, sinon le navigateur sert l'ancienne version en cache.
- Un hook PostToolUse ouvre automatiquement un onglet `file://` parasite à chaque édition de `index.html` — le fermer et resélectionner le véritable onglet `http://localhost:3001` avant de tester.
- Pour distinguer une erreur console réelle d'un résidu périmé : comparer le `?v=` dans la stack trace de l'erreur avec le `?v=` actuel du fichier dans `index.html`.
- Compilation de l'installeur : `"/c/Users/martins/AppData/Local/Programs/Inno Setup 6/ISCC.exe" installer/allure-plus.iss` → sortie versionnée `installer/Output/AllurePlus_Setup_v{version}.exe`.
