// xlsx_export.js
// Genere un classeur Excel (.xlsx) presentant le plan d'entrainement actif
// dans le meme esprit que l'ancien Google Sheet partage a la main avant
// Allure+ : un tableau d'allures personnalisees en haut (chacun tape son
// prenom, sa VO2max et son sexe, les allures se calculent via de vraies
// formules de tableur - une ligne Route et une ligne Trail par personne),
// puis le plan semaine par semaine juste en dessous, sur le meme onglet,
// avec jour/date reels calcules depuis une case "date de la course"
// modifiable (une seule formule a la racine, tout le reste en decoule).
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
// RECOVER s'affiche "EF" dans le detail compact du plan (convention du
// coach : echauffement/recup entre repetitions/retour au calme sont tous
// notes "EF", jamais un mot a part - confirme sur l'ancien tableau modele).
const ZONE_SHORT = { RECOVER: 'EF', EF: 'EF', TEMPO: 'TEMPO', AS42: 'AS42', SWEET_SPOT: 'SWEET SPOT', AS21: 'AS21', S60: 'S60', AS10: 'AS10', S30: 'S30', VMA: 'VMA' };
// Zones utilisees dans le tableau d'allures personnalisees (RECOVER exclue : "allure libre", pas de cible)
const PACE_TABLE_ZONES = Object.keys(ALLURE_PLUS_ZONES).filter(z => z !== 'RECOVER');
// Jours assignes selon le nombre de sorties course/trail de la semaine -
// seuls 4 et 5 sorties/semaine ont un jour fixe ; les autres cas (ex.
// semaines post-competition a 3 sorties) restent libres, sans date.
const DAY_PATTERNS = {
  4: [['Mardi', 1], ['Jeudi', 3], ['Samedi', 5], ['Dimanche', 6]],
  5: [['Mardi', 1], ['Mercredi', 2], ['Jeudi', 3], ['Samedi', 5], ['Dimanche', 6]],
};

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

/** Reconstruit un texte compact ("15' EF + 6x3' S60 r=1'30 EF + 5' EF") depuis
 *  les zones d'allure reelles de la seance (annotatePaceZones), en detectant
 *  les motifs repetes (travail/recuperation alternes N fois). RECOVER
 *  s'affiche toujours "EF" (echauffement, recup entre repetitions, retour
 *  au calme sont tous notes EF dans cette notation compacte). */
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
        parts.push(`${reps}x${fmtDurCompact(work.duration)} ${ZONE_SHORT[work.zone] || work.zone} r=${fmtDurCompact(rec.duration)} ${ZONE_SHORT.RECOVER}`);
        i = j;
        continue;
      }
    }
    // Sinon, simple repetition de segments identiques consecutifs
    let reps = 1, j = i + 1;
    while (j < list.length && list[j].zone === work.zone && list[j].duration === work.duration) { reps++; j++; }
    const label = ZONE_SHORT[work.zone] || work.zone;
    parts.push(reps >= 2 ? `${reps}x${fmtDurCompact(work.duration)} ${label}` : `${fmtDurCompact(work.duration)} ${label}`);
    i = j;
  }
  return parts.join(' + ');
}

// Nombre total de colonnes utilisees par le tableau d'allures (partage avec
// le plan, sur le meme onglet) : Prénom, VO2max, Sexe, VMA + 2 col/zone
const PACE_TOTAL_COLS = 4 + PACE_TABLE_ZONES.length * 2;
const SHEET_COLS = PACE_TOTAL_COLS;
const NB_ATHLETES = 3;

/** Bloc "Allures" en haut de l'onglet : chaque coureur occupe 2 lignes
 *  (Route puis Trail), la ligne Trail applique la correction terrain et
 *  reference la VMA de la ligne Route juste au-dessus (VO2max/Sexe saisis
 *  une seule fois). Un cadre entoure tout le bloc et une bordure sépare
 *  chaque coureur du suivant. Retourne la ligne suivante libre. */
