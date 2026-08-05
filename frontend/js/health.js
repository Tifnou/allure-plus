// ============================================================
// health.js — Page Santé/Performance
// ============================================================

// ─── Icônes (SVG trait fin, même famille que les icônes de nav) ──────────
const HEALTH_ICONS = {
  weight:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="13" r="3.2"/><path d="M12 6v2"/></svg>',
  heart:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  battery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="18" height="10" rx="2"/><line x1="22" y1="10" x2="22" y2="14"/><rect x="4.5" y="9.5" width="9" height="5" rx="1" fill="currentColor" stroke="none"/></svg>',
  moon:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  vo2:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 4.6A2 2 0 1 1 11 8H2m10.6 11.4A2 2 0 1 0 14 16H2m15.7-8.3A2.5 2.5 0 1 1 19.5 12H2"/></svg>',
  trend:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  zap:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  flame:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
  gauge:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20a8 8 0 1 1 8-8"/><path d="M12 12l3.5-3.5"/><circle cx="12" cy="12" r="1"/></svg>',
  layers:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
};

// ─── Constantes ────────────────────────────────────────────────────────
const HEALTH_PERIODS = [
  { label: '1 sem.', days: 7 },
  { label: '4 sem.', days: 28 },
  { label: '6 mois', days: 182 },
];

let _healthActiveCategory = 'sante';
const _healthDataCache = {};       // `${metric}_${days}` -> resultat de load()
const _healthCategoryBuilt = { sante: false, performance: false };

async function fetchHealthMetric(key, days, loadFn) {
  const cacheKey = `${key}_${days}`;
  if (_healthDataCache[cacheKey]) return _healthDataCache[cacheKey];
  const result = await loadFn(days);
  _healthDataCache[cacheKey] = result;
  return result;
}

function healthCommentBox(comment) {
  if (!comment) {
    return '<div class="health-comment health-comment--empty">Pas encore assez de données pour un commentaire personnalisé sur cet indicateur.</div>';
  }
  return `
    <div class="health-comment health-comment--${comment.tier || 'neutral'}">
      <div class="health-comment-state">${escapeHtml(comment.state || '')}</div>
      <div class="health-comment-text">${comment.text || ''}</div>
    </div>`;
}

