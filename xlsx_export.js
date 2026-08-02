// xlsx_export.js
// Genere un classeur Excel (.xlsx) presentant le plan d'entrainement actif
// dans le meme esprit que l'ancien Google Sheet partage a la main avant
// Allure+ : un tableau d'allures personnalisees (chacun tape son prenom,
// sa VO2max et son sexe, les allures se calculent via de vraies formules
// de tableur) puis le plan semaine par semaine (Seance 1, Seance 2... au
// lieu de jours calendaires, puisque chaque ami suit le plan a son rythme).
//
// Reutilise zones.js (source de verite des zones Allure+) pour que les
// zones et allures exportees soient exactement celles de l'application.

const ExcelJS = require('exceljs');
const { ALLURE_PLUS_ZONES, resolveZoneFromExercise, annotatePaceZones } = require('./zones');

// Couleurs par zone (memes valeurs hex que ALLURE_PLUS_ZONES dans
// frontend/js/campus.js) - dupliquees ici car le frontend et le serveur
// ne partagent pas de module JS commun.
const ZONE_COLORS = {
  RECOVER: '94a3b8', EF: '4ade80', TEMPO: 'a3e635', AS42: '818cf8', SWEET_SPOT: 'facc15',
  AS21: 'fb923c', S60: 'f97316', AS10: 'c084fc', S30: 'f87171', VMA: 'e879f9',
};
// Correction trail par zone (memes valeurs que calcAllureRefTrail, campus.js)
const TRAIL_CORR = { EF: 0.07, TEMPO: 0.07, AS42: 0.07, SWEET_SPOT: 0.07, AS21: 0.07, S60: 0.07, S30: 0.07, AS10: 0.08, VMA: 0.10 };
const ZONE_SHORT = { RECOVER: 'Récup', EF: 'EF', TEMPO: 'TEMPO', AS42: 'AS42', SWEET_SPOT: 'SWEET SPOT', AS21: 'AS21', S60: 'S60', AS10: 'AS10', S30: 'S30', VMA: 'VMA' };
// Zones utilisees dans le tableau d'allures personnalisees (RECOVER exclue : "allure libre", pas de cible)
const PACE_TABLE_ZONES = Object.keys(ALLURE_PLUS_ZONES).filter(z => z !== 'RECOVER');

function argb(hex) { return 'FF' + hex.toUpperCase(); }

// Même critère que campus.js isStrengthSession() : le renforcement n'a pas
// de zone d'allure Allure+ pertinente, on ne l'exporte pas dans le plan.
function isStrengthSession(session) {
  return session.sport === 'ppg' || session.trainingCategory === 'gpp';
}