function buildPacesBlock(sheet, goal, startRow) {
  let r = startRow;
  sheet.mergeCells(r, 1, r, SHEET_COLS);
  const titleCell = sheet.getCell(r, 1);
  titleCell.value = `Zones d'allure personnalisées — ${goal?.name || goal?.goalTitle || 'Plan Allure+'}`;
  titleCell.font = { bold: true, size: 14 };
  const blockFirstRow = r;
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

    // Séparation visuelle nette entre chaque coureur
    const sepStyle = { style: 'medium', color: { argb: argb('9CA3AF') } };
    for (let c = 1; c <= SHEET_COLS; c++) {
      sheet.getCell(trailRow, c).border = Object.assign({}, sheet.getCell(trailRow, c).border, { bottom: sepStyle });
    }
    r = trailRow + 1;
  }
  const blockLastRow = r - 1;

  // Cadre autour de tout le bloc Allures
  const thin = { style: 'thin', color: { argb: argb('9CA3AF') } };
  for (let c = 1; c <= SHEET_COLS; c++) {
    const top = sheet.getCell(blockFirstRow, c);
    top.border = Object.assign({}, top.border, { top: thin });
    const bottom = sheet.getCell(blockLastRow, c);
    bottom.border = Object.assign({}, bottom.border, { bottom: thin });
  }
  for (let rr = blockFirstRow; rr <= blockLastRow; rr++) {
    const left = sheet.getCell(rr, 1);
    left.border = Object.assign({}, left.border, { left: thin });
    const right = sheet.getCell(rr, SHEET_COLS);
    right.border = Object.assign({}, right.border, { right: thin });
  }

  return r + 1; // ligne vide de separation avant le plan
}

const RACE_DAY_FILL = 'FEF3C7'; // meme jaune que la case "Date de la course"
const FRAME = { style: 'thin', color: { argb: argb('9CA3AF') } };

/** Bloc "Plan" (semaine par semaine) juste en dessous du bloc Allures, sur
 *  le meme onglet. Le theme du cycle n'est repete que lors d'un changement
 *  de cycle. Chaque seance affiche un jour + une date reels.
 *
 *  Les dates se calent sur le LUNDI de la semaine de course (calcule depuis
 *  la case "date de la course", modifiable) : changer la date de course de
 *  quelques jours seulement (ex: 17 -> 18, meme semaine) ne decale donc PAS
 *  les semaines precedentes - seul un changement de semaine entiere les
 *  decale, comme dans la vraie vie. La semaine de course elle-meme n'a pas
 *  de jour fixe (taper, pas un rythme hebdo normal) SAUF la seance de
 *  competition, qui affiche la vraie date de course saisie et son vrai jour
 *  (calcule, pas suppose "dimanche").
 *
 *  Chaque semaine est encadree, les lignes restent en fond blanc sauf le
 *  jour de course (legerement mis en valeur). */