// ─── Rendu du corps (graphique ou tableau) ────────────────────────────
function renderHealthHistoryBody(bodyEl, chartId, cfg, result) {
  if (cfg.mode === 'table') {
    const rows = result.rows || [];
    if (rows.length === 0) {
      bodyEl.innerHTML = '<div class="health-empty">Aucune donnée sur cette période — revenez consulter cette page régulièrement pour construire l\'historique.</div>';
      return;
    }
    bodyEl.innerHTML = `
      <div class="races-table-scroll">
        <table class="races-table">
          <thead><tr>${(result.headers || []).map(h => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;
    return;
  }
  const series = result.series || [];
  if (series.length === 0) {
    bodyEl.innerHTML = '<div class="health-empty">Aucune donnée sur cette période.</div>';
    return;
  }
  bodyEl.innerHTML = `<canvas id="${chartId}"></canvas>`;
  const canvas = document.getElementById(chartId);
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  const color = cfg.color || '#2563EB';
  const opts = chartOptions();
  let datasets;
  // Cas particulier (Body Battery) : 2 courbes (matin/soir) + zone remplie
  // entre les deux pour visualiser la fourchette de la journee.
  if (result.series2) {
    opts.plugins.legend.display = true;
    opts.plugins.legend.position = 'top';
    opts.plugins.legend.labels = { color: '#ADADAD', boxWidth: 10, font: { size: 11, family: 'Inter' } };
    datasets = [
      {
        label: result.series2Label || 'Matin', data: result.series2.map(p => p.value),
        borderColor: result.series2Color || '#FBBF24', backgroundColor: 'transparent',
        borderWidth: 2, pointRadius: series.length > 40 ? 0 : 2, tension: 0.35, fill: false,
      },
      {
        label: result.seriesLabel || 'Soir', data: series.map(p => p.value),
        borderColor: color, backgroundColor: color + '20',
        borderWidth: 2, pointRadius: series.length > 40 ? 0 : 2, tension: 0.35, fill: '-1',
      },
    ];
  } else {
    datasets = [{
      data: series.map(p => p.value),
      borderColor: color, backgroundColor: color + '18',
      borderWidth: 2, pointRadius: series.length > 40 ? 0 : 3, tension: 0.35, fill: true,
    }];
  }
  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: series.map(p => p.label), datasets },
    options: opts,
  });
}

// ─── Construction d'un bloc métrique (DOM + cycle de vie) ─────────────
function buildMetricBlockHTML(cfg) {
  return `
  <div class="health-metric-block">
    <div class="health-metric-row">
      <div class="health-current-card">
        <div class="health-current-icon">${cfg.icon}</div>
        <div class="health-current-value" id="health-value-${cfg.key}">…</div>
        <div class="health-current-label">${cfg.label}</div>
        <div class="health-current-date" id="health-date-${cfg.key}"></div>
      </div>
      <div class="health-history-card">
        <div class="health-history-header">
          <div class="health-period-btns" data-metric="${cfg.key}">
            ${HEALTH_PERIODS.map((p, i) => `<button type="button" class="filter-pill health-period-btn${i === 0 ? ' active' : ''}" data-days="${p.days}">${p.label}</button>`).join('')}
          </div>
        </div>
        <div class="health-history-body health-history-body--${cfg.mode}" id="health-body-${cfg.key}">
          <div class="table-loading">Chargement…</div>
        </div>
      </div>
    </div>
    <div id="health-comment-${cfg.key}"></div>
  </div>`;
}

async function initMetricBlock(cfg) {
  const bodyEl = document.getElementById(`health-body-${cfg.key}`);
  const commentEl = document.getElementById(`health-comment-${cfg.key}`);
  const valueEl = document.getElementById(`health-value-${cfg.key}`);
  const dateEl = document.getElementById(`health-date-${cfg.key}`);
  const block = bodyEl.closest('.health-metric-block');
  const btns = block.querySelectorAll('.health-period-btn');

  async function load(days) {
    btns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.days) === days));
    bodyEl.innerHTML = '<div class="table-loading">Chargement…</div>';
    try {
      const result = await fetchHealthMetric(cfg.key, days, cfg.load);
      renderHealthHistoryBody(bodyEl, `health-chart-${cfg.key}`, cfg, result);
      commentEl.innerHTML = healthCommentBox(result.comment);
      if (result.current) {
        valueEl.innerHTML = `${result.current.value}<span class="health-current-unit">${result.current.unit || ''}</span>`;
        dateEl.textContent = result.current.dateLabel || '';
      } else {
        valueEl.textContent = '—';
        dateEl.textContent = 'Donnée non disponible';
      }
    } catch (e) {
      console.error(`health metric ${cfg.key}:`, e);
      bodyEl.innerHTML = '<div class="health-empty">Donnée indisponible pour le moment.</div>';
      commentEl.innerHTML = '';
    }
  }

  btns.forEach(b => b.addEventListener('click', () => load(parseInt(b.dataset.days))));
  await load(HEALTH_PERIODS[0].days);
}

// ─── Commentaires : sommeil ────────────────────────────────────────────
function buildSleepComment(latest) {
  if (!latest || latest.sleepScore == null) return null;
  const score = latest.sleepScore;
  const hours = latest.sleepTimeSeconds / 3600;
  const short = hours < 7;
  const qualifiers = {
    EXCELLENT: 'Excellent sommeil',
    GOOD: 'Bon sommeil',
    FAIR: 'Sommeil correct',
    POOR: 'Sommeil de mauvaise qualité',
  };
  if (short && score < 80) {
    return {
      state: 'Plus court que la durée idéale, non restaurateur',
      tier: 'attention',
      text: `Vous avez dormi ${hours.toFixed(1)} h la nuit dernière, un peu moins que la durée recommandée (7 à 9 h pour un sportif), et votre corps ne s'est pas complètement rechargé. Une journée stressante ou un entraînement intense la veille peuvent avoir compromis votre sommeil. Vous risquez de vous sentir plus fatigué ou irritable aujourd'hui — privilégiez une séance légère et couchez-vous plus tôt ce soir.`,
    };
  }
  const tier = (score >= 80) ? 'good' : (score >= 60 ? 'neutral' : 'attention');
  const title = qualifiers[latest.sleepScoreQualifier] || (score >= 80 ? 'Bon sommeil' : score >= 60 ? 'Sommeil correct' : 'Sommeil de mauvaise qualité');
  const advice = tier === 'good'
    ? "C'est un excellent terrain pour bien récupérer de vos entraînements et progresser."
    : "Continuez à soigner votre routine du soir (écrans, horaires réguliers, chambre fraîche) pour stabiliser la qualité de votre sommeil.";
  return {
    state: title, tier,
    text: `Vous avez dormi ${hours.toFixed(1)} h cette nuit pour un score de ${score}/100. ${advice}`,
  };
}

// ─── Commentaires : statut d'entraînement ─────────────────────────────
const TRAINING_STATUS_INFO = {
  PEAKING: {
    label: 'Pic de forme', tier: 'good',
    text: "Vous êtes au sommet de votre forme actuelle : l'équilibre entre charge d'entraînement et récupération est optimal. C'est le moment idéal pour viser une performance ou une course objectif — cet état ne dure généralement que quelques semaines, profitez-en plutôt que d'ajouter du volume.",
  },
  PRODUCTIVE: {
    label: 'Productif', tier: 'good',
    text: "Votre charge d'entraînement porte ses fruits : votre forme progresse pendant que vous récupérez correctement. Continuez sur cette lancée sans changer brutalement de rythme — c'est l'état le plus favorable pour progresser durablement.",
  },
  MAINTAINING: {
    label: 'Maintien', tier: 'neutral',
    text: "Votre forme actuelle est stable, sans progression ni régression notable ces dernières semaines. Pour progresser à nouveau, augmentez légèrement le volume ou l'intensité d'une séance par semaine — sinon c'est un état tout à fait sain en phase de stabilisation.",
  },
  RECOVERY: {
    label: 'Récupération', tier: 'neutral',
    text: "Votre charge d'entraînement est actuellement basse : votre corps récupère. Une bonne récupération prépare la prochaine phase de progression — profitez-en pour bien dormir et bien manger, et reprenez progressivement dès que vous vous sentez prêt.",
  },
  UNPRODUCTIVE: {
    label: 'Improductif', tier: 'attention',
    text: "Vous vous entraînez, mais votre forme ne progresse pas — souvent le signe d'une récupération insuffisante ou d'un stress accumulé. Réduisez temporairement l'intensité et priorisez le sommeil : forcer davantage dans cet état est contre-productif.",
  },
  DETRAINING: {
    label: 'Désentraînement', tier: 'attention',
    text: "Votre charge d'entraînement est trop faible depuis plusieurs jours et votre condition physique commence à décliner. Reprenez progressivement — 2 à 3 sorties par semaine suffisent pour stopper la baisse et relancer une dynamique positive.",
  },
  STRAINED: {
    label: 'Sous tension', tier: 'attention',
    text: "Votre charge d'entraînement récente dépasse votre capacité de récupération actuelle, signe de fatigue accumulée. Accordez-vous quelques jours plus légers, en portant une attention particulière au sommeil, au stress et à l'alimentation avant de reprendre une charge normale.",
  },
  OVERREACHING: {
    label: 'Surcharge fonctionnelle', tier: 'attention',
    text: "Vous vous entraînez dur et votre charge dépasse temporairement ce que votre corps encaisse bien — utile ponctuellement dans un bloc de préparation, mais risqué si ça dure. Si c'était volontaire, planifiez une semaine allégée juste après ; sinon réduisez la charge dès maintenant pour éviter la blessure ou le surentraînement.",
  },
  NO_STATUS: {
    label: 'Pas assez de données', tier: 'neutral',
    text: "Garmin n'a pas encore assez d'historique récent (VO2max, charge d'entraînement) pour calculer votre statut. Enregistrez quelques activités de course avec cardiofréquencemètre dans les prochains jours pour débloquer cet indicateur.",
  },
};

function trainingStatusInfo(phrase) {
  const base = String(phrase || '').replace(/_\d+$/, '');
  return TRAINING_STATUS_INFO[base] || null;
}

// ─── Chargement par métrique ───────────────────────────────────────────

async function loadWeightMetric(days) {
  const all = await fetch('/api/weight-history').then(r => r.json()).catch(() => []);
  const cutoff = Date.now() - days * 86400000;
  const series = all.filter(e => new Date(e.date).getTime() >= cutoff)
    .map(e => ({ label: formatDateShort(e.date, days > 60), value: e.weight }));
  const latest = all.length ? all[all.length - 1] : null;
  let comment = null;
  if (latest) {
    const p = loadProfileData();
    const ideal = (typeof calcIdealWeight === 'function' && p.height) ? calcIdealWeight(p.height, p.sex || 'M') : null;
    if (ideal) {
      if (latest.weight > ideal.max) {
        comment = {
          state: 'Au-dessus de votre fourchette sportive', tier: 'attention',
          text: `Avec ${latest.weight} kg, vous êtes au-dessus de votre fourchette de poids sportif idéal (${ideal.min}–${ideal.max} kg). Chaque kilo en moins représente un gain d'économie de course notable en endurance — privilégiez les sorties Z2 longues et une alimentation qualitative plutôt qu'un régime strict, pour ne pas perdre de masse musculaire utile à la course.`,
        };
      } else if (latest.weight < ideal.min) {
        comment = {
          state: 'En dessous de votre fourchette sportive', tier: 'attention',
          text: `Avec ${latest.weight} kg, vous êtes en dessous de la fourchette (${ideal.min}–${ideal.max} kg) généralement associée à un profil de coureur d'endurance. Assurez-vous de manger suffisamment pour soutenir votre entraînement et bien récupérer.`,
        };
      } else {
        comment = {
          state: 'Dans votre fourchette sportive', tier: 'good',
          text: `Avec ${latest.weight} kg, vous êtes dans la fourchette de poids sportif idéal (${ideal.min}–${ideal.max} kg) pour votre taille. C'est un excellent point d'appui pour progresser en endurance sans contrainte de poids superflue.`,
        };
      }
    } else {
      comment = { state: 'Dernier relevé', tier: 'neutral', text: `Votre dernier relevé est de ${latest.weight} kg (${formatDate(latest.date)}). Renseignez votre taille dans le Profil pour obtenir un commentaire personnalisé sur votre fourchette de poids sportif.` };
    }
  }
  return {
    series, comment,
    current: latest ? { value: String(latest.weight).replace('.', ','), unit: 'kg', dateLabel: 'au ' + formatDate(latest.date) } : null,
  };
}

