// ============================================================================
// race_predictor.js — moteur de prédiction de chrono ROUTE (modèle "road-1")
// ----------------------------------------------------------------------------
// Fonctions PURES (aucun DOM, aucun appel réseau) : utilisables dans l'app et dans
// les tests / le backtest Node (tools/backtest_predictions.js). Cahier des charges
// « Allure+ Prédictions Route & Trail » (16/11/2026), lot P1 « Moteur Route ».
//
// Trois voies INDEPENDANTES, puis fusion :
//   A  physiologique : VO2max -> VMA -> % de VMA CONTINU en fonction de la distance
//      (plus de rupture à 5/10/21 km). Les coefficients sont calibrés sur des courses
//      réelles (cf tools/backtest_predictions.js), pas sur la formule d'origine.
//   B  performances : extrapolation (Riegel) des courses récentes, pondérées par la
//      proximité de distance et la fraîcheur.
//   C  activités : meilleurs efforts soutenus des dernières semaines (sorties de 5 km+
//      menées à une intensité cardiaque élevée) — ils donnent une BORNE : si un effort
//      récent démontre une capacité, on ne prédit pas plus lent.
//
// Le résultat porte toujours : une valeur centrale, un intervalle, une confiance et
// les facteurs qui l'expliquent — jamais un chiffre sans contexte.
// Les coefficients vivent dans PARAMS (versionnés) : à recalibrer, jamais dispersés.
// ============================================================================
(function (root) {
  'use strict';

  const DAY = 86400000;

  const PARAMS = {
    version: 'road-1',
    // Voie A : pct_VMA(d) = p10 - slope * ln(d / 10), borné
    // Calibrés le 16/11/2026 (backtest de 25 courses plates, validation croisée ; contrôle sur 17
    // courses d'une autre coureuse : biais -7,6 % -> +1,3 %). Anciens paliers : 97/90/83/76 %.
    pctAtTen: 0.87,
    pctSlope: 0.11,
    pctMin: 0.60, pctMax: 1.0,
    // Dénivelé sur route : km équivalents ajoutés par 100 m de D+ (valeur ajustée par backtest ;
    // le trail a son propre moteur par segments, ce n'est PAS son modèle)
    elevKmPer100: 0.5,
    // Facteur VO2max -> VMA (identique à calcVMA, app.js)
    vmaFactor: { M: 0.313, F: 0.315 },
    // Voie B
    riegel: 1.06,
    refWindowDays: 365,
    refMaxElevPerKm: 40,
    refMinKm: 5,
    refDistScale: 0.6,     // décroissance du poids avec |ln(d/dref)|
    refAgeScaleDays: 150,  // décroissance du poids avec l'ancienneté
    // Voie C
    effortWindowDays: 84,
    effortMinKm: 5,
    effortMaxElevPerKm: 40,
    effortMinHrFrac: 0.90, // FC moyenne / FC max connue
    // Fusion
    maxWeightB: 0.75,
    // Incertitude (demi-largeur relative) selon la confiance — à recalibrer par backtest
    // Relevées après backtest : à 4,5 % seuls 72 % des chronos réels tombaient dans la fourchette.
    halfWidth: { high: 0.045, medium: 0.06, low: 0.10 },
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // --- Projection de FIN DE PLAN (cahier des charges §5) -------------------------------------
  // Gain de capacité attendu sur les semaines RESTANTES du plan, en % de VO2max puis de VMA.
  // Mesuré sur 30 fenêtres de 12 semaines précédant des courses (16/11/2026) : le gain réel est
  // en moyenne de +1 % (médiane +0,6 %), très loin des +3..+9 % forfaitaires de l'ancien modèle ;
  // il dépend surtout de la MARGE de progression (écart au sommet personnel des 12 derniers mois :
  // mesure LOO 2,46 % d'erreur contre 3,45 % pour l'ancien +3 % fixe). Tout est ajustable ici.
  const PLAN_PARAMS = {
    version: 'plan-1',
    // gain de base sur 12 semaines (en % de VO2max) selon la maturité d'entraînement, avant marge
    baseByMaturity: { novice: 3.0, intermediate: 1.0, experienced: -2.0 },
    gapSlope: 0.70,          // + % de gain par % d'écart entre la VO2max actuelle et le sommet de 12 mois
    potMin: -2.0, potMax: 6.0,
    fullWeeks: 16,           // au-delà de 16 semaines restantes, rendement divisé par deux
    obsDamping: 0.5,         // une tendance observée n'est extrapolée qu'à moitié
    obsWeightWeeks: 8,       // poids de la tendance observée = e / (e + 8)
    noEvidenceMult: 0.8,     // aucune semaine écoulée : projection prudente
    adherenceFloor: 0.4,     // en dessous : plus de gain, voire perte (désentraînement)
    overloadMult: 0.5,       // charge excessive : le gain est plafonné
    intervalVo2Pct: 3.2,     // écart-type résiduel du backtest (% de VO2max par 12 semaines)
    intervalMinPct: 1.5,
    // Maturité = ANCIENNETÉ de pratique (jours depuis la 1re sortie de course connue), jamais le volume récent :
    // un coureur confirmé en période creuse n'est pas un débutant (il regagne un niveau déjà atteint).
    maturityDays: { experienced: 730, intermediate: 365 },
  };

  function planMaturity(historyDays, P) {
    if (!(historyDays >= 0)) return 'intermediate';
    return historyDays >= P.maturityDays.experienced ? 'experienced' : historyDays >= P.maturityDays.intermediate ? 'intermediate' : 'novice';
  }

  /**
   * @param {object} i  weeksTotal, weeksElapsed, vo2Now, vo2Peak (sommet des 12 mois),
   *   vo2Start (VO2max au début du plan, facultatif), historyDays (ancienneté de pratique),
   *   adherence {score 0..1|null, overload bool}, params
   * @returns {{gainFrac, lowFrac, highFrac, vo2GainPct, maturity, mult, factors}} fractions de VMA (peuvent être négatives)
   */
  function projectPlanGain(i) {
    const P = Object.assign({}, PLAN_PARAMS, i.params || {});
    const rem = Math.max(0, (i.weeksTotal || 0) - (i.weeksElapsed || 0));
    const maturity = planMaturity(i.historyDays, P);
    const factors = [];
    if (!(rem > 0) || !(i.vo2Now > 3.5)) return { gainFrac: 0, lowFrac: 0, highFrac: 0, vo2GainPct: 0, maturity, mult: 1, factors: ['Plan terminé : plus de progression à projeter.'] };

    const peak = Math.max(i.vo2Peak || 0, i.vo2Now);
    const gapPct = (i.vo2Now / peak - 1) * 100; // <= 0
    const pot12 = clamp(P.baseByMaturity[maturity] + P.gapSlope * Math.abs(gapPct), P.potMin, P.potMax);
    const effW = Math.min(rem, P.fullWeeks) + 0.5 * Math.max(0, rem - P.fullWeeks);
    const prior = pot12 * effW / 12;
    if (Math.abs(gapPct) >= 2) factors.push(`VO2max ${Math.abs(Math.round(gapPct * 10) / 10)} % sous votre meilleur niveau des 12 derniers mois : marge de progression.`);
    else factors.push('VO2max proche de votre meilleur niveau récent : peu de marge de progression.');
    factors.push(`Profil d'entraînement : ${{ novice: 'débutant', intermediate: 'intermédiaire', experienced: 'confirmé' }[maturity]}.`);

    // Tendance réellement observée depuis le début du plan (jamais comptée deux fois :
    // la capacité actuelle contient déjà l'acquis, seule la suite est projetée)
    let blended = prior;
    const e = i.weeksElapsed || 0;
    if (e >= 3 && i.vo2Start > 3.5) {
      const rate = ((i.vo2Now / i.vo2Start - 1) * 100) / e;
      const obs = rate * rem * P.obsDamping;
      const wo = e / (e + P.obsWeightWeeks);
      blended = (1 - wo) * prior + wo * obs;
      factors.push(`Tendance observée depuis le début du plan : ${rate >= 0 ? '+' : ''}${(Math.round(rate * 100) / 100).toString().replace('.', ',')} % de VO2max/semaine.`);
    }

    // Assiduité qualifiée : au-dessus de 0,9 gain plein ; sous le plancher, désentraînement
    const s = i.adherence && i.adherence.score;
    let mult = s == null ? P.noEvidenceMult : clamp((s - P.adherenceFloor) / (0.9 - P.adherenceFloor), -0.5, 1);
    if (i.adherence && i.adherence.overload) { mult = Math.min(mult, P.overloadMult); factors.push('Charge supérieure au plan : le gain est plafonné (fatigue).'); }
    if (s == null) factors.push('Pas encore de semaine écoulée : projection provisoire, fourchette large.');
    else factors.push(`Assiduité qualifiée ${Math.round(s * 100)} % → ${mult >= 1 ? 'gain plein' : mult > 0 ? 'gain réduit' : 'aucun gain attendu'}.`);

    // Un gain positif dépend de l'assiduité ; une pente négative (régression vers la moyenne) est seulement atténuée
    const vo2Gain = blended >= 0 ? blended * mult : blended * (1 - 0.5 * clamp(mult, 0, 1));
    const hw = Math.max(P.intervalMinPct, P.intervalVo2Pct * Math.sqrt(rem / 12));
    const toVma = g => (g / 100) * (i.vo2Now / (i.vo2Now - 3.5)); // % de VO2max -> fraction de VMA
    return { gainFrac: toVma(vo2Gain), lowFrac: toVma(vo2Gain - hw), highFrac: toVma(vo2Gain + hw), vo2GainPct: vo2Gain, maturity, mult, factors };
  }

  function isRoadFlat(r, maxElev) {
    return r && r.durationSec > 0 && r.distanceKm > 0 && !r.dnf &&
      (r.type === undefined || r.type === 'route') &&
      (r.elevationGain || 0) / r.distanceKm < maxElev;
  }

  // --- Voie A ---------------------------------------------------------------
  // Distance équivalente à plat (le dénivelé allonge l'effort)
  function equivKm(distKm, dplusM, P) { return distKm + (Math.max(0, dplusM || 0) / 100) * P.elevKmPer100; }
  function pctVma(distKm, P) {
    return clamp(P.pctAtTen - P.pctSlope * Math.log(distKm / 10), P.pctMin, P.pctMax);
  }
  // Temps à plat-équivalent pour une VMA donnée (km/h) : UNE seule formule, utilisée par la voie A
  // ET par les projections de l'app (Objectifs, Synthèse) qui font varier la VMA.
  function timeFromVma(distKm, dplusM, vma, P) {
    P = Object.assign({}, PARAMS, P || {});
    if (!(vma > 0) || !(distKm > 0)) return null;
    const eq = equivKm(distKm, dplusM, P);
    return Math.round(eq / (vma * pctVma(eq, P)) * 3600);
  }
  function voieA(distKm, vo2max, sex, P, vmaRatio, dplusM) {
    if (!(vo2max > 3.5)) return null;
    const vma = (vo2max - 3.5) * (P.vmaFactor[sex === 'F' ? 'F' : 'M']) * (vmaRatio || 1);
    return { sec: timeFromVma(distKm, dplusM, vma, P), vma };
  }

  // --- Voie B ---------------------------------------------------------------
  function riegelProject(sec, fromKm, toKm, exp) { return sec * Math.pow(toKm / fromKm, exp); }
  function voieB(distKm, nowMs, races, P, dplusM) {
    const refs = [];
    (races || []).forEach(r => {
      if (!isRoadFlat(r, P.refMaxElevPerKm) || r.distanceKm < P.refMinKm) return;
      const age = (nowMs - r.dateMs) / DAY;
      if (age <= 0 || age > P.refWindowDays) return;
      const dl = Math.abs(Math.log(distKm / r.distanceKm));
      const w = Math.exp(-dl / P.refDistScale) * Math.exp(-age / P.refAgeScaleDays);
      refs.push({ w, ageDays: Math.round(age), distanceKm: r.distanceKm, durationSec: r.durationSec, sec: riegelProject(r.durationSec, equivKm(r.distanceKm, r.elevationGain, P), equivKm(distKm, dplusM, P), P.riegel), ratio: Math.max(distKm / r.distanceKm, r.distanceKm / distKm) });
    });
    if (!refs.length) return null;
    const wsum = refs.reduce((s, r) => s + r.w, 0);
    // moyenne pondérée en log (les erreurs sont multiplicatives)
    const sec = Math.exp(refs.reduce((s, r) => s + r.w * Math.log(r.sec), 0) / wsum);
    const best = refs.slice().sort((a, b) => b.w - a.w)[0];
    return { sec, weight: clamp(Math.max(...refs.map(r => r.w)), 0, 1), refs, best };
  }

  // --- Voie C ---------------------------------------------------------------
  // hrMax : FC max connue (percentile haut des FC max des sorties de course).
  function estimateHrMax(activities) {
    const v = (activities || []).filter(a => a.maxHR > 120 && a.distanceKm > 0).map(a => a.maxHR).sort((x, y) => x - y);
    if (v.length < 5) return null;
    return v[Math.floor(v.length * 0.97)];
  }
  function voieC(distKm, nowMs, activities, hrMax, P, dplusM) {
    if (!hrMax) return null;
    let best = null;
    (activities || []).forEach(a => {
      if (!a.distanceKm || !a.durationSec || a.distanceKm < P.effortMinKm) return;
      const age = (nowMs - a.dateMs) / DAY;
      if (age <= 0 || age > P.effortWindowDays) return;
      if ((a.elevationGain || 0) / a.distanceKm >= P.effortMaxElevPerKm) return;
      if (!(a.avgHR > 0) || a.avgHR / hrMax < P.effortMinHrFrac) return;
      const sec = riegelProject(a.durationSec, equivKm(a.distanceKm, a.elevationGain, P), equivKm(distKm, dplusM, P), P.riegel);
      if (!best || sec < best.sec) best = { sec, ageDays: Math.round(age), distanceKm: a.distanceKm, hrFrac: a.avgHR / hrMax };
    });
    return best;
  }

  // --- Fusion ---------------------------------------------------------------
  function fmtHm(sec) { const m = Math.round(sec / 60); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); }

  /**
   * @param {object} i
   *   distKm, dplusM (D+ de la course visée, facultatif), nowMs, vo2max, sex, vmaRatio (ajustement test VMA, facultatif),
   *   races      [{dateMs, distanceKm, durationSec, type, elevationGain, dnf}]
   *   activities [{dateMs, distanceKm, durationSec, avgHR, maxHR, elevationGain}]
   *   params     surcharge partielle de PARAMS (tests / calibration)
   */
  function predictRoad(i) {
    const P = Object.assign({}, PARAMS, i.params || {});
    const A = voieA(i.distKm, i.vo2max, i.sex, P, i.vmaRatio, i.dplusM);
    const B = voieB(i.distKm, i.nowMs, i.races, P, i.dplusM);
    const hrMax = i.hrMax || estimateHrMax(i.activities);
    const C = voieC(i.distKm, i.nowMs, i.activities, hrMax, P, i.dplusM);
    if (!A && !B && !C) return null;

    // Poids de B : fraîcheur/proximité de la meilleure référence, plafonné
    const wB = B ? clamp(B.weight, 0, 1) * P.maxWeightB : 0;
    let sec;
    if (A && B) sec = Math.exp((1 - wB) * Math.log(A.sec) + wB * Math.log(B.sec));
    else if (A) sec = A.sec;
    else if (B) sec = B.sec;
    else sec = C.sec;

    // C = borne : une capacité récemment démontrée ne se prédit pas plus lente
    let cappedByC = false;
    if (C && sec > C.sec) { sec = C.sec; cappedByC = true; }

    // Confiance : proximité/fraîcheur de la meilleure preuve de performance
    let confidence = 'low';
    if (B && B.best.ageDays <= 120 && B.best.ratio <= 2) confidence = 'high';
    else if ((B && B.best.ageDays <= P.refWindowDays) || (C && C.ageDays <= 56)) confidence = 'medium';
    // Désaccord fort entre voies : on élargit au lieu de masquer
    const disagreement = (A && B) ? Math.abs(Math.log(A.sec / B.sec)) : 0;
    if (disagreement > 0.08 && confidence === 'high') confidence = 'medium';

    let hw = P.halfWidth[confidence];
    if (disagreement > 0.08) hw += Math.min(0.05, disagreement / 2);

    const factors = [];
    if (B) factors.push(`Course récente prise en compte : ${B.best.distanceKm.toString().replace('.', ',')} km il y a ${B.best.ageDays} j.`);
    else factors.push('Aucune course récente exploitable : estimation fondée sur la VO2max.');
    if (A) factors.push(`VO2max ${Math.round(i.vo2max * 10) / 10} → VMA ${Math.round(A.vma * 10) / 10} km/h.`);
    if (cappedByC) factors.push(`Un effort récent (${C.distanceKm.toString().replace('.', ',')} km à ${Math.round(C.hrFrac * 100)} % de la FC max) démontre une capacité plus rapide.`);
    if (disagreement > 0.08) factors.push(`Les méthodes divergent de ${Math.round(disagreement * 100)} % : fourchette élargie.`);

    return {
      model: P.version,
      sec: Math.round(sec),
      lowSec: Math.round(sec * (1 - hw)),
      highSec: Math.round(sec * (1 + hw)),
      confidence,
      voies: { A: A && Math.round(A.sec), B: B && Math.round(B.sec), C: C && Math.round(C.sec) },
      factors,
    };
  }

  const api = { PARAMS, PLAN_PARAMS, projectPlanGain, planMaturity, equivKm, timeFromVma, pctVma, voieA, voieB, voieC, estimateHrMax, predictRoad, riegelProject, fmtHm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RacePredictor = api;
})(typeof window !== 'undefined' ? window : globalThis);
