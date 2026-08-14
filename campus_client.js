// ═══════════════════════════════════════════════════
// CAMPUS COACH — Client API
// Base URL : https://api.campus.coach
// Auth     : POST /account/login → { token, refreshToken }
// ═══════════════════════════════════════════════════

const https = require('https');
const zlib  = require('zlib');

const CAMPUS_API = 'https://api.campus.coach';

// ─── Requête HTTP générique (gzip handled) ──────────
function campusRequest(method, path, token, body = null) {
  return new Promise((resolve, reject) => {
    const url  = new URL(CAMPUS_API + path);
    const data = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.7',
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'Origin': 'https://app.campus.coach',
        'Referer': 'https://app.campus.coach/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(data  && { 'Content-Length': Buffer.byteLength(data) }),
      },
    };

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'] || '';

        const parse = raw => {
          const str = raw.toString('utf8');
          console.log(`[Campus] ${method} ${path} → ${res.statusCode} (${str.length} chars)`);
          if (res.statusCode >= 400) {
            return reject(new Error(`Campus API ${res.statusCode}: ${str.slice(0, 300)}`));
          }
          try { resolve(JSON.parse(str)); }
          catch { resolve(str); }
        };

        if (enc.includes('gzip')) {
          zlib.gunzip(buf, (e, r) => e ? parse(buf) : parse(r));
        } else if (enc.includes('br')) {
          zlib.brotliDecompress(buf, (e, r) => e ? parse(buf) : parse(r));
        } else if (enc.includes('deflate')) {
          zlib.inflate(buf, (e, r) => e ? parse(buf) : parse(r));
        } else {
          parse(buf);
        }
      });
    });
    // Timeout 15 secondes
    req.setTimeout(15000, () => {
      req.destroy(new Error('Campus API timeout (15s)'));
    });
    req.on('error', err => {
      console.error(`[Campus] ${method} ${path} → ERREUR:`, err.message);
      reject(err);
    });
    if (data) req.write(data);
    req.end();
  });
}


// ─── Authentification ───────────────────────────────
// Endpoint confirmé par DevTools : POST /account/login
// Réponse : { "token": "eyJ...", "refreshToken": "..." }
async function campusLogin(email, password) {
  const res = await campusRequest('POST', '/account/login', null, { email, password });
  const token        = res.token        || res.accessToken || res.access_token;
  const refreshToken = res.refreshToken || res.refresh_token;
  if (!token) throw new Error('Login Campus Coach échoué — pas de token dans la réponse');
  console.log(`✅ Campus login OK (${email})`);
  return { token, refreshToken, raw: res };
}

// ─── Refresh token ───────────────────────────────────
async function campusRefreshToken(refreshToken) {
  try {
    const res = await campusRequest('POST', '/account/refresh', null, { refreshToken });
    return res.token || res.accessToken;
  } catch(e) {
    throw new Error('Impossible de rafraîchir le token Campus: ' + e.message);
  }
}

// ─── Infos utilisateur ──────────────────────────────
async function getUserInfos(token) {
  return campusRequest('GET', '/user-infos', token);
}

// ─── Plan actif ────────────────────────────────────
// Endpoint confirmé : GET /smart-training/goal/active
// Retourne un tableau avec le goal en cours (status: "ongoing")
async function getActiveGoal(token) {
  // Statuts considérés comme "actifs" (le plan démarre peut-être en cours de journée)
  const ACTIVE_STATUSES = ['ongoing', 'preparation', 'upcoming', 'active',
                           'in_progress', 'en_preparation', 'en cours',
                           'preparing', 'started'];

  // Priorité 1 : /smart-training/goal/active (endpoint direct et fiable)
  try {
    const res = await campusRequest('GET', '/smart-training/goal/active', token);
    // Retourne un tableau — prendre le premier avec status actif
    const goals = Array.isArray(res) ? res : [res];
    console.log('[Campus] goal/active — statuts reçus:', goals.map(g => g.status + '/' + g._id).join(', '));
    const active = goals.find(g => ACTIVE_STATUSES.includes((g.status || '').toLowerCase()))
                || goals.find(g => g._id || g.id)  // fallback : prendre le premier avec un ID
                || goals[0];
    if (active?._id) {
      console.log('[Campus] goal actif:', active._id, '|', active.goalType, '|', active.status);
      try {
        const fullGoal = await campusRequest('GET', `/smart-training/goal/${active._id}`, token);
        return { ...active, ...fullGoal };
      } catch(e) {
        return active;
      }
    }
  } catch(e) {
    console.warn('[Campus] /smart-training/goal/active failed:', e.message.slice(0, 80));
  }

  // Fallback : /smart-training/goal-list (retourne les goals avec status)
  try {
    const res = await campusRequest('GET', '/smart-training/goal-list', token);
    const goals = res.goals || (Array.isArray(res) ? res : []);
    console.log('[Campus] goal-list — statuts reçus:', goals.map(g => (g.status || '?') + '/' + (g.id || g._id)).join(', '));
    const active = goals.find(g => ACTIVE_STATUSES.includes((g.status || '').toLowerCase()))
                || goals.find(g => g.id || g._id)
                || goals[0];
    if (active?.id || active?._id) {
      const goalId = active.id || active._id;
      const fullGoal = await campusRequest('GET', `/smart-training/goal/${goalId}`, token);
      return fullGoal;
    }
    // "Background goal" (kind:"background", ex: plan d'entretien route/trail
    // hors préparation de course precise) : goal-list ne renvoie jamais d'id
    // pour ce type (constate reel 14/08 - "ongoing/undefined" dans le log
    // ci-dessus alors que le plan est bien actif), donc /smart-training/goal/
    // {id} et tout ce qui en depend (getFullTrainingPlan, getGoalSummary...)
    // sont inutilisables ici. Sa plage de dates (startDate/endDate) suffit en
    // revanche a recuperer les semaines directement via /smart-training
    // (getSmartTraining, sans id) - on les attache tout de suite pour eviter
    // a l'appelant de refaire un aller-retour supplementaire.
    if (active?.kind === 'background' && active.startDate && active.endDate) {
      console.log('[Campus] Background goal actif (sans id) :', active.backgroundGoal, '|', active.sport);
      const weeks = await getSmartTraining(token, active.startDate, active.endDate);
      return { ...active, isBackgroundGoal: true, weeks: Array.isArray(weeks) ? weeks : [] };
    }
  } catch(e) {
    console.warn('[Campus] /smart-training/goal-list failed:', e.message.slice(0, 80));
  }

  // Aucun plan actif trouvé — retourner null (pas une erreur fatale)
  console.warn('[Campus] getActiveGoal: aucun plan trouvé');
  return null;
}