async function loadRestingHRMetric(days) {
  const { data } = await fetch(`/api/heartrate?days=${days}`).then(r => r.json()).catch(() => ({ data: [] }));
  const points = (data || []).filter(d => d.data?.restingHeartRate > 0)
    .sort((a, b) => (a.data.calendarDate || a.date).localeCompare(b.data.calendarDate || b.date));
  const series = points.map(d => ({ label: formatDateShort(d.data.calendarDate || d.date, days > 60), value: d.data.restingHeartRate }));
  const latest = points.length ? points[points.length - 1] : null;
  let comment = null;
  if (latest) {
    const v = latest.data.restingHeartRate;
    const mean = series.reduce((s, p) => s + p.value, 0) / series.length;
    const diff = v - mean;
    if (series.length < 4) {
      comment = { state: 'FC repos du jour', tier: 'neutral', text: `Votre FC repos est de ${v} bpm. Revenez consulter cette page régulièrement pour obtenir une comparaison avec votre moyenne personnelle.` };
    } else if (diff <= -2) {
      comment = { state: 'FC repos en baisse — bon signe', tier: 'good', text: `Votre FC repos est de ${v} bpm, environ ${Math.abs(diff).toFixed(1)} bpm sous votre moyenne sur la période. C'est le signe d'une bonne récupération et d'une base aérobie qui progresse.` };
    } else if (diff >= 3) {
      comment = { state: 'FC repos au-dessus de votre moyenne', tier: 'attention', text: `Votre FC repos est de ${v} bpm, soit ${diff.toFixed(1)} bpm au-dessus de votre moyenne récente (${mean.toFixed(0)} bpm) — souvent le signe d'une fatigue, d'un stress ou d'un manque de sommeil. Si ça persiste plusieurs jours, prévoyez une séance plus légère.` };
    } else {
      comment = { state: 'FC repos stable', tier: 'neutral', text: `Votre FC repos de ${v} bpm est proche de votre moyenne récente (${mean.toFixed(0)} bpm) — un signe de régularité dans votre récupération.` };
    }
  }
  return { series, comment, current: latest ? { value: String(latest.data.restingHeartRate), unit: 'bpm', dateLabel: 'au ' + formatDate(latest.data.calendarDate || latest.date) } : null };
}

