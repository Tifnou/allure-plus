// xlsx_export.js
// Genere un classeur Excel (.xlsx) presentant le plan d'entrainement actif
// dans le meme esprit que l'ancien Google Sheet partage a la main avant
// Allure+ : un tableau d'allures personnalisees en haut (chacun tape son
// prenom, sa VO2max et son sexe, les allures se calculent via de vraies
// formules de tableur - une ligne Route et une ligne Trail par personne),
// puis le plan semaine par semaine juste en dessous, sur le meme onglet
// (Seance 1, Seance 2... au lieu de jours calendaires, puisque chaque ami
// suit le plan a son rythme).
//
// Reutilise zones.js (source de verite des zones Allure+) pour que les
// zones et allures exportees soient exactement celles de l'application.

const ExcelJS = require('exceljs');
const { ALLURE_PLUS_ZONES, annotatePaceZones } = require('./zones');

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

// Séance "en côte" : categorie explicite Campus, ou mention côte/montée dans
// le nom/la description - a signaler dans le plan (ex: "Seuil 60 (côte)").
function isHillSession(session) {
  const cat = (session.trainingCategory || '').toLowerCase();
  if (cat.includes('uphill') || cat.includes('hill_repeats')) return true;
  const text = ((session.displayName || session.name || '') + ' ' + (session.description || '')).toLowerCase();
  return /c[oô]te|mont[ée]e|uphill/.test(text);
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
 *  les motifs repetes (travail/recuperation alternes N fois).
 *  Le tout premier segment, s'il resout en RECOVER, est etiquete
 *  "Échauffement" plutot que "Récup" - un long segment confort en debut de
 *  seance (ex: sortie longue) n'est pas une "recuperation" mais bien la
 *  mise en route, meme si sa zone/allure cible est identique. */
function formatSessionShorthand(session, goalType) {
  const list = annotatePaceZones(session, goalType)
    .map(z => ({ zone: z.resolvedZone || 'EF', duration: Math.round(z.duration || 0) }))
    .filter(z => z.duration > 0);
  if (list.length === 0) return '';

  const parts = [];
  let i = 0;
  while (i < list.length) {
    const work = list[i];
    const isFirst = i === 0;
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
      parts.push(isFirst ? 'Échauffement' : 'Récup');
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
 *  a teinter legerement la ligne de la seance dans le plan. */
function dominantZone(session, goalType) {
  const zones = annotatePaceZones(session, goalType).map(z => z.resolvedZone).filter(Boolean);
  return zones.find(z => z !== 'EF' && z !== 'RECOVER') || zones[0] || 'EF';
}

// Nombre total de colonnes utilisees par le tableau d'allures (partage avec
// le plan, sur le meme onglet) : Prénom, VO2max, Sexe, VMA + 2 col/zone
const PACE_TOTAL_COLS = 4 + PACE_TABLE_ZONES.length * 2;
const PLAN_COLS = 5; // Séance, Type, Détail, Durée, D+
const SHEET_COLS = Math.max(PACE_TOTAL_COLS, PLAN_COLS);

/** Bloc "Allures" en haut de l'onglet : chaque coureur occupe 2 lignes
 *  (Route puis Trail), la ligne Trail applique la correction terrain et
 *  reference la VMA de la ligne Route juste au-dessus (VO2max/Sexe saisis
 *  une seule fois). Retourne la ligne suivante libre. */
function buildPacesBlock(sheet, goal, startRow) {
  let r = startRow;
  sheet.mergeCells(r, 1, r, SHEET_COLS);
  const titleCell = sheet.getCell(r, 1);
  titleCell.value = `Zones d'allure personnalisées — ${goal?.name || goal?.goalTitle || 'Plan Allure+'}`;
  titleCell.font = { bold: true, size: 14 };
  r += 1;

  sheet.mergeCells(r, 1, r, SHEET_COLS);
  const instrCell = sheet.getCell(r, 1);
  instrCell.value = "Entrez votre prénom, votre VO2max et votre sexe (M/F) sur la ligne \"Route\" — vos allures Route ET Trail (avec correction terrain) se calculent automatiquement.";
  instrCell.font = { italic: true, color: { argb: argb('666666') } };
  r += 1;

  const headerRow1 = r, headerRow2 = r + 1;
  sheet.mergeCells(headerRow1, 1, headerRow2, 1); sheet.getCell(headerRow1, 1).value = 'Prénom';
  sheet.mergeCells(headerRow1, 2, headerRow2, 2); sheet.getCell(headerRow1, 2).value = 'VO2max';
  sheet.mergeCells(headerRow1, 3, headerRow2, 3); sheet.getCell(headerRow1, 3).value = 'Sexe (M/F)';
  sheet.mergeCells(headerRow1, 4, headerRow2, 4); sheet.getCell(headerRow1, 4).value = 'VMA (km/h)';
  [1, 2, 3, 4].forEach(c => {
    const cell = sheet.getCell(headerRow1, c);
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('E5E7EB') } };
  });

  let col = 5;
  const zoneColStart = {};
  PACE_TABLE_ZONES.forEach(zoneKey => {
    zoneColStart[zoneKey] = col;
    const def = ALLURE_PLUS_ZONES[zoneKey];
    sheet.mergeCells(headerRow1, col, headerRow1, col + 1);
    const head = sheet.getCell(headerRow1, col);
    head.value = ZONE_SHORT[zoneKey] || zoneKey;
    head.font = { bold: true, color: { argb: argb('1f2937') } };
    head.alignment = { horizontal: 'center' };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(ZONE_COLORS[zoneKey]) } };
    sheet.getCell(headerRow1, col + 1).fill = head.fill;

    const lowCell = sheet.getCell(headerRow2, col);
    lowCell.value = `${Math.round(def.pctLow * 100)}%`;
    const highCell = sheet.getCell(headerRow2, col + 1);
    highCell.value = `${Math.round(def.pctHigh * 100)}%`;
    [lowCell, highCell].forEach(c => {
      c.font = { size: 9, italic: true };
      c.alignment = { horizontal: 'center' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(lightenHex(ZONE_COLORS[zoneKey], 0.6)) } };
    });
    col += 2;
  });
  r = headerRow2 + 1;

  const NB_ATHLETES = 7;
  for (let a = 0; a < NB_ATHLETES; a++) {
    const routeRow = r, trailRow = r + 1;
    const B = `B${routeRow}`, C = `C${routeRow}`, D = `D${routeRow}`, DT = `D${trailRow}`;

    sheet.getCell(routeRow, 1).value = '';
    sheet.getCell(trailRow, 1).value = { formula: `IF(A${routeRow}="","",A${routeRow}&" (Trail)")` };
    sheet.getCell(routeRow, 1).font = { bold: true };
    sheet.getCell(trailRow, 1).font = { italic: true, color: { argb: argb('555555') } };

    sheet.getCell(D).value = { formula: `IF(${B}="","",(${B}-3.5)*IF(UPPER(${C})="F",0.315,0.313))` };
    sheet.getCell(D).numFmt = '0.0';
    sheet.getCell(DT).value = { formula: `${D}` };
    sheet.getCell(DT).numFmt = '0.0';

    PACE_TABLE_ZONES.forEach(zoneKey => {
      const def = ALLURE_PLUS_ZONES[zoneKey];
      const trailCorr = TRAIL_CORR[zoneKey] ? (1 + TRAIL_CORR[zoneKey]) : 1;
      const startCol = zoneColStart[zoneKey];
      [def.pctLow, def.pctHigh].forEach((pct, idx) => {
        const routeCell = sheet.getCell(routeRow, startCol + idx);
        const routeFormula = `(3600/(${D}*${pct}))`;
        routeCell.value = { formula: `IF(${D}="","",TEXT(INT((${routeFormula})/60),"0")&":"&TEXT(MOD(ROUND(${routeFormula},0),60),"00"))` };
        routeCell.alignment = { horizontal: 'center' };

        const trailCell = sheet.getCell(trailRow, startCol + idx);
        const trailFormula = `(3600/(${DT}*${pct}))*${trailCorr}`;
        trailCell.value = { formula: `IF(${DT}="","",TEXT(INT((${trailFormula})/60),"0")&":"&TEXT(MOD(ROUND(${trailFormula},0),60),"00"))` };
        trailCell.alignment = { horizontal: 'center' };
        trailCell.font = { italic: true, color: { argb: argb('555555') } };
      });
    });
    r = trailRow + 1;
  }

  sheet.views = (sheet.views || []).concat([]);
  return r + 1; // ligne vide de separation avant le plan
}

