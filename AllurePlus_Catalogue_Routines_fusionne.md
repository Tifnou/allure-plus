# Catalogue fusionné des séances « hors plan »

Généré depuis `frontend/js/routine_catalog.js` (ne pas éditer à la main). Les durées sont **calculées** par le compilateur (et testées contre les totaux du cahier des charges).

- **Source « cahier »** : les 120 modèles du cahier des charges V1.0.
- **Source « existant »** : séances déjà proposées par Allure+ (`free_sessions.js`) sans équivalent dans le cahier. Leur clé d'origine est indiquée.
- **≈** : quasi-doublon d'une fiche du cahier, gardé en attendant de décider de la fusion en variante.
- **Trail ⟲** : famille route uniquement, candidate à une réouverture au trail (terrain plat/roulant).
- Non repris (doublons exacts) : `VMA_SHORT_01` = A05-01, `AS_LONG_02` = A03-02, `AS_LONG_04` = A08-04, `SL_EASY_01/02/04` = A01-03 / A01-04 / A10-02. Abandonné : Tabata 20″/10″ (travail anaérobie, hors des 9 allures).

**148 modèles** (120 du cahier + 28 repris de l'existant).

## 01 — EF & récupération (10)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A01-01 | EF continue 30 | `30m EF` | 30 min | Route + Trail | cahier |
| A01-02 | EF continue 40 | `40m EF` | 40 min | Route + Trail | cahier |
| A01-03 | EF continue 50 | `50m EF` | 50 min | Route + Trail | cahier |
| A01-04 | EF continue 60 | `60m EF` | 1h00 | Route + Trail | cahier |
| A01-05 | EF progressive douce | `20m EFL + 20m EFH + 10m EFL` | 50 min | Route + Trail | cahier |
| A01-06 | EF alternée | `4x(8m EFL + 2m EFH)` | 40 min | Route + Trail | cahier |
| A01-07 | EF en terrain souple | `45m EF` | 45 min | Route + Trail | cahier |
| A01-08 | EF récupération courte | `25m EFL` | 25 min | Route + Trail | cahier |
| A01-09 | EF marche-course | `6x(4m EF + 1m WALK)` | 30 min | Route + Trail | cahier |
| A01-10 | EF avec relances légères | `35m EF + 4x(15s STRIDE + 45s EF)` | 39 min | Route + Trail | cahier |

## 02 — Tempo & endurance active (10)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A02-01 | Tempo fractionné 3×6 | `15m EF + 3x(6m TEMPO) r2m EF + 10m EF` | 47 min | Route + Trail | cahier |
| A02-02 | Tempo progressif | `15m EF + 10m EFH + 12m TEMPO + 10m EF` | 47 min | Route + Trail | cahier |
| A02-03 | Tempo alterné 4×4 | `15m EF + 4x(4m TEMPO + 2m EF) + 10m EF` | 49 min | Route + Trail | cahier |
| A02-04 | Tempo pyramide 4/6/8 | `15m EF + 4m/6m/8m TEMPO r2m EF + 10m EF` | 47 min | Route + Trail | cahier |
| A02-05 | Tempo 2×12 | `15m EF + 2x(12m TEMPO) r3m EF + 10m EF` | 52 min | Route + Trail | cahier |
| A02-06 | Tempo dégressif | `15m EF + 8m/6m/4m TEMPO r2m EF + 10m EF` | 47 min | Route + Trail | cahier |
| A02-07 | EF / Tempo escalier | `15m EF + 3x(5m EFH + 4m TEMPO) + 10m EF` | 52 min | Route + Trail | cahier |
| A02-08 | Tempo en blocs 3×8 | `15m EF + 3x(8m TEMPO) r2m EF + 10m EF` | 53 min | Route + Trail | cahier |
| A02-09 | Tempo finish doux | `25m EF + 15m TEMPO + 10m EF` | 50 min | Route + Trail | cahier |
| A02-10 | Tempo ludique | `15m EF + 2x(3m TEMPO + 3m EF + 5m TEMPO) R3m EF + 10m EF` | 50 min | Route + Trail | cahier |

## 03 — Sweet Spot & S60 (13)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A03-01 | S60 3×6 | `15m EF + 3x(6m S60) r2m EF + 10m EF` | 47 min | Route ⟲ | cahier |
| A03-02 | S60 3×8 | `15m EF + 3x(8m S60) r2m EF + 10m EF` | 53 min | Route ⟲ | cahier |
| A03-03 | S60 2×10 | `15m EF + 2x(10m S60) r3m EF + 10m EF` | 48 min | Route ⟲ | cahier |
| A03-04 | S60 pyramide | `15m EF + 6m/8m/10m S60 r3m EF + 10m EF` | 55 min | Route ⟲ | cahier |
| A03-05 | S60 2×12 | `15m EF + 2x(12m S60) r3m EF + 10m EF` | 52 min | Route ⟲ | cahier |
| A03-06 | Sweet Spot continu | `15m EF + 18m SS + 10m EF` | 43 min | Route ⟲ | cahier |
| A03-07 | Sweet Spot 3×8 | `15m EF + 3x(8m SS) r2m EF + 10m EF` | 53 min | Route ⟲ | cahier |
| A03-08 | S60 escalier 5/7/9 | `15m EF + 5m/7m/9m S60 r3m EF + 10m EF` | 52 min | Route ⟲ | cahier |
| A03-09 | S60 dégressif 10/8/6 | `15m EF + 10m/8m/6m S60 r3m EF + 10m EF` | 55 min | Route ⟲ | cahier |
| A03-10 | Sweet Spot puis S60 | `15m EF + 10m SS + 3m EF + 8m S60 + 10m EF` | 46 min | Route ⟲ | cahier |
| L03-01 | Seuil court 4×5 | `15m EF + 4x(5m S60) r1m30 EF + 10m EF` | 49.5 min | Route ⟲ | existant (AS_LONG_01) |
| L03-02 | Pyramide S60 2/4/6/4/2 | `15m EF + 2m/4m/6m/4m/2m S60 r1m30 EF + 10m EF` | 49 min | Route ⟲ | existant (PYR_02) |
| L03-03 | Pyramide aérobie SS / S60 / AS10 | `15m EF + 5m SS + 2m EF + 10m S60 + 2m EF + 5m AS10 + 10m EF` | 49 min | Route ⟲ | existant (PYR_03) |

## 04 — S30 & seuil soutenu (10)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A04-01 | S30 5×3 | `15m EF + 5x(3m S30) r2m EF + 10m EF` | 48 min | Route ⟲ | cahier |
| A04-02 | S30 4×4 | `15m EF + 4x(4m S30) r2m EF + 10m EF` | 47 min | Route ⟲ | cahier |
| A04-03 | S30 5×4 | `15m EF + 5x(4m S30) r2m EF + 10m EF` | 53 min | Route ⟲ | cahier |
| A04-04 | S30 3×5 | `15m EF + 3x(5m S30) r3m EF + 10m EF` | 46 min | Route ⟲ | cahier |
| A04-05 | S30 6×2 | `15m EF + 6x(2m S30) r1m30 EF + 10m EF` | 44.5 min | Route ⟲ | cahier |
| A04-06 | S30 pyramide 2/3/4/3/2 | `15m EF + 2m/3m/4m/3m/2m S30 r2m EF + 10m EF` | 47 min | Route ⟲ | cahier |
| A04-07 | S30 dégressif 5/4/3 | `15m EF + 5m/4m/3m S30 r3m EF + 10m EF` | 43 min | Route ⟲ | cahier |
| A04-08 | S30 en deux séries | `15m EF + 2x(3x(2m S30) r1m EF) R4m EF + 10m EF` | 45 min | Route ⟲ | cahier |
| A04-09 | S60 + S30 | `15m EF + 8m S60 + 3m EF + 3x(3m S30) r2m EF + 10m EF` | 49 min | Route ⟲ | cahier |
| A04-10 | S30 en 4×3 / 2 séries | `15m EF + 2x(2x(3m S30) r2m EF) R4m EF + 10m EF` | 45 min | Route ⟲ | cahier |

## 05 — VMA & puissance aérobie (21)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A05-01 | VMA 10×30/30 | `15m EF + 10x(30s VMA + 30s EF) + 10m EF` | 35 min | Route ⟲ | cahier |
| A05-02 | VMA 12×30/30 | `15m EF + 12x(30s VMA + 30s EF) + 10m EF` | 37 min | Route ⟲ | cahier |
| A05-03 | VMA 8×45/45 | `15m EF + 8x(45s VMA + 45s EF) + 10m EF` | 37 min | Route ⟲ | cahier |
| A05-04 | VMA 8×1/1 | `15m EF + 8x(1m VMA + 1m EF) + 10m EF` | 41 min | Route ⟲ | cahier |
| A05-05 | VMA 6×90/90 | `15m EF + 6x(90s VMA + 90s EF) + 10m EF` | 43 min | Route ⟲ | cahier |
| A05-06 | VMA 5×2 | `15m EF + 5x(2m VMA) r2m EF + 10m EF` | 43 min | Route ⟲ | cahier |
| A05-07 | VMA 4×3 | `15m EF + 4x(3m VMA) r3m EF + 10m EF` | 46 min | Route ⟲ | cahier |
| A05-08 | VMA double 6×30/30 | `15m EF + 2x(6x(30s VMA + 30s EF)) R4m EF + 10m EF` | 41 min | Route ⟲ | cahier |
| A05-09 | VMA pyramide courte | `15m EF + 30s/1m/90s/1m/30s VMA r90s EF + 10m EF` | 35.5 min | Route ⟲ | cahier |
| A05-10 | VMA 2 séries 4×1 | `15m EF + 2x(4x(1m VMA) r1m EF) R4m EF + 10m EF` | 43 min | Route ⟲ | cahier |
| L05-01 | VMA 10×45/30 | `15m EF + 10x(45s VMA) r30s EF + 10m EF` | 37 min | Route ⟲ | existant (VMA_SHORT_03) |
| L05-02 | VMA dégressif court 40/30/20 | `15m EF + 3x(40s VMA + 40s EF + 30s VMA + 30s EF + 20s VMA) R3m EF + 10m EF` | 39 min | Route ⟲ | existant (VMA_SHORT_06) |
| L05-03 | VMA 5×3 | `15m EF + 5x(3m VMA) r1m30 EF + 10m EF` | 46 min | Route ⟲ | existant (VMA_MID_02) |
| L05-04 | VMA 4×4 | `15m EF + 4x(4m VMA) r2m EF + 10m EF` | 47 min | Route ⟲ | existant (VMA_MID_03) |
| L05-05 | S30 3×5 (soutien VMA) | `15m EF + 3x(5m S30) r2m EF + 10m EF` | 44 min | Route ⟲ | existant (VMA_MID_04) |
| L05-06 | Séries 3-2-1 (S30 / VMA) | `15m EF + 3x(3m S30 + 1m30 EF + 2m VMA + 1m EF + 1m VMA) R3m EF + 10m EF` | 56.5 min | Route ⟲ | existant (VMA_MID_05) |
| L05-07 | Accélérations 8×45 | `15m EF + 8x(45s VMA) r1m15 EF + 10m EF` | 39.8 min | Route ⟲ | existant (FART_04) |
| L05-08 | VMA double bloc 2×8×30/30 | `15m EF + 2x(8x(30s VMA + 30s EF)) R3m EF + 10m EF` | 44 min | Route ⟲ | existant (VMA_SHORT_02) ≈ A05-08 |
| L05-09 | VMA double bloc 2×6×1/1 | `15m EF + 2x(6x(1m VMA + 1m EF)) R3m EF + 10m EF` | 52 min | Route ⟲ | existant (VMA_SHORT_04) ≈ A05-04 |
| L05-10 | VMA 6×2/1 | `15m EF + 6x(2m VMA) r1m EF + 10m EF` | 42 min | Route ⟲ | existant (VMA_MID_01) ≈ A05-06 |
| L05-11 | Pyramide VMA 1/2/3/2/1 | `15m EF + 1m VMA + 30s EF + 2m VMA + 1m EF + 3m VMA + 1m30 EF + 2m VMA + 1m EF + 1m VMA + 10m EF` | 38 min | Route ⟲ | existant (PYR_01) ≈ A05-09 |

## 06 — Fartlek & allures changeantes (10)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A06-01 | Fartlek 1/2/3/2/1 | `15m EF + 1m/2m/3m/2m/1m TEMPO r2m EF + 10m EF` | 42 min | Route + Trail | cahier |
| A06-02 | Fartlek 2×pyramide | `15m EF + 2x(1m/2m/3m TEMPO r1m EF) R3m EF + 10m EF` | 44 min | Route + Trail | cahier |
| A06-03 | Fartlek 6×2/2 | `15m EF + 6x(2m TEMPO + 2m EF) + 10m EF` | 49 min | Route + Trail | cahier |
| A06-04 | Fartlek 3 intensités | `15m EF + 3x(3m TEMPO + 2m EF + 2m SS + 2m EF) + 10m EF` | 52 min | Route + Trail | cahier |
| A06-05 | Fartlek escalier | `15m EF + 3m TEMPO + 2m EF + 4m TEMPO + 2m EF + 5m TEMPO + 10m EF` | 41 min | Route + Trail | cahier |
| A06-06 | Fartlek inversé | `15m EF + 5m TEMPO + 2m EF + 4m TEMPO + 2m EF + 3m TEMPO + 10m EF` | 41 min | Route + Trail | cahier |
| A06-07 | Fartlek 10×1/1 | `15m EF + 10x(1m TEMPO + 1m EF) + 10m EF` | 45 min | Route + Trail | cahier |
| A06-08 | Fartlek 4×(3/2) | `15m EF + 4x(3m SS + 2m EF) + 10m EF` | 45 min | Route + Trail | cahier |
| A06-09 | Fartlek mix doux | `15m EF + 3x(4m EFH + 3m TEMPO + 2m EF) + 10m EF` | 52 min | Route + Trail | cahier |
| A06-10 | Fartlek libre guidé | `15m EF + 25m RPE4:variations_terrain + 10m EF` | 50 min | Route + Trail | cahier |

## 07 — AS42 & course longue (10)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A07-01 | AS42 2×12 | `15m EF + 2x(12m AS42) r3m EF + 10m EF` | 52 min | Route ⟲ | cahier |
| A07-02 | AS42 3×10 | `15m EF + 3x(10m AS42) r3m EF + 10m EF` | 1h01 | Route ⟲ | cahier |
| A07-03 | AS42 20 continu | `20m EF + 20m AS42 + 10m EF` | 50 min | Route ⟲ | cahier |
| A07-04 | AS42 2×15 | `20m EF + 2x(15m AS42) r4m EF + 10m EF` | 1h04 | Route ⟲ | cahier |
| A07-05 | AS42 3×8 | `15m EF + 3x(8m AS42) r2m EF + 10m EF` | 53 min | Route ⟲ | cahier |
| A07-06 | AS42 pyramidale | `15m EF + 8m/12m/8m AS42 r3m EF + 10m EF` | 59 min | Route ⟲ | cahier |
| A07-07 | AS42 active finish | `30m EF + 15m AS42 + 10m EF` | 55 min | Route ⟲ | cahier |
| A07-08 | AS42 densité douce | `20m EF + 4x(8m AS42) r2m EF + 10m EF` | 1h08 | Route ⟲ | cahier |
| A07-09 | AS42 / Tempo | `15m EF + 10m TEMPO + 3m EF + 15m AS42 + 10m EF` | 53 min | Route ⟲ | cahier |
| A07-10 | AS42 relance contrôlée | `20m EF + 2x(10m AS42 + 5m EF) + 10m EF` | 1h00 | Route ⟲ | cahier |

## 08 — AS21 & spécifique semi (11)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A08-01 | AS21 3×6 | `15m EF + 3x(6m AS21) r2m EF + 10m EF` | 47 min | Route ⟲ | cahier |
| A08-02 | AS21 3×8 | `15m EF + 3x(8m AS21) r2m EF + 10m EF` | 53 min | Route ⟲ | cahier |
| A08-03 | AS21 2×12 | `15m EF + 2x(12m AS21) r3m EF + 10m EF` | 52 min | Route ⟲ | cahier |
| A08-04 | AS21 2×15 | `15m EF + 2x(15m AS21) r3m EF + 10m EF` | 58 min | Route ⟲ | cahier |
| A08-05 | AS21 pyramide 6/8/10 | `15m EF + 6m/8m/10m AS21 r3m EF + 10m EF` | 55 min | Route ⟲ | cahier |
| A08-06 | AS21 / Tempo | `15m EF + 2x(6m TEMPO + 6m AS21) r3m EF + 10m EF` | 52 min | Route ⟲ | cahier |
| A08-07 | AS21 finish | `25m EF + 15m AS21 + 10m EF` | 50 min | Route ⟲ | cahier |
| A08-08 | AS21 double escalier | `15m EF + 2x(5m AS21 + 3m EF + 8m AS21) R4m EF + 10m EF` | 1h01 | Route ⟲ | cahier |
| A08-09 | AS21 / Sweet Spot | `15m EF + 10m AS21 + 3m EF + 8m SS + 10m EF` | 46 min | Route ⟲ | cahier |
| A08-10 | AS21 continu 20 | `15m EF + 20m AS21 + 10m EF` | 45 min | Route ⟲ | cahier |
| L08-01 | Allure modérée 3×10 | `15m EF + 3x(10m AS21) r2m30 EF + 10m EF` | 1h00 | Route ⟲ | existant (AS_LONG_03) |

## 09 — AS10 & spécifique 10 km (14)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A09-01 | AS10 5×3 | `15m EF + 5x(3m AS10) r2m EF + 10m EF` | 48 min | Route ⟲ | cahier |
| A09-02 | AS10 4×4 | `15m EF + 4x(4m AS10) r2m EF + 10m EF` | 47 min | Route ⟲ | cahier |
| A09-03 | AS10 3×5 | `15m EF + 3x(5m AS10) r3m EF + 10m EF` | 46 min | Route ⟲ | cahier |
| A09-04 | AS10 5×4 | `15m EF + 5x(4m AS10) r2m EF + 10m EF` | 53 min | Route ⟲ | cahier |
| A09-05 | AS10 2×8 | `15m EF + 2x(8m AS10) r4m EF + 10m EF` | 45 min | Route ⟲ | cahier |
| A09-06 | AS10 pyramide | `15m EF + 3m/4m/5m/4m/3m AS10 r2m EF + 10m EF` | 52 min | Route ⟲ | cahier |
| A09-07 | AS10 dégressif | `15m EF + 6m/5m/4m AS10 r3m EF + 10m EF` | 46 min | Route ⟲ | cahier |
| A09-08 | AS10 / AS21 alterné | `15m EF + 3x(3m AS10 + 3m AS21 + 2m EF) + 10m EF` | 49 min | Route ⟲ | cahier |
| A09-09 | AS10 deux séries | `15m EF + 2x(3x(2m AS10) r1m EF) R4m EF + 10m EF` | 45 min | Route ⟲ | cahier |
| A09-10 | AS10 / S60 progressif | `15m EF + 8m S60 + 3m EF + 2x(4m AS10) r2m EF + 10m EF` | 46 min | Route ⟲ | cahier |
| L09-01 | Mixte seuil / allure vive | `15m EF + 10m S60 + 3m EF + 2x(6m AS10) r2m EF + 10m EF` | 52 min | Route ⟲ | existant (AS_LONG_05) |
| L09-02 | Pyramide nature 1/2/3/4/3/2/1 | `15m EF + 1m AS10 + 1m EF + 2m AS10 + 2m EF + 3m AS10 + 3m EF + 4m AS10 + 4m EF + 3m AS10 + 3m EF + 2m AS10 + 2m EF + 1m AS10 + 10m EF` | 56 min | Route ⟲ | existant (FART_03) |
| L09-03 | Over-under seuil / AS42 | `15m EF + 10x(2m S60 + 1m AS42) + 10m EF` | 55 min | Route ⟲ | existant (FART_01) |
| L09-04 | Australienne 15×30/30 | `15m EF + 15x(30s VMA + 30s TEMPO) + 10m EF` | 40 min | Route ⟲ | existant (FART_02) |

## 10 — Sorties longues actives (19)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A10-01 | SL EF 70 | `70m EF` | 1h10 | Route ⟲ | cahier |
| A10-02 | SL EF 90 | `90m EF` | 1h30 | Route ⟲ | cahier |
| A10-03 | SL Tempo 2×10 | `45m EF + 2x(10m TEMPO) r3m EF + 17m EF` | 1h25 | Route ⟲ | cahier |
| A10-04 | SL Tempo 2×12 | `45m EF + 2x(12m TEMPO) r3m EF + 18m EF` | 1h30 | Route ⟲ | cahier |
| A10-05 | SL AS42 2×15 | `45m EF + 2x(15m AS42) r3m EF + 12m EF` | 1h30 | Route ⟲ | cahier |
| A10-06 | SL AS21 2×12 | `40m EF + 2x(12m AS21) r3m EF + 23m EF` | 1h30 | Route ⟲ | cahier |
| A10-07 | SL AS10 2×5 | `45m EF + 2x(5m AS10) r3m EF + 32m EF` | 1h30 | Route ⟲ | cahier |
| A10-08 | SL finish Tempo | `55m EF + 15m TEMPO + 10m EF` | 1h20 | Route ⟲ | cahier |
| A10-09 | SL mix EA / AS21 | `40m EF + 10m TEMPO + 3m EF + 10m AS21 + 17m EF` | 1h20 | Route ⟲ | cahier |
| A10-10 | SL EF soutenue par paliers | `35m EF + 15m EFH + 5m EF + 15m EFH + 10m EF` | 1h20 | Route ⟲ | cahier |
| L10-01 | SL EF 75 | `75m EF` | 1h15 | Route ⟲ | existant (SL_EASY_03) |
| L10-02 | SL progressive 40 EF + 20 AS42 | `40m EF + 20m AS42 + 10m EF` | 1h10 | Route ⟲ | existant (SL_EASY_05) |
| L10-03 | SL active AS21 3×8 | `30m EF + 3x(8m AS21) r2m EF + 12m EF` | 1h10 | Route ⟲ | existant (SL_ACT_01) |
| L10-04 | SL active S60 3×6 | `35m EF + 3x(6m S60) r2m EF + 16m EF` | 1h13 | Route ⟲ | existant (SL_ACT_02) |
| L10-05 | SL active AS42 30 continu | `25m EF + 30m AS42 + 20m EF` | 1h15 | Route ⟲ | existant (SL_ACT_03) |
| L10-06 | SL active AS21 2×15 | `30m EF + 2x(15m AS21) r3m EF + 27m EF` | 1h30 | Route ⟲ | existant (SL_ACT_04) |
| L10-07 | SL combo SS 15 / S60 10 | `30m EF + 15m SS + 3m EF + 10m S60 + 2m EF + 30m EF` | 1h30 | Route ⟲ | existant (SL_ACT_05) |
| L10-08 | SL active AS42 2×25 | `20m EF + 2x(25m AS42) r5m EF + 15m EF` | 1h30 | Route ⟲ | existant (SL_ACT_06) |
| L10-09 | SL pyramide AS42 / SS / S60 | `25m EF + 15m AS42 + 10m SS + 5m S60 + 29m EF` | 1h24 | Route ⟲ | existant (SL_ACT_07) |

## 11 — Côtes route & trail (10)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A11-01 | Côtes 8×30″ | `15m EF + 8x(30s RPE7:cote + 90s EF) + 10m EF` | 41 min | Route + Trail | cahier |
| A11-02 | Côtes 10×45″ | `15m EF + 10x(45s RPE7:cote + 75s EF) + 10m EF` | 45 min | Route + Trail | cahier |
| A11-03 | Côtes 6×1′ | `15m EF + 6x(1m RPE7:cote + 2m EF) + 10m EF` | 43 min | Route + Trail | cahier |
| A11-04 | Côtes 5×2′ | `15m EF + 5x(2m RPE6:cote + 3m EF) + 10m EF` | 50 min | Route + Trail | cahier |
| A11-05 | Côtes 4×3′ | `15m EF + 4x(3m RPE6:cote + 3m EF) + 10m EF` | 49 min | Route + Trail | cahier |
| A11-06 | Côtes marche active | `15m EF + 5x(4m RPE5:marche_montante + 3m EF) + 10m EF` | 1h00 | Route + Trail | cahier |
| A11-07 | Côtes progressives | `15m EF + 4x(2m RPE5:cote + 1m RPE6:cote + 3m EF) + 10m EF` | 49 min | Route + Trail | cahier |
| A11-08 | Côtes en escalier | `15m EF + 1m/2m/3m/2m/1m RPE6:cote r3m EF + 10m EF` | 46 min | Route + Trail | cahier |
| A11-09 | Côtes double série | `15m EF + 2x(3x(1m RPE7:cote + 2m EF)) R4m EF + 10m EF` | 47 min | Route + Trail | cahier |
| A11-10 | Côtes technicité | `15m EF + 30m RPE4:sentier_technique + 10m EF` | 55 min | Route + Trail | cahier |

## 12 — Trail / SL terrain et blocs mixtes (10)

| ID | Séance | Structure | Durée | Terrain | Source |
|---|---|---|---|---|---|
| A12-01 | Trail facile 75 | `75m EF` | 1h15 | Trail | cahier |
| A12-02 | Trail facile 90 | `90m EF` | 1h30 | Trail | cahier |
| A12-03 | Trail montées marche | `20m EF + 4x(5m RPE5:montee_marche + 4m EF) + 14m EF` | 1h10 | Trail | cahier |
| A12-04 | Trail montées course | `20m EF + 4x(4m RPE6:cote + 5m EF) + 14m EF` | 1h10 | Trail | cahier |
| A12-05 | Trail alternance terrain | `20m EF + 3x(8m RPE4:vallonne + 5m EF) + 11m EF` | 1h10 | Trail | cahier |
| A12-06 | Trail 2 longs blocs | `20m EF + 2x(15m RPE5:montee_reguliere) R8m EF + 12m EF` | 1h10 | Trail | cahier |
| A12-07 | Trail technique facile | `25m EF + 25m RPE3:technique_descente + 20m EF` | 1h10 | Trail | cahier |
| A12-08 | Trail progression D+ | `80m EF` | 1h20 | Trail | cahier |
| A12-09 | Trail SL active | `35m EF + 2x(10m RPE5:montee + 6m EF) + 13m EF` | 1h20 | Trail | cahier |
| A12-10 | Trail simulation mixte | `20m EF + 3x(6m RPE5:marche_montee + 6m RPE4:roulant + 4m EF) + 12m EF` | 1h20 | Trail | cahier |