async function loadBodyBatteryMetric(days) {
  const { data } = await fetch(`/api/body-battery?days=${days}`).then(r => r.json()).catch(() => ({ data: [] }));
  const arr = Array.isArray(data) ? data : (data ? [data] : []);
  const series = arr.map(d => ({ label: formatDateShort(d.date, days > 60), value: d.current }));
  const series2 = arr.map(d => ({ label: formatDateShort(d.date, days > 60), value: d.morning }));
  const latest = arr.length ? arr[arr.length - 1] : null;
  let comment = null;
  if (latest) {
    const v = latest.current;
    const m = latest.morning;
    const rangeTxt = (m != null) ? ` Vous êtes parti·e ce matin avec ${m}% et vous en êtes maintenant à ${v}% — ${v >= m ? 'votre réserve a rechargé' : 'la journée a consommé votre réserve'}.` : '';
    if (v >= 75) comment = { state: 'Réserves élevées', tier: 'good', text: `Votre Body Battery est à ${v}%, un excellent niveau de réserve d'énergie.${rangeTxt} C'est le bon moment pour une séance exigeante (fractionné, seuil) si votre plan le prévoit.` };
    else if (v >= 40) comment = { state: 'Réserves moyennes', tier: 'neutral', text: `Avec ${v}% de Body Battery, vos réserves sont correctes sans être optimales.${rangeTxt} Une séance d'endurance modérée passera bien — gardez les séances intenses pour un jour où votre réserve sera plus haute.` };
    else comment = { state: 'Réserves basses', tier: 'attention', text: `Votre Body Battery est basse (${v}%) : votre corps n'a pas encore récupéré du stress ou de l'entraînement récent.${rangeTxt} Privilégiez le repos ou une sortie très légère, et soignez votre sommeil cette nuit pour recharger.` };
  }
  return {
    series, series2, seriesLabel: 'Soir / actuel', series2Label: 'Matin (réveil)', series2Color: '#FBBF24',
    comment,
    current: latest ? { value: String(latest.current), unit: '%', dateLabel: (latest.morning != null ? `matin ${latest.morning}% · ` : '') + 'au ' + formatDate(latest.date) } : null,
  };
}

async function loadSleepMetric(days) {
  const { data } = await fetch(`/api/sleep?days=${days}`).then(r => r.json()).catch(() => ({ data: [] }));
  const nights = (data || []).filter(d => d.sleepScore != null).sort((a, b) => a.date.localeCompare(b.date));
  const series = nights.map(n => ({ label: formatDateShort(n.date, days > 60), value: n.sleepScore }));
  const latest = nights.length ? nights[nights.length - 1] : null;
  const comment = buildSleepComment(latest);
  return { series, comment, current: latest ? { value: String(latest.sleepScore), unit: '/100', dateLabel: 'nuit du ' + formatDate(latest.date) } : null };
}