// ─── Plan complet par goalId ─────────────────────────
// Endpoint confirmé : GET /smart-training/goal/{goalId}
async function getGoal(token, goalId) {
  return campusRequest('GET', `/smart-training/goal/${goalId}`, token);
}

// ─── Plan par plage de dates ─────────────────────────
// Endpoint observé : GET /smart-training?from={ts}&to={ts}
async function getSmartTraining(token, fromDate, toDate) {
  const from = fromDate instanceof Date ? fromDate.getTime() : fromDate;
  const to   = toDate   instanceof Date ? toDate.getTime()   : toDate;
  return campusRequest('GET', `/smart-training?from=${from}&to=${to}`, token);
}

// ─── Séances d'un goal + semaine courante ────────────
async function getFullPlan(token, goalId) {
  const goal = await getGoal(token, goalId);
  return { goal, weeks: goal.weeks || [] };
}

// ─── Plan complet avec séances (endpoint training) ───
// Endpoint confirmé : GET /smart-training/training/{goalId}
// Retourne un tableau de semaines, chacune avec sessions[]
async function getFullTrainingPlan(token, goalId) {
  return campusRequest('GET', `/smart-training/training/${goalId}`, token);
}

// ─── Résumé du goal (summary + statistiques) ─────────
// Endpoint : GET /smart-training/goal/summary/{goalId}
async function getGoalSummary(token, goalId) {
  return campusRequest('GET', `/smart-training/goal/summary/${goalId}`, token);
}

// ─── Allures d'entraînement ──────────────────────────
// Endpoint : GET /smart-training/paces
async function getPaces(token) {
  try {
    return await campusRequest('GET', '/smart-training/paces', token);
  } catch(e) {
    return null;
  }
}

// ─── Prélude (séances détaillées d'une semaine) ──────
// Endpoint observé : GET /prelude/?{year}-{month}-{day}-{hour}
async function getPrelude(token, date) {
  const d = date instanceof Date ? date : new Date(date);
  const path = `/prelude/?${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}-${d.getHours()}`;
  try {
    return await campusRequest('GET', path, token);
  } catch(e) {
    return null;
  }
}

// ─── Séances de la semaine courante ──────────────────
async function getCurrentWeekSessions(token, goalId) {
  const goal = await getGoal(token, goalId);
  if (!goal?.weeks) return { goal, week: null, sessions: [] };

  const now = Date.now();
  const week = goal.weeks.find(w => {
    const wStart = w.weekDate;
    const wEnd   = wStart + 7 * 24 * 3600 * 1000;
    return now >= wStart && now < wEnd;
  }) || goal.weeks[goal.weeks.length - 1];

  // Essayer de récupérer les séances détaillées via prelude ou smart-training
  let sessions = week?.sessions || [];

  return { goal, week, sessions };
}

// ─── Exporter une séance vers Garmin ────────────────
// Endpoint confirmé : POST /garmin/smart-week/{weekId}/session/{n}
// Akka HTTP exige un body JSON même vide → on envoie {}
async function exportSessionToGarmin(token, weekId, sessionNumber) {
  const result = await campusRequest(
    'POST',
    `/garmin/smart-week/${weekId}/session/${sessionNumber}`,
    token,
    {}   // body vide obligatoire (Akka rejette Content-Length: 0 sans body)
  );
  console.log(`✅ Campus → Garmin : workout "${result.workoutName || 'sans nom'}" (id:${result.workoutId})`);
  return result;
}

// ─── Statut connexion Garmin dans Campus ────────────
async function getGarminConnectionStatus(token) {
  try {
    return await campusRequest('GET', '/garmin/status', token);
  } catch(e) {
    return { connected: false };
  }
}

// ─── Assiduité (streak, stats) ──────────────────────
async function getAssiduite(token) {
  try {
    return await campusRequest('GET', '/assiduity-status', token);
  } catch(e) { return null; }
}

module.exports = {
  campusLogin,
  campusRefreshToken,
  getUserInfos,
  getActiveGoal,
  getGoal,
  getSmartTraining,
  getFullPlan,
  getFullTrainingPlan,
  getGoalSummary,
  getPaces,
  getPrelude,
  getCurrentWeekSessions,
  exportSessionToGarmin,
  getGarminConnectionStatus,
  getAssiduite,
};
