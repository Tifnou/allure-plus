// zones.js
// Source de vérité UNIQUE pour les zones d'allure Allure+ (% de la VMA).
// Doit rester cohérent avec ALLURE_PLUS_ZONES dans frontend/js/campus.js.
// Utilisé par toutes les routes serveur qui calculent des allures cibles,
// pour éviter que deux endroits du code aient des valeurs différentes.

const ALLURE_PLUS_ZONES = {
  RECOVER:    { pctLow: 0.55, pctHigh: 0.62 },
  EF:         { pctLow: 0.62, pctHigh: 0.67 },
  TEMPO:      { pctLow: 0.71, pctHigh: 0.75 },
  AS42:       { pctLow: 0.75, pctHigh: 0.78 },
  SWEET_SPOT: { pctLow: 0.79, pctHigh: 0.82, isSweetSpot: true },
  AS30:       { pctLow: 0.80, pctHigh: 0.83 },
  AS21:       { pctLow: 0.82, pctHigh: 0.85 },
  S60:        { pctLow: 0.84, pctHigh: 0.87 },
  AS10:       { pctLow: 0.88, pctHigh: 0.91 },
  S30:        { pctLow: 0.89, pctHigh: 0.92 },
  VMA:        { pctLow: 0.95, pctHigh: 1.05 },
};

// Sweet Spot = 95% de la vitesse S60 (règle métier Allure+)
function getZoneRange(zoneKey) {
  const ref = ALLURE_PLUS_ZONES[zoneKey];
  if (!ref) return null;
  if (ref.isSweetSpot) {
    return { pctLow: ALLURE_PLUS_ZONES.S60.pctLow * 0.95, pctHigh: ALLURE_PLUS_ZONES.S60.pctHigh * 0.95 };
  }
  return { pctLow: ref.pctLow, pctHigh: ref.pctHigh };
}

module.exports = { ALLURE_PLUS_ZONES, getZoneRange };