function buildPlanBlock(sheet, goal, weeks, startRow, options) {
  const goalType = goal?.goalType || '';
  const raceDayDurationSec = options?.raceDayDurationSec;
  const HEADERS = ['Jour', 'Date', 'Type', 'Détail', 'Durée', 'D+', 'Commentaire'];
  let r = startRow;

  sheet.mergeCells(r, 1, r, SHEET_COLS);
  const title = sheet.getCell(r, 1);
  title.value = `Plan d'entraînement — ${goal?.name || goal?.goalTitle || ''}`;
  title.font = { bold: true, size: 14 };
  r += 1;

  // Case "date de la course" - toutes les dates du plan en decoulent par formule
  sheet.getCell(r, 1).value = 'Date de la course :';
  sheet.getCell(r, 1).font = { bold: true };
  const raceDateCell = sheet.getCell(r, 2);
  const originalCompDate = goal?.competitionDate ? new Date(goal.competitionDate) : null;
  raceDateCell.value = originalCompDate || '';
  raceDateCell.numFmt = 'dd/mm/yyyy';
  raceDateCell.font = { bold: true, color: { argb: argb('b91c1c') } };
  raceDateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(RACE_DAY_FILL) } };
  const raceDateRef = `$B$${r}`;
  r += 1;

  // Lundi de la semaine de course (calcule une seule fois, tout le reste
  // des dates en decoule) - WEEKDAY(d,2) renvoie 1=lundi...7=dimanche.
  sheet.getCell(r, 1).value = 'Lundi de cette semaine-là (calculé) :';
  sheet.getCell(r, 1).font = { italic: true, size: 9, color: { argb: argb('888888') } };
  const mondayCell = sheet.getCell(r, 2);
  mondayCell.value = { formula: `${raceDateRef}-WEEKDAY(${raceDateRef},2)+1` };
  mondayCell.numFmt = 'dd/mm/yyyy';
  mondayCell.font = { italic: true, size: 9, color: { argb: argb('888888') } };
  const mondayRef = `$B$${r}`;
  r += 1;

  sheet.mergeCells(r, 1, r, SHEET_COLS);
  const noteCell = sheet.getCell(r, 1);
  noteCell.value = "Modifiez la date de la course ci-dessus : les semaines s'ajustent automatiquement (un changement de quelques jours dans la même semaine ne décale rien).";
  noteCell.font = { italic: true, color: { argb: argb('666666') } };
  r += 2;

  const originalCompTs = originalCompDate ? originalCompDate.getTime() : null;
  // Lundi de la semaine de course dans les donnees d'origine (pour calculer
  // le decalage en semaines entieres de chaque semaine par rapport a elle)
  let originalRaceWeekMondayTs = null;
  if (originalCompTs != null) {
    const raceWeek = (weeks || []).find(w => originalCompTs >= w.weekDate && originalCompTs < w.weekDate + 7 * 86400000);
    originalRaceWeekMondayTs = raceWeek ? raceWeek.weekDate : null;
  }
  let lastTheme = null;

  (weeks || []).forEach((week) => {
    // Seules les séances course/trail sont exportées - le renforcement (gpp)
    // n'a pas sa place ici (pas de zone d'allure Allure+ pertinente pour lui).
    const sessions = (week.sessions || []).filter(s => !isStrengthSession(s) && !((s.trainingCategory || '').includes('rest') || s.sport === 'rest'));
    const totalSec = sessions.reduce((s, sess) => s + (sess.stats?.expectedDuration || 0), 0);
    const theme = week?.context?.cycleDescription || week?.context?.cycleTheme || '';
    const showTheme = theme && theme !== lastTheme;
    if (theme) lastTheme = theme;

    const weeksBeforeRace = (originalRaceWeekMondayTs != null)
      ? Math.round((originalRaceWeekMondayTs - week.weekDate) / (7 * 86400000))
      : null;
    const isRaceWeek = weeksBeforeRace === 0;
    const dayPattern = (!isRaceWeek && weeksBeforeRace != null) ? (DAY_PATTERNS[sessions.length] || null) : null;

    const weekFirstRow = r;
    sheet.mergeCells(r, 1, r, SHEET_COLS);
    const bannerCell = sheet.getCell(r, 1);
    bannerCell.value = `${showTheme ? theme + '  ' : ''}${totalSec ? '(durée totale : ' + fmtHM(totalSec) + ')' : ''}`.trim() || ' ';
    bannerCell.font = { bold: true, color: { argb: argb('1f2937') } };
    bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('D4E8D4') } };
    bannerCell.alignment = { wrapText: true };
    r += 1;

    HEADERS.forEach((h, i) => {
      const col = i + 1;
      if (h === 'Commentaire') sheet.mergeCells(r, col, r, SHEET_COLS);
      const cell = sheet.getCell(r, col);
      cell.value = h;
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('F3F4F6') } };
    });
    r += 1;

    sessions.forEach((session, i) => {
      const elev = session.stats?.expectedElevationGain || session.stats?.maxExpectedElevationGain || 0;
      const hill = isHillSession(session);
      const isRaceSession = (session.trainingCategory || '').includes('competition');
      const typeName = (session.displayName || session.name || '') + (hill ? ' (côte)' : '');
      const rowFill = isRaceSession ? RACE_DAY_FILL : null;

      const hasDay = dayPattern && dayPattern[i];
      // La durée brute Campus (session.stats.expectedDuration) du jour de
      // course n'est pas calibrée à l'utilisateur (distance/D+/VMA validés) -
      // on utilise l'estimation "Fin de plan" transmise par le frontend, qui
      // reprend exactement le même calcul que le bloc Estimations.
      const durationSec = (isRaceSession && raceDayDurationSec != null) ? raceDayDurationSec : (session.stats?.expectedDuration || 0);

      const rowVals = [null, null, typeName, formatSessionShorthand(session, goalType), fmtHM(durationSec), elev > 0 ? `+${Math.round(elev)}m` : '', session.description || ''];
      rowVals.forEach((v, ci) => {
        const col = ci + 1;
        if (col === 7) { // Commentaire : cellule fusionnée sur le reste de la largeur
          sheet.mergeCells(r, col, r, SHEET_COLS);
        }
        const cell = sheet.getCell(r, col);
        if (col === 1) {
          // Jour : seance de competition = jour reel (formule, pas suppose),
          // sinon jour fixe du motif hebdo, sinon vide (semaine de course/atypique)
          if (isRaceSession) {
            cell.value = { formula: `CHOOSE(WEEKDAY(${raceDateRef},2),"Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche")` };
          } else {
            cell.value = hasDay ? dayPattern[i][0] : '';
          }
        } else if (col === 2) {
          if (isRaceSession) {
            cell.value = { formula: raceDateRef };
            cell.numFmt = 'dd/mm/yyyy';
          } else if (hasDay) {
            const dayOffset = dayPattern[i][1];
            cell.value = { formula: `${mondayRef}-${weeksBeforeRace}*7+${dayOffset}` };
            cell.numFmt = 'dd/mm/yyyy';
          } else {
            cell.value = '';
          }
        } else {
          cell.value = v;
        }
        if (rowFill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(rowFill) } };
        cell.alignment = { wrapText: col === 4 || col === 7, vertical: 'middle' };
      });
      r += 1;
    });

    // Cadre autour de cette semaine (bandeau + en-tetes + seances)
    const weekLastRow = r - 1;
    for (let c = 1; c <= SHEET_COLS; c++) {
      const top = sheet.getCell(weekFirstRow, c);
      top.border = Object.assign({}, top.border, { top: FRAME });
      const bottom = sheet.getCell(weekLastRow, c);
      bottom.border = Object.assign({}, bottom.border, { bottom: FRAME });
    }
    for (let rr = weekFirstRow; rr <= weekLastRow; rr++) {
      const left = sheet.getCell(rr, 1);
      left.border = Object.assign({}, left.border, { left: FRAME });
      const right = sheet.getCell(rr, SHEET_COLS);
      right.border = Object.assign({}, right.border, { right: FRAME });
    }

    r += 1; // ligne vide entre semaines
  });
}

/** Construit le classeur complet : un seul onglet avec le tableau d'allures
 *  en haut et le plan semaine par semaine juste en dessous. */
async function buildPlanWorkbook(goal, weeks, options) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Allure+';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Plan Allure+');
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 13;
  sheet.getColumn(3).width = 28;
  sheet.getColumn(4).width = 55;
  sheet.getColumn(5).width = 10;
  sheet.getColumn(6).width = 10;
  for (let c = 7; c <= SHEET_COLS; c++) sheet.getColumn(c).width = 9;

  const planStartRow = buildPacesBlock(sheet, goal, 1);
  buildPlanBlock(sheet, goal, weeks, planStartRow, options);

  return wb;
}

module.exports = { buildPlanWorkbook, formatSessionShorthand };