async function loadVo2maxMetric(days) {
  const cutoff = Date.now() - days * 86400000;
  const all = _vo2maxSeries || [];
  const pts = all.filter(p => p.date && new Date(p.date).getTime() >= cutoff);
  const series = pts.map(p => ({ label: formatDateShort(p.date, days > 60), value: p.value }));
  const latest = pts.length ? pts[pts.length - 1] : (all.length ? all[all.length - 1] : null);
  let comment = null;
  if (latest) {
    const prof = loadProfileData();
    const age = prof.birthDate ? Math.floor((Date.now() - new Date(prof.birthDate).getTime()) / (365.25 * 86400000)) : (prof.age || null);
    const sex = prof.sex || 'M';
    const cat = (typeof vo2maxLabel === 'function') ? vo2maxLabel(latest.value, sex, age) : '';
    const tierMap = { 'Faible': 'attention', 'Passable': 'neutral', 'Bon': 'neutral', 'Excellent': 'good', 'Supérieur': 'good' };
    const adviceByCat = {
      'Faible': "Un travail régulier d'endurance fondamentale (Z2, 3 à 4 fois par semaine) est le levier le plus efficace pour commencer à faire progresser ce chiffre.",
      'Passable': "Ajoutez une séance de fractionné ou de seuil par semaine en plus de votre endurance fondamentale : c'est ce qui fait le plus progresser la VO2max une fois la base posée.",
      'Bon': "Pour continuer à progresser, alternez séances de seuil et fractionné court (VMA), sans négliger la récupération entre les séances intenses.",
      'Excellent': "Vous êtes déjà à un très bon niveau : la marge de progression se joue désormais sur des détails (récupération, régularité, affûtage) plutôt que sur le volume.",
      'Supérieur': "Vous êtes dans le haut du classement pour votre profil : à ce niveau, la VO2max plafonne naturellement — la performance se joue surtout sur l'économie de course et le mental.",
    };
    comment = {
      state: cat ? `Niveau ${cat.toLowerCase()}` : 'VO2max',
      tier: tierMap[cat] || 'neutral',
      text: `Votre VO2max est de ${latest.value} ml/kg/min${cat ? `, un niveau classé "${cat}" pour votre profil` : ''}. C'est la quantité maximale d'oxygène que votre corps peut utiliser à l'effort : plus elle est haute, plus votre potentiel d'endurance est élevé et plus vous pouvez tenir une allure rapide longtemps. ${adviceByCat[cat] || ''}`,
    };
  }
  return { series, comment, current: latest ? { value: String(latest.value), unit: 'ml/kg/min', dateLabel: 'au ' + formatDate(latest.date) } : null };
}

async function loadTrainingStatusMetric(days) {
  const cur = await fetch('/api/training-status').then(r => r.json()).then(r => r.data).catch(() => null);
  const hist = await fetch(`/api/health-history/trainingStatus?days=${days}`).then(r => r.json()).catch(() => []);
  const info = cur ? trainingStatusInfo(cur.phrase) : null;
  const rows = hist.slice().reverse().map(e => {
    const i = trainingStatusInfo(e.value.phrase);
    return [formatDate(e.date), i ? i.label : (e.value.phrase || '—')];
  });
  const comment = info ? { state: info.label, tier: info.tier, text: info.text } : null;
  return {
    headers: ['Date', 'Statut'], rows, comment,
    current: cur ? { value: info ? info.label : (cur.phrase || '—'), unit: '', dateLabel: 'au ' + formatDate(cur.calendarDate) } : null,
  };
}

async function loadLactateMetric(days) {
  const cur = await fetch('/api/fitness').then(r => r.json()).catch(() => ({}));
  const hist = await fetch(`/api/health-history/lactateThreshold?days=${days}`).then(r => r.json()).catch(() => []);
  const series = hist.filter(e => e.value.ltHR).map(e => ({ label: formatDateShort(e.date, days > 60), value: e.value.ltHR }));
  let comment = null;
  if (cur.ltHR || cur.ltPaceSec) {
    const paceStr = cur.ltPaceSec ? formatPace(cur.ltPaceSec) : null;
    comment = {
      state: 'Seuil lactique', tier: 'neutral',
      text: `Votre seuil lactique est estimé à ${cur.ltHR ? cur.ltHR + ' bpm' : ''}${paceStr ? ' (environ ' + paceStr + ')' : ''}. C'est l'intensité au-delà de laquelle l'acide lactique s'accumule plus vite qu'il n'est éliminé — courir juste en dessous de ce seuil est ce que vous pouvez tenir le plus longtemps à haute intensité (utile pour cerner votre allure semi/10km). Des séances régulières « au seuil » (20 à 30 min à cette intensité) permettent de le repousser progressivement.${!cur.ltPaceSec ? " Cette valeur n'est estimée qu'à partir de la fréquence cardiaque : elle sera plus précise une fois calibrée par votre montre lors d'un test ou d'une course récente." : ''}`,
    };
  }
  return {
    series, comment,
    current: (cur.ltHR || cur.ltPaceSec) ? { value: cur.ltPaceSec ? formatPace(cur.ltPaceSec) : String(cur.ltHR), unit: cur.ltPaceSec ? '/km' : 'bpm', dateLabel: 'estimation actuelle' } : null,
  };
}

// ─── Commentaires : préparation à l'entraînement ──────────────────────
const READINESS_LEVEL_INFO = {
  VERY_HIGH: { label: 'Préparation très élevée', tier: 'good' },
  HIGH:      { label: 'Préparation élevée', tier: 'good' },
  MODERATE:  { label: 'Préparation moyenne', tier: 'neutral' },
  LOW:       { label: 'Préparation basse', tier: 'attention' },
  VERY_LOW:  { label: 'Préparation très basse', tier: 'attention' },
};
const READINESS_FACTOR_LABELS = {
  sleepScoreFactorFeedback: 'votre sommeil de la nuit dernière',
  recoveryTimeFactorFeedback: 'votre temps de récupération',
  acwrFactorFeedback: "votre charge d'entraînement récente",
  hrvFactorFeedback: 'votre variabilité de fréquence cardiaque',
  stressHistoryFactorFeedback: 'votre niveau de stress récent',
  sleepHistoryFactorFeedback: 'votre historique de sommeil',
};