/** Bloc "Plan" (semaine par semaine) juste en dessous du bloc Allures, sur
 *  le meme onglet. Le theme du cycle n'est repete que lors d'un changement
 *  de cycle (pas a chaque semaine), et une ligne "Description" est ajoutee
 *  sous chaque seance quand le coach a redige un texte. */
function buildPlanBlock(sheet, goal, weeks, startRow) {
  const goalType = goal?.goalType || '';
  const HEADERS = ['Séance', 'Type', 'Détail', 'Durée', 'D+'];
  let r = startRow;

  sheet.mergeCells(r, 1, r, SHEET_COLS);
  const title = sheet.getCell(r, 1);
  title.value = `Plan d'entraînement — ${goal?.name || goal?.goalTitle || ''}`;
  title.font = { bold: true, size: 14 };
  r += 1;
  sheet.mergeCells(r, 1, r, SHEET_COLS);
  const noteCell = sheet.getCell(r, 1);
  noteCell.value = "Chaque \"Séance N\" est à faire dans l'ordre, au rythme de chacun (pas de dates fixes).";
  noteCell.font = { italic: true, color: { argb: argb('666666') } };
  r += 2;

  let lastTheme = null;
  (weeks || []).forEach((week, wIdx) => {
    // Seules les séances course/trail sont exportées - le renforcement (gpp)
    // n'a pas sa place ici (pas de zone d'allure Allure+ pertinente pour lui).
    const sessions = (week.sessions || []).filter(s => !isStrengthSession(s));
    const totalSec = sessions.reduce((s, sess) => s + (sess.stats?.expectedDuration || 0), 0);
    const theme = week?.context?.cycleDescription || week?.context?.cycleTheme || '';
    // Le thème n'est affiché que lors d'un changement de cycle, pas à chaque semaine
    const showTheme = theme && theme !== lastTheme;
    if (theme) lastTheme = theme;

    sheet.mergeCells(r, 1, r, SHEET_COLS);
    const bannerCell = sheet.getCell(r, 1);
    bannerCell.value = `Semaine ${wIdx + 1}${showTheme ? ' — ' + theme : ''}${totalSec ? '  (durée totale : ' + fmtHM(totalSec) + ')' : ''}`;
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
      const hill = isHillSession(session);
      const typeName = (session.displayName || session.name || '') + (hill ? ' (côte)' : '');

      const rowVals = [
        `Séance ${seanceNum}`,
        typeName,
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
      r += 1;

      if (session.description) {
        sheet.mergeCells(r, 1, r, SHEET_COLS);
        const descCell = sheet.getCell(r, 1);
        descCell.value = session.description;
        descCell.font = { italic: true, size: 10, color: { argb: argb('555555') } };
        descCell.alignment = { wrapText: true, vertical: 'top' };
        descCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(tint) } };
        r += 1;
      }

      seanceNum++;
    });
    r += 1; // ligne vide entre semaines
  });
}

/** Construit le classeur complet : un seul onglet avec le tableau d'allures
 *  en haut et le plan semaine par semaine juste en dessous. */
async function buildPlanWorkbook(goal, weeks) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Allure+';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Plan Allure+');
  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 55;
  sheet.getColumn(4).width = 10;
  for (let c = 5; c <= SHEET_COLS; c++) sheet.getColumn(c).width = 9;

  const planStartRow = buildPacesBlock(sheet, goal, 1);
  buildPlanBlock(sheet, goal, weeks, planStartRow);

  return wb;
}

module.exports = { buildPlanWorkbook, formatSessionShorthand };