function lightenHex(hex, factor) {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const mix = (c) => Math.round(c + (255 - c) * factor);
  return [mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

function fmtDurCompact(seconds) {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}"`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  if (s === 0) return `${m}'`;
  return `${m}'${String(s).padStart(2, '0')}`;
}

function fmtHM(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Reconstruit un texte compact ("15' EF + 4x8' S60 r=3'30 + Récup") depuis
 *  les zones d'allure reelles de la seance (annotatePaceZones), en detectant
 *  les motifs repetes (travail/recuperation alternes N fois). */
function formatSessionShorthand(session, goalType) {
  const list = annotatePaceZones(session, goalType)
    .map(z => ({ zone: z.resolvedZone || 'EF', duration: Math.round(z.duration || 0) }))
    .filter(z => z.duration > 0);
  if (list.length === 0) return '';

  const parts = [];
  let i = 0;
  while (i < list.length) {
    const work = list[i];
    // Motif alterne travail/recup repete N fois
    if (work.zone !== 'RECOVER' && i + 1 < list.length && list[i + 1].zone === 'RECOVER') {
      const rec = list[i + 1];
      let reps = 1, j = i + 2;
      while (
        j + 1 < list.length &&
        list[j].zone === work.zone && list[j].duration === work.duration &&
        list[j + 1].zone === 'RECOVER' && list[j + 1].duration === rec.duration
      ) { reps++; j += 2; }
      if (j < list.length && list[j].zone === work.zone && list[j].duration === work.duration) { reps++; j++; }
      if (reps >= 2) {
        parts.push(`${reps}x${fmtDurCompact(work.duration)} ${ZONE_SHORT[work.zone] || work.zone} r=${fmtDurCompact(rec.duration)}`);
        i = j;
        continue;
      }
    }
    // Sinon, simple repetition de segments identiques consecutifs
    let reps = 1, j = i + 1;
    while (j < list.length && list[j].zone === work.zone && list[j].duration === work.duration) { reps++; j++; }
    if (work.zone === 'RECOVER') {
      parts.push('Récup');
    } else if (reps >= 2) {
      parts.push(`${reps}x${fmtDurCompact(work.duration)} ${ZONE_SHORT[work.zone] || work.zone}`);
    } else {
      parts.push(`${fmtDurCompact(work.duration)} ${ZONE_SHORT[work.zone] || work.zone}`);
    }
    i = j;
  }
  return parts.join(' + ');
}

/** Zone "dominante" d'une seance (premiere zone hors EF/RECOVER, sinon EF) - sert
 *  a teinter legerement la ligne de la seance dans la feuille Plan. */
function dominantZone(session, goalType) {
  const zones = annotatePaceZones(session, goalType).map(z => z.resolvedZone).filter(Boolean);
  return zones.find(z => z !== 'EF' && z !== 'RECOVER') || zones[0] || 'EF';
}

function buildPacesSheet(wb, goal, isTrail) {
  const sheet = wb.addWorksheet('Allures');
  const totalCols = 4 + PACE_TABLE_ZONES.length * 2; // Prénom, VO2max, Sexe, VMA + 2 col/zone

  sheet.mergeCells(1, 1, 1, totalCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `Zones d'allure personnalisées — ${goal?.name || goal?.goalTitle || 'Plan Allure+'}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'left' };

  sheet.mergeCells(2, 1, 2, totalCols);
  const instrCell = sheet.getCell(2, 1);
  instrCell.value = "Entrez votre prénom, votre VO2max et votre sexe (M/F) — vos allures se calculent automatiquement.";
  instrCell.font = { italic: true, color: { argb: argb('666666') } };

  // En-têtes fixes
  sheet.mergeCells(3, 1, 4, 1); sheet.getCell(3, 1).value = 'Prénom';
  sheet.mergeCells(3, 2, 4, 2); sheet.getCell(3, 2).value = 'VO2max';
  sheet.mergeCells(3, 3, 4, 3); sheet.getCell(3, 3).value = 'Sexe (M/F)';
  sheet.mergeCells(3, 4, 4, 4); sheet.getCell(3, 4).value = 'VMA (km/h)';
  [1, 2, 3, 4].forEach(c => {
    const cell = sheet.getCell(3, c);
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('E5E7EB') } };
  });

  // En-têtes par zone (2 colonnes chacune : borne basse % puis borne haute %)
  let col = 5;
  const zoneColStart = {};
  PACE_TABLE_ZONES.forEach(zoneKey => {
    zoneColStart[zoneKey] = col;
    const def = ALLURE_PLUS_ZONES[zoneKey];
    sheet.mergeCells(3, col, 3, col + 1);
    const head = sheet.getCell(3, col);
    head.value = ZONE_SHORT[zoneKey] || zoneKey;
    head.font = { bold: true, color: { argb: argb('1f2937') } };
    head.alignment = { horizontal: 'center' };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(ZONE_COLORS[zoneKey]) } };
    sheet.getCell(3, col + 1).fill = head.fill;

    const lowCell = sheet.getCell(4, col);
    lowCell.value = `${Math.round(def.pctLow * 100)}%`;
    const highCell = sheet.getCell(4, col + 1);
    highCell.value = `${Math.round(def.pctHigh * 100)}%`;
    [lowCell, highCell].forEach(c => {
      c.font = { size: 9, italic: true };
      c.alignment = { horizontal: 'center' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(lightenHex(ZONE_COLORS[zoneKey], 0.6)) } };
    });
    col += 2;
  });

  // Lignes vierges avec formules (VMA + allure par zone), prêtes à remplir
  const NB_ROWS = 14;
  for (let r = 0; r < NB_ROWS; r++) {
    const row = 5 + r;
    const B = `B${row}`, C = `C${row}`, D = `D${row}`;
    sheet.getCell(D).value = { formula: `IF(${B}="","",(${B}-3.5)*IF(UPPER(${C})="F",0.315,0.313))` };
    sheet.getCell(D).numFmt = '0.0';
    PACE_TABLE_ZONES.forEach(zoneKey => {
      const def = ALLURE_PLUS_ZONES[zoneKey];
      const corr = isTrail && TRAIL_CORR[zoneKey] ? (1 + TRAIL_CORR[zoneKey]) : 1;
      const startCol = zoneColStart[zoneKey];
      [def.pctLow, def.pctHigh].forEach((pct, idx) => {
        const cell = sheet.getCell(row, startCol + idx);
        const paceSecFormula = `(3600/(${D}*${pct}))*${corr}`;
        cell.value = {
          formula: `IF(${D}="","",TEXT(INT((${paceSecFormula})/60),"0")&":"&TEXT(MOD(ROUND(${paceSecFormula},0),60),"00"))`,
        };
        cell.alignment = { horizontal: 'center' };
      });
    });
    sheet.getCell(`A${row}`).alignment = { horizontal: 'left' };
  }

  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 10;
  sheet.getColumn(3).width = 10;
  sheet.getColumn(4).width = 10;
  for (let c = 5; c <= totalCols; c++) sheet.getColumn(c).width = 8;
  sheet.views = [{ state: 'frozen', xSplit: 4, ySplit: 4 }];

  if (isTrail) {
    sheet.mergeCells(5 + NB_ROWS + 1, 1, 5 + NB_ROWS + 1, totalCols);
    const note = sheet.getCell(5 + NB_ROWS + 1, 1);
    note.value = "Plan trail : allures ajustées avec la correction terrain (+7 à +10% selon la zone).";
    note.font = { italic: true, size: 9, color: { argb: argb('888888') } };
  }
}

function buildPlanSheet(wb, goal, weeks) {
  const sheet = wb.addWorksheet('Plan');
  const goalType = goal?.goalType || '';
  const HEADERS = ['Séance', 'Type', 'Détail', 'Durée', 'D+'];
  const COL_WIDTHS = [12, 22, 55, 10, 10];
  COL_WIDTHS.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  let r = 1;
  sheet.mergeCells(r, 1, r, HEADERS.length);
  const title = sheet.getCell(r, 1);
  title.value = `Plan d'entraînement — ${goal?.name || goal?.goalTitle || ''}`;
  title.font = { bold: true, size: 14 };
  r += 1;
  sheet.mergeCells(r, 1, r, HEADERS.length);
  const noteCell = sheet.getCell(r, 1);
  noteCell.value = "Chaque \"Séance N\" est à faire dans l'ordre, au rythme de chacun (pas de dates fixes).";
  noteCell.font = { italic: true, color: { argb: argb('666666') } };
  r += 2;

  (weeks || []).forEach((week, wIdx) => {
    // Seules les séances course/trail sont exportées - le renforcement (gpp)
    // n'a pas sa place ici (pas de zone d'allure Allure+ pertinente pour lui).
    const sessions = (week.sessions || []).filter(s => !isStrengthSession(s));
    const totalSec = sessions.reduce((s, sess) => s + (sess.stats?.expectedDuration || 0), 0);
    const theme = week?.context?.cycleDescription || week?.context?.cycleTheme || '';

    sheet.mergeCells(r, 1, r, HEADERS.length);
    const bannerCell = sheet.getCell(r, 1);
    bannerCell.value = `Semaine ${wIdx + 1}${theme ? ' — ' + theme : ''}${totalSec ? '  (durée totale : ' + fmtHM(totalSec) + ')' : ''}`;
    bannerCell.font = { bold: true, color: { argb: argb('1f2937') } };
    bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('D4E8D4') } };
    bannerCell.alignment = { wrapText: true };
    r += 1;

    HEADERS.forEach((h, i) => {
      const cell = sheet.getCell(r, i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('F3F4F6') } };
    });
    r += 1;

    let seanceNum = 1;
    sessions.forEach(session => {
      const isRest = (session.trainingCategory || '').includes('rest') || (session.sport === 'rest');
      if (isRest) return;
      const zone = dominantZone(session, goalType);
      const tint = lightenHex(ZONE_COLORS[zone] || ZONE_COLORS.EF, 0.82);
      const elev = session.stats?.expectedElevationGain || session.stats?.maxExpectedElevationGain || 0;

      const rowVals = [
        `Séance ${seanceNum}`,
        session.displayName || session.name || '',
        formatSessionShorthand(session, goalType),
        fmtHM(session.stats?.expectedDuration || 0),
        elev > 0 ? `+${Math.round(elev)}m` : '',
      ];
      rowVals.forEach((v, i) => {
        const cell = sheet.getCell(r, i + 1);
        cell.value = v;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(tint) } };
        cell.alignment = { wrapText: i === 2, vertical: 'middle' };
      });
      seanceNum++;
      r += 1;
    });
    r += 1; // ligne vide entre semaines
  });

  sheet.views = [{ state: 'frozen', ySplit: 4 }];
}

/** Construit le classeur complet (feuille Allures + feuille Plan). */
async function buildPlanWorkbook(goal, weeks) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Allure+';
  wb.created = new Date();
  const isTrail = (goal?.goalType || '').toLowerCase().includes('trail');
  buildPacesSheet(wb, goal, isTrail);
  buildPlanSheet(wb, goal, weeks);
  return wb;
}

module.exports = { buildPlanWorkbook, formatSessionShorthand };