async function loadTrainingReadinessMetric(days) {
  const cur = await fetch('/api/training-readiness').then(r => r.json()).then(r => r.data).catch(() => null);
  const hist = await fetch(`/api/health-history/trainingReadiness?days=${days}`).then(r => r.json()).catch(() => []);
  const series = hist.filter(e => e.value.score != null).map(e => ({ label: formatDateShort(e.date, days > 60), value: e.value.score }));
  let comment = null;
  if (cur) {
    const info = READINESS_LEVEL_INFO[cur.level] || { label: cur.level || 'Préparation', tier: 'neutral' };
    // Classe chaque facteur (POOR/LOW < MODERATE/FAIR < GOOD/HIGH) pour
    // toujours pouvoir designer le(s) facteur(s) le(s) plus limitant(s),
    // meme quand aucun n'est franchement "mauvais" a lui seul.
    const FACTOR_RANK = { POOR: 0, LOW: 0, MODERATE: 1, FAIR: 1, GOOD: 2, HIGH: 2 };
    const factorEntries = Object.entries(cur.factors || {}).filter(([, v]) => v);
    let factorTxt = '';
    if (factorEntries.length) {
      const rankOf = ([, v]) => FACTOR_RANK[v] ?? 1;
      const worstRank = Math.min(...factorEntries.map(rankOf));
      if (worstRank >= 2) {
        factorTxt = ' Tous les facteurs qui composent ce score sont favorables.';
      } else {
        const worstLabels = factorEntries.filter(e => rankOf(e) === worstRank).map(([k]) => READINESS_FACTOR_LABELS[k]).filter(Boolean);
        factorTxt = ` Le facteur le plus limitant aujourd'hui : ${worstLabels.join(', ')}.`;
      }
    }
    const adviceTxt = info.tier === 'good'
      ? " C'est un bon jour pour une séance exigeante si votre plan en prévoit une."
      : ' Privilégiez une séance légère ou un jour de repos, et reprenez normalement dès que ce score remonte.';
    comment = { state: info.label, tier: info.tier, text: `Votre préparation à l'entraînement est évaluée à ${cur.score}/100 (${info.label.toLowerCase()}).${factorTxt}${adviceTxt}` };
  }
  return { series, comment, current: cur ? { value: String(cur.score), unit: '/100', dateLabel: 'au ' + formatDate(cur.calendarDate) } : null };
}

async function loadCaloriesMetric(days) {
  const { data } = await fetch(`/api/calories?days=${days}`).then(r => r.json()).catch(() => ({ data: [] }));
  const arr = data || [];
  const series = arr.map(d => ({ label: formatDateShort(d.date, days > 60), value: d.activeKilocalories }));
  const latest = arr.length ? arr[arr.length - 1] : null;
  let comment = null;
  if (latest) {
    const active = latest.activeKilocalories;
    if (active >= 600) comment = { state: 'Journée très active', tier: 'good', text: `Vous avez brûlé ${active} kcal par l'activité aujourd'hui, en plus de vos ${latest.bmrKilocalories} kcal de métabolisme de base (${latest.totalKilocalories} kcal au total). Pensez à compenser cette dépense par une alimentation suffisante, en particulier en glucides, pour bien récupérer.` };
    else if (active >= 200) comment = { state: 'Journée modérément active', tier: 'neutral', text: `Vous avez brûlé ${active} kcal par l'activité aujourd'hui (${latest.totalKilocalories} kcal au total avec le métabolisme de base). Une alimentation équilibrée classique suffit à compenser une journée comme celle-ci.` };
    else comment = { state: 'Journée peu active', tier: 'neutral', text: `Seulement ${active} kcal brûlées par l'activité aujourd'hui (${latest.totalKilocalories} kcal au total, l'essentiel venant de votre métabolisme de base). Rien d'alarmant ponctuellement — c'est la régularité sur la semaine qui compte.` };
  }
  return { series, comment, current: latest ? { value: String(latest.activeKilocalories), unit: 'kcal', dateLabel: 'actives, au ' + formatDate(latest.date) } : null };
}

// ─── Commentaires : training effect (aérobie / anaérobie) ─────────────
function trainingEffectScale(v) {
  if (v == null) return null;
  if (v < 1) return { label: 'Aucun effet', tier: 'neutral' };
  if (v < 2) return { label: 'Effet mineur', tier: 'neutral' };
  if (v < 3) return { label: 'Maintien', tier: 'neutral' };
  if (v < 4) return { label: 'Amélioration', tier: 'good' };
  if (v < 5) return { label: 'Forte amélioration', tier: 'good' };
  return { label: 'Surcharge', tier: 'attention' };
}

async function loadTrainingEffectMetric(days) {
  const cutoff = Date.now() - days * 86400000;
  const runs = (_allActivities || [])
    .filter(a => {
      const t = (a.activityType || '').toLowerCase();
      return (t.includes('run') || t.includes('trail')) && a.aerobicTrainingEffect != null && new Date(a.date).getTime() >= cutoff;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const rows = runs.slice().reverse().slice(0, 30).map(a => [
    formatDate(a.date), escapeHtml(a.name || ''),
    a.aerobicTrainingEffect != null ? a.aerobicTrainingEffect.toFixed(1) : '—',
    a.anaerobicTrainingEffect != null ? a.anaerobicTrainingEffect.toFixed(1) : '—',
  ]);
  const latest = runs.length ? runs[runs.length - 1] : null;
  let comment = null;
  if (latest) {
    const aer = trainingEffectScale(latest.aerobicTrainingEffect);
    const anaer = trainingEffectScale(latest.anaerobicTrainingEffect);
    const dominant = latest.aerobicTrainingEffect >= latest.anaerobicTrainingEffect ? 'aérobie (endurance)' : 'anaérobie (intensité/vitesse)';
    comment = {
      state: `Aérobie : ${aer ? aer.label : '—'} · Anaérobie : ${anaer ? anaer.label : '—'}`,
      tier: (aer && aer.tier === 'attention') || (anaer && anaer.tier === 'attention') ? 'attention' : ((aer && aer.tier === 'good') ? 'good' : 'neutral'),
      text: `Votre dernière sortie (${latest.aerobicTrainingEffect.toFixed(1)} en effet aérobie, ${latest.anaerobicTrainingEffect.toFixed(1)} en effet anaérobie) a surtout sollicité votre filière ${dominant}. L'effet aérobie mesure le bénéfice sur votre endurance de fond, l'effet anaérobie celui sur votre capacité à tenir un effort intense. Pour progresser sur les deux, alternez des sorties à dominante aérobie (Z2 longues) et des séances plus courtes et intenses (fractionné, côtes) qui développent l'anaérobie.`,
    };
  }
  return {
    headers: ['Date', 'Activité', 'Aérobie', 'Anaérobie'], rows, comment,
    current: latest ? { value: latest.aerobicTrainingEffect.toFixed(1), unit: '/5', dateLabel: 'aérobie, ' + formatDate(latest.date) } : null,
  };
}

// ─── Âge physique (estimation Allure+ — pas de donnée Garmin equivalente
// exploitable, voir CLAUDE.md). Garmin decrit sa propre metrique comme basee
// sur l'intensite d'activite, la FC repos et l'IMC/masse grasse : on a deja
// toutes ces briques via le VO2max (bien correle a la forme cardio), la FC
// repos et le profil (taille/poids), donc on construit notre propre
// estimation plutot que de laisser la metrique vide.
function estimatePhysicalAge(vo2, sex, chronoAge, restingHR, bmi) {
  if (!vo2 || !chronoAge || typeof vo2maxCategoryIndex !== 'function') return null;
  const cat = vo2maxCategoryIndex(vo2, sex, chronoAge); // 0=Faible .. 4=Superieur, 2=Bon (reference neutre)
  let age = chronoAge - (cat - 2) * 4;
  if (restingHR) {
    if (restingHR < 50) age -= 2;
    else if (restingHR < 55) age -= 1;
    else if (restingHR > 75) age += 2;
    else if (restingHR > 65) age += 1;
  }
  if (bmi) {
    if (bmi > 25) age += Math.min((bmi - 25) * 0.3, 3);
    else if (bmi < 18.5) age += 1;
  }
  return Math.max(18, Math.min(Math.round(age), chronoAge + 15));
}

async function loadPhysicalAgeMetric(days) {
  const prof = loadProfileData();
  const sex = prof.sex || 'M';
  const chronoAge = prof.birthDate ? Math.floor((Date.now() - new Date(prof.birthDate).getTime()) / (365.25 * 86400000)) : (prof.age || null);
  const bmi = (typeof calcBMI === 'function' && prof.height && prof.weight) ? calcBMI(prof.weight, prof.height) : null;

  if (!chronoAge) {
    return { series: [], comment: { state: 'Profil incomplet', tier: 'neutral', text: "Renseignez votre date de naissance, votre taille et votre poids dans le Profil pour estimer votre âge physique." }, current: null };
  }

  const cutoff = Date.now() - days * 86400000;
  const vo2Pts = (_vo2maxSeries || []).filter(p => p.date && new Date(p.date).getTime() >= cutoff);
  const { data: hrData } = await fetch(`/api/heartrate?days=${days}`).then(r => r.json()).catch(() => ({ data: [] }));
  const hrPoints = (hrData || []).filter(d => d.data?.restingHeartRate > 0).map(d => ({ date: d.data.calendarDate || d.date, value: d.data.restingHeartRate }));

  function nearestHR(dateStr) {
    if (!hrPoints.length) return null;
    const t = new Date(dateStr).getTime();
    let best = null, bestDiff = Infinity;
    hrPoints.forEach(p => { const diff = Math.abs(new Date(p.date).getTime() - t); if (diff < bestDiff) { bestDiff = diff; best = p.value; } });
    return bestDiff <= 5 * 86400000 ? best : null;
  }

  const series = vo2Pts.map(p => {
    const ageAtPoint = estimatePhysicalAge(p.value, sex, chronoAge, nearestHR(p.date), bmi);
    return ageAtPoint != null ? { label: formatDateShort(p.date, days > 60), value: ageAtPoint } : null;
  }).filter(Boolean);

  const latestVo2 = vo2Pts.length ? vo2Pts[vo2Pts.length - 1] : ((_vo2maxSeries || []).length ? _vo2maxSeries[_vo2maxSeries.length - 1] : null);
  const currentAge = latestVo2 ? estimatePhysicalAge(latestVo2.value, sex, chronoAge, nearestHR(latestVo2.date), bmi) : null;

  let comment = null;
  if (currentAge != null) {
    const diff = chronoAge - currentAge;
    const disclaimer = ' (estimation Allure+ à partir de votre VO2max, FC repos et IMC — même principe que Garmin, sans être identique à son chiffre).';
    if (diff >= 2) comment = { state: `${diff} ans de moins que votre âge réel`, tier: 'good', text: `Votre âge physique estimé est de ${currentAge} ans, pour un âge réel de ${chronoAge} ans — votre forme cardiovasculaire vous place en avance sur votre âge.${disclaimer} Continuez à entretenir cet écart avec de la régularité en endurance fondamentale.` };
    else if (diff <= -2) comment = { state: `${Math.abs(diff)} ans de plus que votre âge réel`, tier: 'attention', text: `Votre âge physique estimé est de ${currentAge} ans, au-dessus de votre âge réel (${chronoAge} ans).${disclaimer} Le levier le plus efficace pour le faire baisser est votre VO2max : plus de sorties d'endurance fondamentale et quelques séances de fractionné par semaine peuvent le faire progresser sensiblement en quelques mois.` };
    else comment = { state: 'Proche de votre âge réel', tier: 'neutral', text: `Votre âge physique estimé (${currentAge} ans) est proche de votre âge réel (${chronoAge} ans).${disclaimer} Une progression de votre VO2max ou une baisse de votre FC repos sont les leviers les plus efficaces pour le faire baisser.` };
  }

  return { series, comment, current: currentAge != null ? { value: String(currentAge), unit: 'ans', dateLabel: 'estimation Allure+' } : null };
}

// ─── Registre des métriques ────────────────────────────────────────────
const HEALTH_METRICS = [
  { key: 'weight',             category: 'sante',       label: 'Poids',                   icon: HEALTH_ICONS.weight,  mode: 'chart', color: '#2563EB', load: loadWeightMetric },
  { key: 'restingHR',          category: 'sante',       label: 'FC repos',                icon: HEALTH_ICONS.heart,   mode: 'chart', color: '#DC2626', load: loadRestingHRMetric },
  { key: 'bodyBattery',        category: 'sante',       label: 'Body Battery',            icon: HEALTH_ICONS.battery, mode: 'chart', color: '#16A34A', load: loadBodyBatteryMetric },
  { key: 'sleepScore',         category: 'sante',       label: 'Score de sommeil',        icon: HEALTH_ICONS.moon,    mode: 'chart', color: '#7C3AED', load: loadSleepMetric },
  { key: 'physicalAge',        category: 'sante',       label: 'Âge physique',            icon: HEALTH_ICONS.calendar, mode: 'chart', color: '#0891B2', load: loadPhysicalAgeMetric },
  { key: 'calories',           category: 'sante',       label: 'Calories brûlées',        icon: HEALTH_ICONS.flame,   mode: 'chart', color: '#EA580C', load: loadCaloriesMetric },
  { key: 'vo2max',             category: 'performance', label: 'VO₂max',                  icon: HEALTH_ICONS.vo2,     mode: 'chart', color: '#7C3AED', load: loadVo2maxMetric },
  { key: 'trainingStatus',     category: 'performance', label: "Statut d'entraînement",   icon: HEALTH_ICONS.trend,   mode: 'table',                   load: loadTrainingStatusMetric },
  { key: 'trainingReadiness',  category: 'performance', label: "Préparation à l'entraînement", icon: HEALTH_ICONS.gauge, mode: 'chart', color: '#0EA5E9', load: loadTrainingReadinessMetric },
  { key: 'trainingEffect',     category: 'performance', label: 'Training Effect',         icon: HEALTH_ICONS.layers,  mode: 'table',                   load: loadTrainingEffectMetric },
  { key: 'lactateThreshold',   category: 'performance', label: 'Seuil lactique',          icon: HEALTH_ICONS.zap,     mode: 'chart', color: '#D97706', load: loadLactateMetric },
];

// ─── Page ───────────────────────────────────────────────────────────────
async function renderHealthPage() {
  const tabsEl = document.getElementById('health-category-tabs');
  if (tabsEl && !tabsEl.dataset.wired) {
    tabsEl.dataset.wired = '1';
    tabsEl.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _healthActiveCategory = btn.dataset.cat;
        renderHealthCategory();
      });
    });
  }
  renderHealthCategory();
}

async function renderHealthCategory() {
  const content = document.getElementById('health-content');
  if (!content) return;
  content.querySelectorAll('.health-category-section').forEach(s => { s.style.display = 'none'; });
  let section = document.getElementById(`health-section-${_healthActiveCategory}`);
  if (!section) {
    section = document.createElement('div');
    section.className = 'health-category-section';
    section.id = `health-section-${_healthActiveCategory}`;
    content.appendChild(section);
  }
  section.style.display = '';
  if (_healthCategoryBuilt[_healthActiveCategory]) return;
  _healthCategoryBuilt[_healthActiveCategory] = true;
  const metrics = HEALTH_METRICS.filter(m => m.category === _healthActiveCategory);
  section.innerHTML = metrics.map(buildMetricBlockHTML).join('');
  // Sequentiel volontaire : evite de solliciter Garmin en parallele sur
  // plusieurs metriques a la fois (chacune peut deja faire plusieurs
  // requetes internes pour les longues periodes).
  for (const m of metrics) { await initMetricBlock(m); }
}
