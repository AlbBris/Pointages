(() => {
  'use strict';

  const STORAGE_KEY = 'gcc-pointages-v1-2-multi-project';
  const LEGACY_STORAGE_KEYS = ['gcc-pointages-v1-1-empty', 'gcc-pointages-v1'];
  const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  const DAY_SHORT = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const ABSENCE_CODES = [
    { code: 'PRESENT', label: 'Présent' },
    { code: 'CP', label: 'Congés' },
    { code: 'AM', label: 'Arrêt maladie' },
    { code: 'AT', label: 'Accident du travail' },
    { code: 'FORMATION', label: 'Formation' },
    { code: 'INTEMPERIE', label: 'Intempérie' },
    { code: 'ABSENT', label: 'Absent' }
  ];

  const ui = {
    view: 'pointage',
    day: 0,
    typeFilter: 'all',
    peopleSearch: '',
    mobilePointageFilter: window.matchMedia?.('(max-width: 680px)').matches ? 'todo' : 'all',
    mobileFiltersOpen: false,
    personnelSearch: '',
    taskSearch: '',
    contractSearch: '',
    contractStatusFilter: 'all',
    showContractHistory: false,
    teamFilter: 'all',
    rosterSearch: '',
    showInactivePeople: false,
    personnelSelectionMode: false,
    selectedPersonnel: new Set(),
    selectionMode: false,
    selectedPeople: new Set(),
    editingPointage: null,
    entryDraft: [],
    pendingInterimOnboarding: false,
    toastTimer: null
  };

  let store = loadStore();
  let db = null;

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function createProjectData(meta = {}) {
    const project = clone(window.POINTAGES_SEED);
    const today = new Date();
    const weekInfo = getIsoWeekInfo(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
    const now = new Date().toISOString();
    project.version = 1.14;
    project.project = {
      id: meta.id || nextId('chantier'),
      name: meta.name || 'Nouveau chantier',
      code: meta.code || '',
      management: meta.management || '',
      defaultZone: meta.defaultZone || '',
      secretaryEmail: meta.secretaryEmail || '',
      createdAt: meta.createdAt || now,
      updatedAt: now
    };
    project.currentWeek = weekInfo;
    project.people = [];
    project.tasks = [];
    project.teams = [];
    project.interimContracts = [];
    project.contractRules = { maxRenewals: 2, maxDurationMonths: 18, alertDays: [21, 14, 7, 2], arrivalAlertDays: [7, 2], carenceMode: 'standard', blockOutsideContract: false, excludeExpiredFromNewWeeks: true };
    project.integration = { mode: 'local', emailMode: 'mailto', onlineReady: true, publicLiaisonBaseUrl: '' };
    project.defaultSchedules = { GCC: [8, 8, 8, 8, 7], Interim: [7.5, 7.5, 7.5, 7.5, 7], PretMO: [7.5, 7.5, 7.5, 7.5, 7] };
    project.weeks = {};
    return project;
  }

  function isProjectDatabase(value) {
    return Boolean(value && value.project && Array.isArray(value.people) && Array.isArray(value.tasks) && value.weeks);
  }

  function hasMeaningfulLegacyData(project) {
    if (!isProjectDatabase(project)) return false;
    const hasEntries = Object.values(project.weeks || {}).some(week => (week.entries?.length || 0) + (week.absences?.length || 0) + (week.lates?.length || 0) > 0);
    return project.people.length > 0 || project.tasks.length > 0 || hasEntries || !['', 'Nouveau chantier'].includes(project.project?.name || '');
  }

  function normalizeProject(project) {
    const normalized = clone(project);
    normalized.version = 1.14;
    normalized.project ||= {};
    normalized.project.id ||= nextId('chantier');
    normalized.project.name ||= 'Chantier';
    normalized.project.code ||= '';
    normalized.project.management ||= '';
    normalized.project.defaultZone ||= '';
    normalized.project.secretaryEmail ||= '';
    normalized.project.createdAt ||= new Date().toISOString();
    normalized.project.updatedAt ||= normalized.project.createdAt;
    normalized.people ||= [];
    normalized.people = normalized.people.map(person => {
      const typeText = String(person?.type || 'GCC').toLocaleLowerCase('fr');
      const type = (typeText.startsWith('prêt') || typeText.startsWith('pret')) ? 'Prêt de MO' : (typeText.startsWith('int') ? 'Intérim' : 'GCC');
      return { ...person, type };
    });
    normalized.tasks ||= [];
    normalized.teams ||= [];
    normalized.interimContracts ||= [];
    normalized.contractRules = { maxRenewals: 2, maxDurationMonths: 18, alertDays: [21, 14, 7, 2], arrivalAlertDays: [7, 2], carenceMode: 'standard', blockOutsideContract: false, excludeExpiredFromNewWeeks: true, ...(normalized.contractRules || {}) };
    normalized.contractRules.maxRenewals = Math.max(0, Number(normalized.contractRules.maxRenewals ?? 2));
    normalized.contractRules.maxDurationMonths = Math.max(1, Number(normalized.contractRules.maxDurationMonths ?? 18));
    normalized.contractRules.alertDays = Array.isArray(normalized.contractRules.alertDays) ? normalized.contractRules.alertDays.map(Number).filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => b - a) : [21, 14, 7, 2];
    normalized.contractRules.arrivalAlertDays = Array.isArray(normalized.contractRules.arrivalAlertDays) ? normalized.contractRules.arrivalAlertDays.map(Number).filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => b - a) : [7, 2];
    normalized.integration = { mode: 'local', emailMode: 'mailto', onlineReady: true, publicLiaisonBaseUrl: '', ...(normalized.integration || {}) };
    normalized.contractRules.carenceMode = normalized.contractRules.carenceMode === 'none' ? 'none' : 'standard';
    normalized.contractRules.blockOutsideContract = Boolean(normalized.contractRules.blockOutsideContract);
    normalized.contractRules.excludeExpiredFromNewWeeks = normalized.contractRules.excludeExpiredFromNewWeeks !== false;
    normalized.interimContracts = normalized.interimContracts.map(contract => {
      const liaison = contract.liaison || {};
      return {
        id: contract.id || nextId('contract'), personId: contract.personId || '', agency: contract.agency || '', contractNumber: contract.contractNumber || '', position: contract.position || '', reason: contract.reason || 'Accroissement temporaire', startDate: contract.startDate || '', initialEndDate: contract.initialEndDate || contract.endDate || '', maxDurationMonths: contract.maxDurationMonths ? Number(contract.maxDurationMonths) : '', carenceExempt: Boolean(contract.carenceExempt), note: contract.note || '', closed: Boolean(contract.closed), createdAt: contract.createdAt || new Date().toISOString(), renewals: Array.isArray(contract.renewals) ? contract.renewals.map(item => ({ id: item.id || nextId('renewal'), startDate: item.startDate || '', endDate: item.endDate || '', signedDate: item.signedDate || '', reference: item.reference || '', note: item.note || '' })) : [],
        liaison: {
          status: ['to_send', 'sent', 'completed', 'validated'].includes(liaison.status) ? liaison.status : 'to_send',
          agencyEmail: liaison.agencyEmail || '', contactName: liaison.contactName || '', contactPhone: liaison.contactPhone || '',
          hourlyRate: liaison.hourlyRate ?? '', billingCoefficient: liaison.billingCoefficient ?? '', mealAllowance: liaison.mealAllowance ?? '', travelAllowance: liaison.travelAllowance ?? '', transportAllowance: liaison.transportAllowance ?? '', weeklyHours: liaison.weeklyHours ?? '',
          note: liaison.note || '', sentAt: liaison.sentAt || '', completedAt: liaison.completedAt || '', validatedAt: liaison.validatedAt || '', emailPreparedAt: liaison.emailPreparedAt || '', token: liaison.token || nextId('liaison')
        }
      };
    });
    normalized.defaultSchedules ||= { GCC: [8, 8, 8, 8, 7], Interim: [7.5, 7.5, 7.5, 7.5, 7], PretMO: [7.5, 7.5, 7.5, 7.5, 7] };
    normalized.defaultSchedules.GCC = Array.isArray(normalized.defaultSchedules.GCC) ? normalized.defaultSchedules.GCC.slice(0, 5).map(Number) : [8, 8, 8, 8, 7];
    normalized.defaultSchedules.Interim = Array.isArray(normalized.defaultSchedules.Interim) ? normalized.defaultSchedules.Interim.slice(0, 5).map(Number) : [7.5, 7.5, 7.5, 7.5, 7];
    normalized.defaultSchedules.PretMO = Array.isArray(normalized.defaultSchedules.PretMO) ? normalized.defaultSchedules.PretMO.slice(0, 5).map(Number) : [7.5, 7.5, 7.5, 7.5, 7];
    while (normalized.defaultSchedules.GCC.length < 5) normalized.defaultSchedules.GCC.push(0);
    while (normalized.defaultSchedules.Interim.length < 5) normalized.defaultSchedules.Interim.push(0);
    while (normalized.defaultSchedules.PretMO.length < 5) normalized.defaultSchedules.PretMO.push(0);
    normalized.teams = normalized.teams.map(team => ({ id: team.id || nextId('team'), name: team.name || 'Équipe', memberIds: Array.isArray(team.memberIds) ? team.memberIds : [] }));
    normalized.weeks ||= {};
    Object.values(normalized.weeks).forEach(week => {
      week.entries ||= []; week.absences ||= []; week.lates ||= []; week.notes ||= ''; week.locked = Boolean(week.locked);
      if (week.rosterIds && !Array.isArray(week.rosterIds)) week.rosterIds = [];
    });
    if (!normalized.currentWeek?.year || !normalized.currentWeek?.week) {
      const now = new Date();
      normalized.currentWeek = getIsoWeekInfo(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
    }
    return normalized;
  }

  function loadStore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.projects)) {
          return { version: 1.14, projects: parsed.projects.filter(isProjectDatabase).map(normalizeProject) };
        }
      }
      for (const key of LEGACY_STORAGE_KEYS) {
        const legacySaved = localStorage.getItem(key);
        if (!legacySaved) continue;
        const legacy = JSON.parse(legacySaved);
        if (hasMeaningfulLegacyData(legacy)) {
          const migrated = normalizeProject(legacy);
          const migratedStore = { version: 1.14, projects: [migrated] };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedStore));
          return migratedStore;
        }
      }
    } catch (error) {
      console.warn('Impossible de charger la sauvegarde locale.', error);
    }
    return { version: 1.14, projects: [] };
  }

  function saveStore() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function saveDatabase(message = 'Sauvegardé') {
    if (!db) return;
    const indicator = document.getElementById('save-indicator');
    indicator?.classList.add('saving');
    if (indicator) indicator.querySelector('span:last-child').textContent = 'Enregistrement…';
    try {
      db.project.updatedAt = new Date().toISOString();
      const index = store.projects.findIndex(project => project.project.id === db.project.id);
      if (index >= 0) store.projects[index] = db;
      else store.projects.push(db);
      saveStore();
      window.setTimeout(() => {
        indicator?.classList.remove('saving');
        if (indicator) indicator.querySelector('span:last-child').textContent = message;
      }, 180);
    } catch (error) {
      showToast('La sauvegarde locale a échoué.', true);
      console.error(error);
    }
  }

  function weekKey(year = db.currentWeek.year, week = db.currentWeek.week) {
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  function ensureCurrentWeek() {
    const key = weekKey();
    let created = false;
    if (!db.weeks[key]) {
      created = true;
      db.weeks[key] = {
        year: db.currentWeek.year,
        week: db.currentWeek.week,
        entries: [],
        absences: [],
        lates: [],
        notes: '',
        rosterIds: db.people.filter(person => person.active !== false && isPersonEligibleForWeek(person, db.currentWeek.year, db.currentWeek.week)).map(person => person.id),
        locked: false,
        lockedAt: ''
      };
    }
    const week = db.weeks[key];
    week.entries ||= [];
    week.absences ||= [];
    week.lates ||= [];
    week.notes ||= '';
    week.locked = Boolean(week.locked);
    week.lockedAt ||= '';
    if (!Array.isArray(week.rosterIds)) {
      const linked = new Set([...week.entries.map(entry => entry.personId), ...week.absences.map(item => item.personId), ...week.lates.map(item => item.personId)]);
      db.people.filter(person => person.active !== false).forEach(person => linked.add(person.id));
      week.rosterIds = [...linked];
    }
    if (created) saveDatabase();
    return week;
  }

  function currentWeek() {
    return ensureCurrentWeek();
  }

  function isoWeekMonday(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const day = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
    return monday;
  }

  function dateForDay(day) {
    const date = isoWeekMonday(db.currentWeek.year, db.currentWeek.week);
    date.setUTCDate(date.getUTCDate() + day);
    return date;
  }

  function getIsoWeekInfo(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
  }

  function formatDate(date, withYear = false) {
    const text = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
    return withYear ? `${text} ${date.getUTCFullYear()}` : text;
  }

  function formatWeekRange() {
    const monday = dateForDay(0);
    const friday = dateForDay(4);
    if (monday.getUTCMonth() === friday.getUTCMonth()) {
      return `${monday.getUTCDate()}–${friday.getUTCDate()} ${MONTHS[monday.getUTCMonth()]}`;
    }
    return `${formatDate(monday)} – ${formatDate(friday)}`;
  }

  function dateIso(day) {
    return dateForDay(day).toISOString().slice(0, 10);
  }


  function todayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function parseDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateIso(value) {
    const date = parseDateOnly(value);
    return date ? date.toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—';
  }

  function daysBetween(start, end) {
    const a = parseDateOnly(start); const b = parseDateOnly(end);
    if (!a || !b) return 0;
    return Math.floor((b - a) / 86400000);
  }

  function addMonthsMinusOneDay(start, months) {
    const date = parseDateOnly(start);
    if (!date || !Number(months)) return '';
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + Number(months));
    const maxDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(originalDay, maxDay));
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  function contractsForPerson(personId) {
    return (db.interimContracts || []).filter(contract => contract.personId === personId);
  }

  function contractCurrentEnd(contract) {
    const renewalEnds = (contract?.renewals || []).map(item => item.endDate).filter(Boolean).sort();
    return renewalEnds.at(-1) || contract?.initialEndDate || '';
  }

  function contractForDate(personId, isoDate) {
    return contractsForPerson(personId).find(contract => !contract.closed && contract.startDate && contractCurrentEnd(contract) && isoDate >= contract.startDate && isoDate <= contractCurrentEnd(contract)) || null;
  }

  function latestContractForPerson(personId) {
    return contractsForPerson(personId).slice().sort((a, b) => String(contractCurrentEnd(b)).localeCompare(String(contractCurrentEnd(a))))[0] || null;
  }

  function contractDurationDays(contract, endDate = contractCurrentEnd(contract)) {
    return contract?.startDate && endDate ? Math.max(0, daysBetween(contract.startDate, endDate) + 1) : 0;
  }

  function contractMaximumEnd(contract) {
    const months = Number(contract?.maxDurationMonths || db.contractRules?.maxDurationMonths || 18);
    return addMonthsMinusOneDay(contract?.startDate, months);
  }

  function contractCarenceDays(contract) {
    if (!contract || contract.carenceExempt || db.contractRules?.carenceMode === 'none') return 0;
    const duration = contractDurationDays(contract);
    return Math.ceil(duration >= 14 ? duration / 3 : duration / 2);
  }

  function contractState(contract, referenceDate = todayIso()) {
    if (!contract) return { key: 'missing', label: 'Sans contrat', daysRemaining: null, level: 'warning' };
    const end = contractCurrentEnd(contract);
    if (contract.closed) return { key: 'closed', label: 'Clôturé', daysRemaining: end ? daysBetween(referenceDate, end) : null, level: 'muted' };
    if (!contract.startDate || !end) return { key: 'missing', label: 'À compléter', daysRemaining: null, level: 'warning' };
    if (referenceDate < contract.startDate) return { key: 'upcoming', label: 'À venir', daysRemaining: daysBetween(referenceDate, contract.startDate), level: 'info' };
    const remaining = daysBetween(referenceDate, end);
    if (remaining < 0) return { key: 'expired', label: 'Expiré', daysRemaining: remaining, level: 'danger' };
    const threshold = Math.max(...(db.contractRules?.alertDays || [21, 14, 7, 2]), 0);
    if (remaining <= threshold) return { key: 'attention', label: remaining === 0 ? 'Dernier jour' : `J-${remaining}`, daysRemaining: remaining, level: remaining <= 7 ? 'danger' : 'warning' };
    return { key: 'active', label: 'En cours', daysRemaining: remaining, level: 'success' };
  }

  function isPersonEligibleForWeek(person, year, weekNumber) {
    if (!person || person.type !== 'Intérim' || !db?.contractRules?.excludeExpiredFromNewWeeks) return true;
    const contracts = contractsForPerson(person.id).filter(contract => !contract.closed);
    if (!contracts.length) return true;
    const monday = isoWeekMonday(year, weekNumber).toISOString().slice(0, 10);
    const fridayDate = isoWeekMonday(year, weekNumber); fridayDate.setUTCDate(fridayDate.getUTCDate() + 4);
    const friday = fridayDate.toISOString().slice(0, 10);
    return contracts.some(contract => contract.startDate <= friday && contractCurrentEnd(contract) >= monday);
  }

  function pointageContractCheck(personId, day) {
    const person = getPerson(personId);
    if (!person || person.type !== 'Intérim') return { ok: true };
    const iso = dateIso(day);
    const contracts = contractsForPerson(personId);
    if (!contracts.length) return { ok: true, warning: `${person.name} ne possède pas encore de mission renseignée.` };
    if (contractForDate(personId, iso)) return { ok: true };
    const latest = latestContractForPerson(personId);
    const detail = latest ? `Période connue : ${formatDateIso(latest.startDate)} au ${formatDateIso(contractCurrentEnd(latest))}.` : '';
    return { ok: !db.contractRules?.blockOutsideContract, warning: `${person.name} est pointé hors période contractuelle. ${detail}`.trim() };
  }

  function hours(value) {
    const number = Number(value || 0);
    return `${number.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`;
  }

  function numberText(value) {
    return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function slug(value) {
    return String(value || 'export')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function nextId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function getPerson(personId) {
    return db.people.find(person => person.id === personId);
  }

  function getTask(taskId) {
    return db.tasks.find(task => task.id === taskId);
  }

  function activePeople() {
    const week = currentWeek();
    const roster = new Set(week.rosterIds || []);
    const linkedPeople = new Set([...(week.entries || []).map(entry => entry.personId), ...(week.absences || []).map(item => item.personId), ...(week.lates || []).map(item => item.personId)]);
    return db.people.filter(person => roster.has(person.id) || linkedPeople.has(person.id));
  }

  function activeTasks() {
    return db.tasks.filter(task => task.active !== false);
  }

  function isWeekLocked() {
    return Boolean(currentWeek().locked);
  }

  function assertWeekEditable(message = 'Cette semaine est verrouillée. Déverrouillez-la depuis la synthèse pour la modifier.') {
    if (!isWeekLocked()) return true;
    showToast(message, true);
    return false;
  }

  function teamForPerson(personId) {
    return (db.teams || []).filter(team => (team.memberIds || []).includes(personId));
  }

  function previousWeekInfo() {
    const monday = isoWeekMonday(db.currentWeek.year, db.currentWeek.week);
    monday.setUTCDate(monday.getUTCDate() - 7);
    return getIsoWeekInfo(monday);
  }

  function personEntries(personId, day = null) {
    return currentWeek().entries.filter(entry => entry.personId === personId && (day === null || entry.day === day));
  }

  function personAbsence(personId, day) {
    return currentWeek().absences.find(item => item.personId === personId && item.day === day) || null;
  }

  function personLate(personId, day) {
    return (currentWeek().lates || []).find(item => item.personId === personId && item.day === day) || null;
  }

  function personDayTotal(personId, day) {
    return personEntries(personId, day).reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  }

  function personWeekTotal(personId) {
    return personEntries(personId).reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  }

  function personTarget(person, day) {
    return Number(person?.schedule?.[day] || 0);
  }

  function getDayStatus(person, day) {
    const total = personDayTotal(person.id, day);
    const target = personTarget(person, day);
    const absence = personAbsence(person.id, day);
    const late = personLate(person.id, day);
    if (absence && total > 0) return { key: 'conflict', label: 'Absence + heures', total, target, absence, late };
    if (absence) return { key: 'absence', label: absence.code, total, target, absence, late: null };
    if (total <= 0) return { key: 'empty', label: 'Non saisi', total, target, absence: null, late };
    if (late) {
      const difference = target > 0 ? target - total : 0;
      const label = difference > 0.01 ? `Retard · -${numberText(difference)} h` : 'Retard signalé';
      return { key: 'late', label, total, target, absence: null, late };
    }
    if (target <= 0 || Math.abs(total - target) < 0.01) return { key: 'complete', label: 'Complet', total, target, absence: null, late: null };
    if (total < target) return { key: 'under', label: `${numberText(target - total)} h manquante(s)`, total, target, absence: null, late: null };
    return { key: 'over', label: `+ ${numberText(total - target)} h`, total, target, absence: null, late: null };
  }

  function weekTotals() {
    const entries = currentWeek().entries;
    const total = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
    const gccIds = new Set(db.people.filter(p => p.type === 'GCC').map(p => p.id));
    const interimIds = new Set(db.people.filter(p => p.type === 'Intérim').map(p => p.id));
    const loanIds = new Set(db.people.filter(p => p.type === 'Prêt de MO').map(p => p.id));
    const sumFor = ids => entries.filter(e => ids.has(e.personId)).reduce((sum, e) => sum + Number(e.hours || 0), 0);
    return { total, gcc: sumFor(gccIds), interim: sumFor(interimIds), loan: sumFor(loanIds) };
  }

  function dayTotal(day) {
    return currentWeek().entries.filter(entry => entry.day === day).reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  }

  function setView(view) {
    ui.view = view;
    document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
    const navView = ['semaine', 'exports'].includes(view) ? 'outils' : view;
    document.querySelectorAll('.main-nav [data-view], .bottom-nav [data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === navView));
    if (view === 'semaine') renderWeek();
    if (view === 'personnel') renderPersonnel();
    if (view === 'contrats') renderContracts();
    if (view === 'taches') renderTasks();
    if (view === 'exports') renderExports();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAll() {
    renderHeader();
    renderPointage();
    renderWeek();
    renderPersonnel();
    renderContracts();
    renderTasks();
    renderExports();
  }

  function renderHeader() {
    const week = currentWeek();
    document.getElementById('header-project-name').textContent = db.project.name || 'Chantier';
    document.getElementById('header-project-code').textContent = db.project.code || '';
    document.getElementById('header-week').textContent = `S${db.currentWeek.week} · ${db.currentWeek.year}${week.locked ? ' · Verrouillée' : ''}`;
    document.getElementById('header-week-dates').textContent = formatWeekRange();
  }

  function projectTotalHours(project) {
    return Object.values(project.weeks || {}).reduce((sum, week) => sum + (week.entries || []).reduce((sub, entry) => sub + Number(entry.hours || 0), 0), 0);
  }

  function projectLastActivity(project) {
    const raw = project.project.updatedAt || project.project.createdAt;
    if (!raw) return 'Aucune activité';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Aucune activité';
    return `Modifié le ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  }

  function renderProjectHome() {
    const projects = [...store.projects].sort((a, b) => String(b.project.updatedAt || '').localeCompare(String(a.project.updatedAt || '')));
    const totalPeople = projects.reduce((sum, project) => sum + project.people.filter(person => person.active !== false).length, 0);
    const totalHours = projects.reduce((sum, project) => sum + projectTotalHours(project), 0);
    document.getElementById('project-home-stats').innerHTML = [
      `<div><strong>${projects.length}</strong><span>chantier${projects.length > 1 ? 's' : ''}</span></div>`,
      `<div><strong>${totalPeople}</strong><span>personnes actives</span></div>`,
      `<div><strong>${hours(totalHours)}</strong><span>pointées au total</span></div>`
    ].join('');

    const list = document.getElementById('project-list');
    if (!projects.length) {
      list.innerHTML = `<article class="empty-project-card"><span class="empty-project-icon">＋</span><h2>Aucun chantier créé</h2><p>Créez votre premier chantier pour ajouter le personnel, les tâches et commencer les pointages.</p><button type="button" class="button primary" data-create-project>Créer un chantier</button></article>`;
      return;
    }
    list.innerHTML = projects.map(project => {
      const weekCount = Object.keys(project.weeks || {}).length;
      const total = projectTotalHours(project);
      const activeCount = project.people.filter(person => person.active !== false).length;
      return `<article class="project-card" data-project-card="${escapeHtml(project.project.id)}">
        <div class="project-card-accent"></div>
        <div class="project-card-head">
          <div><span class="eyebrow">${escapeHtml(project.project.code || 'Chantier')}</span><h2>${escapeHtml(project.project.name)}</h2></div>
          <div class="project-card-menu">
            <button type="button" class="icon-button" data-edit-project="${escapeHtml(project.project.id)}" aria-label="Modifier le chantier" title="Modifier">✎</button>
            <button type="button" class="icon-button delete-project-button" data-delete-project="${escapeHtml(project.project.id)}" aria-label="Supprimer le chantier" title="Supprimer">×</button>
          </div>
        </div>
        <p class="project-management">${escapeHtml(project.project.management || 'Encadrement non renseigné')}</p>
        <div class="project-card-stats">
          <div><strong>${activeCount}</strong><span>personne${activeCount > 1 ? 's' : ''}</span></div>
          <div><strong>${weekCount}</strong><span>semaine${weekCount > 1 ? 's' : ''}</span></div>
          <div><strong>${hours(total)}</strong><span>ventilées</span></div>
        </div>
        <div class="project-card-footer"><small>${projectLastActivity(project)}</small><button type="button" class="button primary" data-open-project="${escapeHtml(project.project.id)}">Ouvrir le chantier</button></div>
      </article>`;
    }).join('');
  }

  function showProjectHome() {
    if (db) saveDatabase();
    db = null;
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    document.getElementById('app').hidden = true;
    document.getElementById('project-home').hidden = false;
    renderProjectHome();
    window.scrollTo({ top: 0 });
  }

  function openProject(projectId) {
    const project = store.projects.find(item => item.project.id === projectId);
    if (!project) return;
    db = project;
    ui.view = 'pointage';
    ui.day = 0;
    ui.peopleSearch = '';
    ui.personnelSearch = '';
    ui.personnelSelectionMode = false;
    ui.selectedPersonnel.clear();
    ui.taskSearch = '';
    ui.contractSearch = '';
    ui.contractStatusFilter = 'all';
    ui.teamFilter = 'all';
    ui.rosterSearch = '';
    ui.selectionMode = false;
    ui.selectedPeople.clear();
    ensureCurrentWeek();
    document.getElementById('project-home').hidden = true;
    document.getElementById('app').hidden = false;
    renderAll();
    setView('pointage');
    window.setTimeout(() => showDeviceReminderIfNeeded(false), 500);
  }

  function openProjectDialog(projectId = '') {
    const project = projectId ? store.projects.find(item => item.project.id === projectId) : null;
    document.getElementById('project-dialog-title').textContent = project ? 'Modifier le chantier' : 'Nouveau chantier';
    document.getElementById('project-dialog-id').value = project?.project.id || '';
    document.getElementById('new-project-name').value = project?.project.name || '';
    document.getElementById('new-project-code').value = project?.project.code || '';
    document.getElementById('new-project-management').value = project?.project.management || '';
    document.getElementById('new-project-zone').value = project?.project.defaultZone || '';
    document.getElementById('project-dialog').showModal();
    window.setTimeout(() => document.getElementById('new-project-name').focus(), 30);
  }

  function saveProjectFromDialog(event) {
    event.preventDefault();
    const id = document.getElementById('project-dialog-id').value;
    const meta = {
      name: document.getElementById('new-project-name').value.trim() || 'Chantier',
      code: document.getElementById('new-project-code').value.trim(),
      management: document.getElementById('new-project-management').value.trim(),
      defaultZone: document.getElementById('new-project-zone').value.trim()
    };
    if (id) {
      const project = store.projects.find(item => item.project.id === id);
      if (!project) return;
      Object.assign(project.project, meta, { updatedAt: new Date().toISOString() });
      saveStore();
      document.getElementById('project-dialog').close();
      renderProjectHome();
      showToast('Chantier modifié.');
      return;
    }
    const project = createProjectData(meta);
    store.projects.push(project);
    saveStore();
    document.getElementById('project-dialog').close();
    openProject(project.project.id);
    showToast('Chantier créé.');
  }

  function deleteProject(projectId) {
    const project = store.projects.find(item => item.project.id === projectId);
    if (!project) return;
    const total = projectTotalHours(project);
    const detail = total > 0 ? ` Il contient ${hours(total)} de pointages.` : '';
    if (!window.confirm(`Supprimer définitivement le chantier « ${project.project.name} » ?${detail}`)) return;
    store.projects = store.projects.filter(item => item.project.id !== projectId);
    saveStore();
    renderProjectHome();
    showToast('Chantier supprimé.');
  }

  function renderDayTabs() {
    const container = document.getElementById('day-tabs');
    container.innerHTML = DAY_NAMES.map((name, day) => {
      const date = dateForDay(day);
      return `
        <button type="button" class="day-tab ${ui.day === day ? 'active' : ''}" data-day="${day}" role="tab" aria-selected="${ui.day === day}">
          <span>
            <span class="day-name"><span class="day-name-long">${name}</span><span class="day-name-short">${DAY_SHORT[day].replace('.', '')}</span></span>
            <span class="day-date"><span class="day-date-long">${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}</span><span class="day-date-short">${date.getUTCDate()}</span></span>
          </span>
          <span class="day-total">${hours(dayTotal(day))}</span>
        </button>`;
    }).join('');
  }

  function renderDailyStats() {
    const people = activePeople();
    const statuses = people.map(person => getDayStatus(person, ui.day));
    const present = statuses.filter(status => status.total > 0).length;
    const complete = statuses.filter(status => ['complete', 'over', 'absence', 'late'].includes(status.key)).length;
    const toCheck = statuses.filter(status => ['under', 'empty', 'conflict'].includes(status.key)).length;
    const total = dayTotal(ui.day);
    document.getElementById('daily-stats').innerHTML = [
      statCard('Heures ventilées', hours(total), `${DAY_NAMES[ui.day]} ${formatDate(dateForDay(ui.day))}`, 'info'),
      statCard('Personnes pointées', String(present), `sur ${people.length} personne(s) suivie(s)`, 'success'),
      statCard('Journées cohérentes', String(complete), 'horaires ou absences renseignés', 'success'),
      statCard('À vérifier', String(toCheck), toCheck ? 'saisie manquante ou incomplète' : 'aucune anomalie', toCheck ? 'warning' : 'success')
    ].join('');
  }

  function statCard(label, value, subtext, mark = '') {
    return `<article class="stat-card"><div><span class="stat-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(subtext)}</small></div><span class="stat-mark ${mark}"></span></article>`;
  }

  function renderWeekLockBanner() {
    const banner = document.getElementById('week-lock-banner');
    const week = currentWeek();
    banner.hidden = !week.locked;
    const rosterButton = document.getElementById('manage-week-roster');
    const rosterPersonnelButton = document.getElementById('manage-week-roster-personnel');
    if (rosterButton) rosterButton.disabled = week.locked;
    if (rosterPersonnelButton) rosterPersonnelButton.disabled = week.locked;
    if (!week.locked) return;
    const lockedDate = week.lockedAt ? new Date(week.lockedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    banner.innerHTML = `<div><strong>Semaine verrouillée</strong><span>Les pointages sont en lecture seule${lockedDate ? ` depuis le ${escapeHtml(lockedDate)}` : ''}.</span></div><button type="button" class="button ghost small" data-unlock-week>Déverrouiller</button>`;
  }

  function renderTeamFilter() {
    const select = document.getElementById('team-filter');
    const teams = db.teams || [];
    if (ui.teamFilter !== 'all' && !teams.some(team => team.id === ui.teamFilter)) ui.teamFilter = 'all';
    select.innerHTML = `<option value="all">Toutes les équipes</option>` + teams.map(team => `<option value="${escapeHtml(team.id)}" ${ui.teamFilter === team.id ? 'selected' : ''}>${escapeHtml(team.name)}</option>`).join('');
    document.getElementById('select-filtered-team').hidden = ui.teamFilter === 'all';
  }

  function pointageIsPending(status) {
    return ['empty', 'under', 'conflict'].includes(status.key);
  }

  function pointageFilteredPeople({ applyMobileStatus = true } = {}) {
    const search = ui.peopleSearch.trim().toLocaleLowerCase('fr');
    const selectedTeam = ui.teamFilter === 'all' ? null : (db.teams || []).find(team => team.id === ui.teamFilter);
    const teamMembers = selectedTeam ? new Set(selectedTeam.memberIds || []) : null;
    return activePeople().filter(person => {
      if (ui.typeFilter !== 'all' && person.type !== ui.typeFilter) return false;
      if (teamMembers && !teamMembers.has(person.id)) return false;
      if (search && ![person.name, person.company, person.zone, ...teamForPerson(person.id).map(team => team.name)].some(value => String(value || '').toLocaleLowerCase('fr').includes(search))) return false;
      if (applyMobileStatus && window.matchMedia?.('(max-width: 680px)').matches && ui.mobilePointageFilter === 'todo' && !pointageIsPending(getDayStatus(person, ui.day))) return false;
      return true;
    }).sort((a, b) => {
      const aPending = pointageIsPending(getDayStatus(a, ui.day)) ? 0 : 1;
      const bPending = pointageIsPending(getDayStatus(b, ui.day)) ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' });
    });
  }

  function renderMobilePointageSummary() {
    const container = document.getElementById('mobile-pointage-summary');
    if (!container) return;
    const people = activePeople();
    const statuses = people.map(person => getDayStatus(person, ui.day));
    const pending = statuses.filter(pointageIsPending).length;
    const done = Math.max(0, people.length - pending);
    const percent = people.length ? Math.round(done / people.length * 100) : 0;
    const allDone = people.length > 0 && pending === 0;
    container.innerHTML = `
      <div class="mobile-progress-card ${allDone ? 'done' : ''}">
        <div class="mobile-progress-head">
          <div><span class="eyebrow">${DAY_NAMES[ui.day]} ${formatDate(dateForDay(ui.day))}</span><strong>${allDone ? 'Journée pointée ✓' : `${pending} à pointer`}</strong><small>${done} / ${people.length} personne(s) renseignée(s) · ${hours(dayTotal(ui.day))}</small></div>
          <span class="mobile-progress-percent">${percent}%</span>
        </div>
        <div class="mobile-progress-track"><span style="width:${percent}%"></span></div>
        <div class="mobile-pointage-quickfilters">
          <button type="button" class="mobile-quick-filter ${ui.mobilePointageFilter === 'todo' ? 'active' : ''}" data-mobile-pointage-filter="todo">À pointer <b>${pending}</b></button>
          <button type="button" class="mobile-quick-filter ${ui.mobilePointageFilter === 'all' ? 'active' : ''}" data-mobile-pointage-filter="all">Tout le monde <b>${people.length}</b></button>
          <button type="button" class="mobile-filter-toggle ${ui.mobileFiltersOpen ? 'active' : ''}" data-mobile-toggle-filters aria-expanded="${ui.mobileFiltersOpen}">Filtres</button>
        </div>
      </div>`;
    const toolbar = document.querySelector('#view-pointage .toolbar');
    if (toolbar) toolbar.classList.toggle('mobile-open', ui.mobileFiltersOpen);
  }

  function nextPendingPerson(currentPersonId, day) {
    const candidates = pointageFilteredPeople({ applyMobileStatus: false });
    if (!candidates.length) return null;
    const currentIndex = candidates.findIndex(person => person.id === currentPersonId);
    const ordered = currentIndex >= 0 ? candidates.slice(currentIndex + 1).concat(candidates.slice(0, currentIndex)) : candidates;
    return ordered.find(person => person.id !== currentPersonId && pointageIsPending(getDayStatus(person, day))) || null;
  }

  function renderPointage() {
    renderDayTabs();
    renderDailyStats();
    renderWeekLockBanner();
    renderTeamFilter();
    renderMobilePointageSummary();
    const people = pointageFilteredPeople();

    const grid = document.getElementById('people-grid');
    if (!people.length) {
      const advancedFilterActive = Boolean(ui.peopleSearch.trim()) || ui.typeFilter !== 'all' || ui.teamFilter !== 'all';
      if (ui.mobilePointageFilter === 'todo' && !advancedFilterActive && activePeople().length) {
        grid.innerHTML = `<div class="empty-state panel mobile-all-done"><strong>Tout le monde est pointé ✓</strong>Aucune saisie à compléter pour ${escapeHtml(DAY_NAMES[ui.day].toLowerCase())}.<button type="button" class="button ghost small" data-show-all-pointages>Afficher tout le monde</button></div>`;
      } else {
        grid.innerHTML = db.people.length ? `<div class="empty-state panel"><strong>Aucun résultat</strong>Modifiez la recherche, l’équipe ou le filtre.</div>` : `<div class="empty-state panel"><strong>Aucune personne enregistrée</strong>Ajoutez d’abord les salariés GCC et les intérimaires depuis l’onglet Personnel.</div>`;
      }
    } else {
      grid.innerHTML = people.map(person => personCard(person)).join('');
    }

    const empty = currentWeek().entries.length === 0 && currentWeek().absences.length === 0;
    document.getElementById('empty-week-banner').hidden = !empty;
    document.getElementById('toggle-selection').textContent = ui.selectionMode ? 'Quitter la sélection' : 'Sélection multiple';
    document.getElementById('toggle-selection').disabled = isWeekLocked();
    document.getElementById('copy-day').disabled = isWeekLocked();
    document.getElementById('add-person-from-pointage').disabled = false;
    renderBulkBar();
  }

  function personCard(person) {
    const status = getDayStatus(person, ui.day);
    const selected = ui.selectedPeople.has(person.id);
    const typeClass = person.type === 'GCC' ? 'gcc' : (person.type === 'Prêt de MO' ? 'loan' : 'interim');
    const targetText = status.target > 0 ? `sur ${numberText(status.target)} h` : 'sans horaire cible';
    const teams = teamForPerson(person.id);
    return `
      <article class="person-card status-${status.key} ${selected ? 'selected' : ''} ${isWeekLocked() ? 'read-only' : ''}" data-person-id="${escapeHtml(person.id)}">
        <div class="person-card-main">
          ${ui.selectionMode && !isWeekLocked() ? `<label class="selection-check"><input type="checkbox" data-select-person="${escapeHtml(person.id)}" ${selected ? 'checked' : ''} aria-label="Sélectionner ${escapeHtml(person.name)}"></label>` : '<span></span>'}
          <div class="person-identity">
            <strong title="${escapeHtml(person.name)}">${escapeHtml(person.name)}</strong>
            <div class="person-meta">
              <span class="badge ${typeClass}">${escapeHtml(person.type)}</span>
              <span>${escapeHtml(person.company || 'Sans entreprise')}</span>
              ${person.active === false ? '<span class="badge inactive-badge">Inactive</span>' : ''}
              ${person.zone ? `<span>• ${escapeHtml(person.zone)}</span>` : ''}
              ${teams.map(team => `<span class="badge team-badge">${escapeHtml(team.name)}</span>`).join('')}
            </div>
          </div>
          <div class="person-hours"><strong>${numberText(status.total)}</strong><small>${targetText}</small></div>
        </div>
        <div class="person-status">
          <span class="status-pill ${status.key}">${escapeHtml(status.label)}</span>
          <button type="button" class="card-action" data-edit-pointage="${escapeHtml(person.id)}"><span class="desktop-card-action">${isWeekLocked() ? 'Consulter' : 'Modifier'}</span><span class="mobile-card-action">${isWeekLocked() ? 'Voir' : status.key === 'empty' ? 'Pointer' : status.key === 'under' || status.key === 'conflict' ? 'Compléter' : `${numberText(status.total)} h ✓`}</span></button>
        </div>
      </article>`;
  }

  function renderBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const count = ui.selectedPeople.size;
    bar.hidden = isWeekLocked() || !ui.selectionMode || count === 0;
    document.getElementById('bulk-count').textContent = String(count);
  }

  function renderWeek() {
    const people = activePeople();
    const totals = weekTotals();
    const alerts = collectAlerts();
    const blockingAlerts = alerts.filter(alert => alert.blocking !== false);
    const week = currentWeek();
    document.getElementById('week-status-panel').innerHTML = `<div class="week-status-card ${week.locked ? 'locked' : 'draft'}"><div><span class="status-dot"></span><strong>${week.locked ? 'Semaine validée et verrouillée' : 'Semaine en brouillon'}</strong><small>${week.locked ? 'Les saisies sont protégées contre les modifications accidentelles.' : `${blockingAlerts.length} anomalie(s) bloquante(s) avant validation.`}</small></div><button type="button" class="button ${week.locked ? 'ghost' : 'secondary'} small" data-toggle-week-lock>${week.locked ? 'Déverrouiller' : 'Valider la semaine'}</button></div>`;
    const lockButton = document.getElementById('toggle-week-lock');
    lockButton.textContent = week.locked ? 'Déverrouiller' : 'Valider et verrouiller';
    lockButton.classList.toggle('primary', !week.locked && blockingAlerts.length === 0);
    document.getElementById('copy-previous-week').disabled = week.locked;
    document.getElementById('week-stats').innerHTML = [
      statCard('Total semaine', hours(totals.total), `${people.filter(p => personWeekTotal(p.id) > 0).length} personne(s) pointée(s)`, 'info'),
      statCard('Heures GCC', hours(totals.gcc), `${totals.total ? Math.round(totals.gcc / totals.total * 100) : 0} % du total`, 'success'),
      statCard('Heures intérim', hours(totals.interim), `${totals.total ? Math.round(totals.interim / totals.total * 100) : 0} % du total`, 'warning'),
      ...(totals.loan ? [statCard('Prêt de MO', hours(totals.loan), `${totals.total ? Math.round(totals.loan / totals.total * 100) : 0} % du total`, 'info')] : []),
      statCard('Points à vérifier', String(alerts.length), alerts.length ? `${blockingAlerts.length} bloquant(s)` : 'semaine cohérente', alerts.length ? 'warning' : 'success')
    ].join('');

    document.getElementById('week-table-head').innerHTML = `
      <tr><th>Personnel</th>${DAY_NAMES.map((day, index) => `<th>${DAY_SHORT[index]}<br><small>${dateForDay(index).getUTCDate()} ${MONTHS[dateForDay(index).getUTCMonth()].slice(0, 4)}.</small></th>`).join('')}<th>Total</th></tr>`;

    document.getElementById('week-table-body').innerHTML = people.map(person => {
      const typeClass = person.type === 'GCC' ? 'gcc' : (person.type === 'Prêt de MO' ? 'loan' : 'interim');
      const teamNames = teamForPerson(person.id).map(team => team.name).join(', ');
      const cells = DAY_NAMES.map((_, day) => {
        const status = getDayStatus(person, day);
        const text = status.key === 'absence' ? status.label : (status.total ? numberText(status.total) : '—');
        return `<td><button type="button" class="week-cell-button ${status.key}" data-week-person="${escapeHtml(person.id)}" data-week-day="${day}" title="${escapeHtml(status.label)}">${escapeHtml(text)}</button></td>`;
      }).join('');
      return `<tr><td><div class="person-cell"><strong>${escapeHtml(person.name)}</strong><small><span class="badge ${typeClass}">${escapeHtml(person.type)}</span> ${escapeHtml(person.company || '')}${person.zone ? ` · ${escapeHtml(person.zone)}` : ''}${teamNames ? ` · ${escapeHtml(teamNames)}` : ''}</small></div></td>${cells}<td><strong>${numberText(personWeekTotal(person.id))}</strong></td></tr>`;
    }).join('');

    document.getElementById('week-table-foot').innerHTML = `<tr><td>Total journalier</td>${DAY_NAMES.map((_, day) => `<td>${numberText(dayTotal(day))}</td>`).join('')}<td>${numberText(totals.total)}</td></tr>`;
    renderTaskSummary();
    renderAlerts(alerts);
  }

  function collectAlerts() {
    const alerts = [];
    activePeople().forEach(person => {
      DAY_NAMES.forEach((dayName, day) => {
        const status = getDayStatus(person, day);
        if (status.key === 'empty' && status.target > 0) {
          alerts.push({ level: 'warning', blocking: true, person, day, title: `${person.name} · ${DAY_SHORT[day]}`, detail: `Aucune heure ni absence renseignée (cible ${numberText(status.target)} h).` });
        } else if (status.key === 'under') {
          alerts.push({ level: 'warning', blocking: true, person, day, title: `${person.name} · ${DAY_SHORT[day]}`, detail: `${numberText(status.total)} h saisies sur ${numberText(status.target)} h théoriques.` });
        } else if (status.key === 'conflict') {
          alerts.push({ level: 'danger', blocking: true, person, day, title: `${person.name} · ${DAY_SHORT[day]}`, detail: 'Une absence et des heures sont renseignées simultanément.' });
        } else if (status.key === 'over') {
          alerts.push({ level: 'info', blocking: false, person, day, title: `${person.name} · ${DAY_SHORT[day]}`, detail: `${numberText(status.total)} h saisies, soit ${numberText(status.total - status.target)} h au-dessus de l’horaire théorique.` });
        }
      });
    });
    return alerts;
  }

  function renderTaskSummary() {
    const totals = new Map();
    currentWeek().entries.forEach(entry => totals.set(entry.taskId, (totals.get(entry.taskId) || 0) + Number(entry.hours || 0)));
    const rows = [...totals.entries()]
      .map(([taskId, total]) => ({ task: getTask(taskId), total }))
      .filter(item => item.task && item.total > 0)
      .sort((a, b) => b.total - a.total);
    const maximum = rows[0]?.total || 1;
    document.getElementById('task-summary').innerHTML = rows.length ? rows.map(item => `
      <div class="task-summary-row">
        <span title="${escapeHtml(item.task.name)}">${escapeHtml(item.task.name)}</span>
        <div class="task-bar"><i style="width:${Math.max(2, item.total / maximum * 100)}%"></i></div>
        <strong>${hours(item.total)}</strong>
      </div>`).join('') : '<div class="empty-state"><strong>Aucune heure saisie</strong>La répartition apparaîtra ici.</div>';
  }

  function renderAlerts(alerts) {
    const list = document.getElementById('alerts-list');
    if (!alerts.length) {
      list.innerHTML = '<div class="alert-item success"><strong>Aucune anomalie détectée</strong><span>Les horaires et absences sont cohérents.</span></div>';
      return;
    }
    list.innerHTML = alerts.slice(0, 14).map(alert => `<button type="button" class="alert-item ${alert.level}" data-alert-person="${escapeHtml(alert.person.id)}" data-alert-day="${alert.day}" style="border:0;text-align:left;width:100%;cursor:pointer"><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.detail)}</span></button>`).join('') + (alerts.length > 14 ? `<div class="alert-item"><strong>+ ${alerts.length - 14} autre(s) point(s)</strong><span>Consultez le tableau pour les corriger.</span></div>` : '');
  }

  function filteredPersonnel() {
    const search = ui.personnelSearch.trim().toLocaleLowerCase('fr');
    return db.people.filter(person => {
      if (!ui.showInactivePeople && person.active === false) return false;
      if (!search) return true;
      return [person.name, person.company, person.zone, person.type].some(value => String(value || '').toLocaleLowerCase('fr').includes(search));
    });
  }

  function renderPersonnelSelectionControls(people) {
    const toggle = document.getElementById('toggle-personnel-selection');
    const actions = document.getElementById('personnel-bulk-actions');
    const count = document.getElementById('personnel-selection-count');
    const selectAll = document.getElementById('select-all-personnel');
    const selectedVisible = people.filter(person => ui.selectedPersonnel.has(person.id));
    const selectedCount = ui.selectedPersonnel.size;
    toggle.classList.toggle('active-selection', ui.personnelSelectionMode);
    toggle.textContent = ui.personnelSelectionMode ? 'Terminer la sélection' : 'Sélection rapide';
    actions.hidden = !ui.personnelSelectionMode;
    count.textContent = `${selectedCount} sélectionnée${selectedCount > 1 ? 's' : ''}`;
    selectAll.checked = people.length > 0 && selectedVisible.length === people.length;
    selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < people.length;
    document.getElementById('bulk-deactivate-personnel').disabled = selectedCount === 0;
    document.getElementById('bulk-activate-personnel').disabled = selectedCount === 0;
  }

  function renderPersonnel() {
    const people = filteredPersonnel();
    const validIds = new Set(db.people.map(person => person.id));
    ui.selectedPersonnel.forEach(id => { if (!validIds.has(id)) ui.selectedPersonnel.delete(id); });
    const list = document.getElementById('personnel-list');
    list.innerHTML = people.length ? people.map(person => {
      const teams = teamForPerson(person.id);
      const inRoster = (currentWeek().rosterIds || []).includes(person.id);
      return `
      <div class="management-row personnel-management-row ${person.active === false ? 'inactive' : ''} ${ui.selectedPersonnel.has(person.id) ? 'selected-row' : ''}">
        <div class="person-identity">
          ${ui.personnelSelectionMode ? `<label class="person-select" title="Sélectionner ${escapeHtml(person.name)}"><input type="checkbox" data-select-personnel="${escapeHtml(person.id)}" ${ui.selectedPersonnel.has(person.id) ? 'checked' : ''}><span></span></label>` : ''}
          <div><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.type)} · ${escapeHtml(person.company || 'Sans entreprise')}</small><span class="person-status ${person.active === false ? 'inactive-status' : ''}">${person.active === false ? 'Inactive' : 'Active'}</span>${inRoster ? '<span class="person-status roster-status">Présent Semaine</span>' : ''}</div>
        </div>
        <div><strong>${escapeHtml(person.zone || '—')}</strong><small>${teams.length ? escapeHtml(teams.map(team => team.name).join(', ')) : 'Aucune équipe'}</small></div>
        <div><strong>${hours(personWeekTotal(person.id))}</strong><small>Semaine ouverte</small></div>
        <div class="schedule-mini">${DAY_SHORT.map((day, index) => `<span title="${day}">${numberText(personTarget(person, index))}</span>`).join('')}</div>
        <div class="row-actions">${person.type === 'Intérim' ? `<button type="button" data-open-contract-person="${escapeHtml(person.id)}">Contrat</button>` : ''}<button type="button" data-toggle-person-active="${escapeHtml(person.id)}">${person.active === false ? 'Réactiver' : 'Désactiver'}</button><button type="button" data-edit-person="${escapeHtml(person.id)}">Modifier</button><button type="button" class="delete-action" data-delete-person="${escapeHtml(person.id)}">Supprimer</button></div>
      </div>`;
    }).join('') : '<div class="empty-state"><strong>Aucune personne trouvée</strong>Ajoutez une personne ou modifiez la recherche.</div>';
    renderPersonnelSelectionControls(people);
    renderRosterSummary();
    renderTeams();
  }

  function setPeopleActive(personIds, active) {
    const ids = new Set(personIds);
    let changed = 0;
    db.people.forEach(person => {
      if (ids.has(person.id) && person.active !== active) {
        person.active = active;
        changed += 1;
      }
    });
    if (!changed) {
      showToast(active ? 'Les personnes sélectionnées sont déjà actives.' : 'Les personnes sélectionnées sont déjà inactives.');
      return;
    }
    saveDatabase();
    ui.selectedPersonnel.clear();
    renderPointage();
    renderWeek();
    renderPersonnel();
    showToast(`${changed} ${changed > 1 ? 'personnes' : 'personne'} ${active ? (changed > 1 ? 'réactivées' : 'réactivée') : (changed > 1 ? 'rendues inactives' : 'rendue inactive')}.`);
  }

  function renderRosterSummary() {
    const rosterIds = new Set(currentWeek().rosterIds || []);
    const rosterPeople = db.people.filter(person => rosterIds.has(person.id));
    const gcc = rosterPeople.filter(person => person.type === 'GCC').length;
    const interim = rosterPeople.filter(person => person.type === 'Intérim').length;
    const loan = rosterPeople.filter(person => person.type === 'Prêt de MO').length;
    const target = rosterPeople.reduce((sum, person) => sum + DAY_NAMES.reduce((sub, _, day) => sub + personTarget(person, day), 0), 0);
    document.getElementById('roster-summary').innerHTML = rosterPeople.length ? `<div class="roster-stat"><strong>${rosterPeople.length}</strong><span>présents</span></div><div class="roster-stat"><strong>${gcc}</strong><span>GCC</span></div><div class="roster-stat"><strong>${interim}</strong><span>intérim</span></div>${loan ? `<div class="roster-stat"><strong>${loan}</strong><span>prêt MO</span></div>` : ''}<div class="roster-stat"><strong>${hours(target)}</strong><span>cible semaine</span></div>` : '<div class="empty-state small-empty"><strong>Aucun présent sélectionné</strong>Choisissez l’équipe de la semaine avant le pointage.</div>';
  }

  function renderTeams() {
    const list = document.getElementById('team-list');
    const teams = db.teams || [];
    list.innerHTML = teams.length ? teams.map(team => {
      const members = (team.memberIds || []).map(getPerson).filter(Boolean);
      const activeMembers = members.filter(person => person.active !== false);
      return `<div class="team-row"><div><strong>${escapeHtml(team.name)}</strong><small>${activeMembers.length} membre(s) actif(s) · ${members.map(person => person.name).slice(0, 4).map(escapeHtml).join(', ')}${members.length > 4 ? '…' : ''}</small></div><div class="row-actions"><button type="button" data-point-team="${escapeHtml(team.id)}">Pointer</button><button type="button" data-edit-team="${escapeHtml(team.id)}">Modifier</button><button type="button" class="delete-action" data-delete-team="${escapeHtml(team.id)}">Supprimer</button></div></div>`;
    }).join('') : '<div class="empty-state small-empty"><strong>Aucune équipe créée</strong>Créez par exemple une équipe voiles, plancher ou finitions.</div>';
  }

  function openRosterDialog() {
    ui.rosterSearch = '';
    document.getElementById('roster-search').value = '';
    document.getElementById('roster-dialog-title').textContent = `Présents · S${db.currentWeek.week} ${db.currentWeek.year}`;
    renderRosterDialogList();
    document.getElementById('roster-dialog').showModal();
  }

  function renderRosterDialogList() {
    const query = ui.rosterSearch.trim().toLocaleLowerCase('fr');
    const rosterIds = new Set(currentWeek().rosterIds || []);
    const people = db.people.filter(person => person.active !== false || rosterIds.has(person.id)).filter(person => !query || [person.name, person.company, person.zone].some(value => String(value || '').toLocaleLowerCase('fr').includes(query)));
    document.getElementById('roster-list').innerHTML = people.length ? people.map(person => `<label class="roster-person ${person.active === false ? 'inactive' : ''}"><input type="checkbox" value="${escapeHtml(person.id)}" ${rosterIds.has(person.id) ? 'checked' : ''}><span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.type)} · ${escapeHtml(person.company || '')}${person.zone ? ` · ${escapeHtml(person.zone)}` : ''}${person.active === false ? ' · inactive' : ''}</small></span></label>`).join('') : '<div class="empty-state"><strong>Aucune personne trouvée</strong></div>';
  }

  function saveRoster(event) {
    event.preventDefault();
    if (!assertWeekEditable('La liste des présents ne peut pas être modifiée sur une semaine verrouillée.')) return;
    const checked = [...document.querySelectorAll('#roster-list input[type="checkbox"]:checked')].map(input => input.value);
    const linked = new Set([...currentWeek().entries.map(entry => entry.personId), ...currentWeek().absences.map(item => item.personId), ...(currentWeek().lates || []).map(item => item.personId)]);
    linked.forEach(id => { if (!checked.includes(id)) checked.push(id); });
    currentWeek().rosterIds = checked;
    saveDatabase();
    document.getElementById('roster-dialog').close();
    renderAll();
    showToast('Présents de la semaine enregistrés.');
  }

  function openTeamDialog(teamId = '') {
    const team = (db.teams || []).find(item => item.id === teamId);
    document.getElementById('team-dialog-title').textContent = team ? 'Modifier l’équipe' : 'Créer une équipe';
    document.getElementById('team-id').value = team?.id || '';
    document.getElementById('team-name').value = team?.name || '';
    const selected = new Set(team?.memberIds || []);
    const people = db.people.filter(person => person.active !== false || selected.has(person.id));
    document.getElementById('team-member-list').innerHTML = people.length ? people.map(person => `<label class="roster-person"><input type="checkbox" value="${escapeHtml(person.id)}" ${selected.has(person.id) ? 'checked' : ''}><span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.type)} · ${escapeHtml(person.company || '')}</small></span></label>`).join('') : '<div class="empty-state"><strong>Ajoutez d’abord du personnel</strong></div>';
    document.getElementById('team-dialog').showModal();
  }

  function saveTeam(event) {
    event.preventDefault();
    const id = document.getElementById('team-id').value || nextId('team');
    const name = document.getElementById('team-name').value.trim();
    if (!name) { showToast('Le nom de l’équipe est obligatoire.', true); return; }
    const memberIds = [...document.querySelectorAll('#team-member-list input[type="checkbox"]:checked')].map(input => input.value);
    const data = { id, name, memberIds };
    const index = (db.teams || []).findIndex(team => team.id === id);
    if (index >= 0) db.teams[index] = data; else db.teams.push(data);
    saveDatabase();
    document.getElementById('team-dialog').close();
    renderPersonnel();
    renderPointage();
    showToast(index >= 0 ? 'Équipe mise à jour.' : 'Équipe créée.');
  }

  function deleteTeam(teamId) {
    const team = (db.teams || []).find(item => item.id === teamId);
    if (!team) return;
    if (!window.confirm(`Supprimer l’équipe « ${team.name} » ? Aucun personnel ni pointage ne sera supprimé.`)) return;
    db.teams = db.teams.filter(item => item.id !== teamId);
    if (ui.teamFilter === teamId) ui.teamFilter = 'all';
    saveDatabase();
    renderPersonnel();
    renderPointage();
    showToast('Équipe supprimée.');
  }


  function liaisonMeta(contract) {
    const status = contract?.liaison?.status || 'to_send';
    const map = {
      to_send: { label: 'Liaison à envoyer', level: 'warning' },
      sent: { label: 'Liaison envoyée', level: 'info' },
      completed: { label: 'Liaison complétée', level: 'success' },
      validated: { label: 'Liaison validée', level: 'success' }
    };
    return map[status] || map.to_send;
  }

  function liaisonNeedsAttention(contract, referenceDate = todayIso()) {
    if (!contract || contract.closed || !contract.startDate) return false;
    if ((contract.liaison?.status || 'to_send') === 'validated') return false;
    const days = daysBetween(referenceDate, contract.startDate);
    const threshold = Math.max(...(db.contractRules?.arrivalAlertDays || [7, 2]), 0);
    return days <= threshold;
  }

  function contractReminders(referenceDate = todayIso()) {
    if (!db) return [];
    const reminders = [];
    db.people.filter(person => person.type === 'Intérim' && person.active !== false).forEach(person => {
      const contract = latestContractForPerson(person.id);
      if (!contract) {
        reminders.push({ type: 'missing', level: 'danger', person, contract: null, title: `${person.name} · contrat à renseigner`, detail: person.company || 'Agence non renseignée', sort: -100 });
        return;
      }
      const end = contractCurrentEnd(contract);
      const endDays = end ? daysBetween(referenceDate, end) : null;
      const maxEndAlert = Math.max(...(db.contractRules?.alertDays || [21, 14, 7, 2]), 0);
      if (!contract.closed && endDays !== null && endDays <= maxEndAlert) {
        reminders.push({ type: 'end', level: endDays < 0 ? 'danger' : 'warning', person, contract, title: endDays < 0 ? `${person.name} · mission terminée` : `${person.name} · fin dans ${endDays} j`, detail: `${contract.agency || person.company || ''} · ${formatDateIso(end)}`, sort: endDays });
      }
      if (liaisonNeedsAttention(contract, referenceDate)) {
        const startDays = daysBetween(referenceDate, contract.startDate);
        const meta = liaisonMeta(contract);
        reminders.push({ type: 'liaison', level: startDays < 0 ? 'danger' : 'warning', person, contract, title: `${person.name} · ${meta.label.toLowerCase()}`, detail: startDays < 0 ? `Arrivé depuis ${Math.abs(startDays)} j` : startDays === 0 ? 'Arrivée aujourd’hui' : `Arrivée dans ${startDays} j · ${formatDateIso(contract.startDate)}`, sort: startDays - 50 });
      }
    });
    return reminders.sort((a, b) => a.sort - b.sort || a.person.name.localeCompare(b.person.name, 'fr'));
  }

  function renderContractReminderCenter() {
    const host = document.getElementById('contract-reminder-center');
    if (!host) return;
    const reminders = contractReminders();
    const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    if (!reminders.length) {
      host.innerHTML = `<div class="reminder-center ok"><div><strong>Tout est à jour</strong><span>Aucune arrivée ou fin de contrat urgente.</span></div>${permission === 'default' ? '<button type="button" class="button ghost small" id="enable-reminders-inline">Activer les rappels</button>' : ''}</div>`;
      return;
    }
    host.innerHTML = `<div class="reminder-center attention"><div class="reminder-center-head"><div><strong>${reminders.length} rappel${reminders.length > 1 ? 's' : ''}</strong><span>À traiter prochainement</span></div>${permission === 'default' ? '<button type="button" class="button secondary small" id="enable-reminders-inline">Activer les rappels</button>' : ''}</div><div class="reminder-chips">${reminders.slice(0, 4).map(item => `<button type="button" class="reminder-chip ${item.level}" ${item.contract ? `data-reminder-${item.type}="${escapeHtml(item.contract.id)}"` : `data-new-contract-person="${escapeHtml(item.person.id)}"`}><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></button>`).join('')}${reminders.length > 4 ? `<span class="reminder-more">+${reminders.length - 4}</span>` : ''}</div></div>`;
  }

  async function requestDeviceNotifications() {
    if (typeof Notification === 'undefined') { showToast('Les notifications ne sont pas disponibles sur cet appareil.', true); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') { showToast('Notifications activées. Elles seront vérifiées à l’ouverture.'); await showDeviceReminderIfNeeded(true); }
      else showToast('Autorisation de notification non accordée.', true);
      renderContractReminderCenter();
    } catch (error) { console.warn(error); showToast('Impossible d’activer les notifications.', true); }
  }

  async function showDeviceReminderIfNeeded(force = false) {
    if (!db || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const reminders = contractReminders().filter(item => ['end', 'liaison'].includes(item.type));
    if (!reminders.length) return;
    const key = `gcc-pointages-v110-notif-${db.project.id}-${todayIso()}`;
    if (!force && localStorage.getItem(key)) return;
    const body = reminders.slice(0, 3).map(item => item.title).join(' · ');
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration?.showNotification) await registration.showNotification(`Pointages GCC · ${db.project.name}`, { body, icon: 'assets/icon-192.png', badge: 'assets/favicon-32.png', tag: `gcc-${db.project.id}` });
        else new Notification(`Pointages GCC · ${db.project.name}`, { body, icon: 'assets/icon-192.png' });
      } else new Notification(`Pointages GCC · ${db.project.name}`, { body, icon: 'assets/icon-192.png' });
      localStorage.setItem(key, '1');
    } catch (error) { console.warn('Notification locale impossible.', error); }
  }

  function filteredContractRows() {
    const query = ui.contractSearch.trim().toLocaleLowerCase('fr');
    const rows = [];
    const interimPeople = db.people.filter(person => person.type === 'Intérim' && (person.active !== false || ui.showContractHistory));
    interimPeople.forEach(person => {
      const contracts = contractsForPerson(person.id).slice().sort((a, b) => String(contractCurrentEnd(b)).localeCompare(String(contractCurrentEnd(a))));
      if (!contracts.length) {
        rows.push({ person, contract: null, state: contractState(null), historical: false });
        return;
      }
      const visibleContracts = ui.showContractHistory ? contracts : [contracts[0]];
      visibleContracts.forEach((contract, index) => rows.push({ person, contract, state: contractState(contract), historical: index > 0 }));
    });
    return rows.filter(row => {
      const haystack = [row.person.name, row.person.company, row.contract?.agency, row.contract?.position, row.contract?.contractNumber].join(' ').toLocaleLowerCase('fr');
      if (query && !haystack.includes(query)) return false;
      const filter = ui.contractStatusFilter;
      if (filter === 'all') return true;
      if (filter === 'attention') return ['attention', 'expired', 'missing'].includes(row.state.key);
      if (filter === 'liaison') return Boolean(row.contract && liaisonNeedsAttention(row.contract));
      return row.state.key === filter;
    });
  }

  function renderContractStats() {
    const interimPeople = db.people.filter(person => person.type === 'Intérim' && person.active !== false);
    const latestRows = interimPeople.map(person => ({ person, contract: latestContractForPerson(person.id) })).map(row => ({ ...row, state: contractState(row.contract) }));
    const attention = latestRows.filter(row => ['attention', 'expired'].includes(row.state.key)).length;
    const liaison = latestRows.filter(row => row.contract && liaisonNeedsAttention(row.contract)).length;
    const missing = latestRows.filter(row => row.state.key === 'missing').length;
    document.getElementById('contract-stats').innerHTML = [
      `<button type="button" class="contract-summary-card warning" data-contract-filter="attention"><span>Fins à surveiller</span><strong>${attention}</strong><small>renouveler ou vérifier</small></button>`,
      `<button type="button" class="contract-summary-card ${liaison ? 'warning' : 'success'}" data-contract-filter="liaison"><span>Arrivées à préparer</span><strong>${liaison}</strong><small>fiches de liaison</small></button>`,
      `<button type="button" class="contract-summary-card ${missing ? 'danger' : 'success'}" data-contract-filter="missing"><span>Sans contrat</span><strong>${missing}</strong><small>${missing ? 'dossiers à compléter' : 'aucun dossier manquant'}</small></button>`
    ].join('');
  }

  function renderContractRules() {
    const rules = db.contractRules || {};
    document.getElementById('rule-max-renewals').value = rules.maxRenewals ?? 2;
    document.getElementById('rule-max-months').value = rules.maxDurationMonths ?? 18;
    document.getElementById('rule-alert-days').value = (rules.alertDays || [21, 14, 7, 2]).join(', ');
    document.getElementById('rule-arrival-alert-days').value = (rules.arrivalAlertDays || [7, 2]).join(', ');
    document.getElementById('rule-carence-mode').value = rules.carenceMode || 'standard';
    document.getElementById('rule-block-outside').checked = Boolean(rules.blockOutsideContract);
    document.getElementById('rule-exclude-expired').checked = rules.excludeExpiredFromNewWeeks !== false;
  }

  function renderContracts() {
    renderContractStats();
    renderContractRules();
    renderContractReminderCenter();
    const historyButton = document.getElementById('toggle-contract-history');
    if (historyButton) historyButton.textContent = ui.showContractHistory ? 'Masquer l’historique' : 'Voir l’historique';
    const rows = filteredContractRows();
    const list = document.getElementById('contract-list');
    list.innerHTML = rows.length ? rows.map(({ person, contract, state, historical }) => {
      if (!contract) return `<article class="contract-card-simple status-missing">
        <div class="contract-card-main"><div class="contract-avatar">${escapeHtml(person.name.slice(0, 1).toUpperCase())}</div><div><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.company || 'Agence non renseignée')}</small></div></div>
        <div class="contract-deadline"><span class="contract-status warning">Sans contrat</span><small>Dates à renseigner</small></div>
        <button type="button" class="button primary small" data-new-contract-person="${escapeHtml(person.id)}">Créer le contrat</button>
      </article>`;
      const end = contractCurrentEnd(contract);
      const renewalCount = (contract.renewals || []).length;
      const maxRenewals = Number(db.contractRules?.maxRenewals ?? 2);
      const canRenew = !contract.closed && renewalCount < maxRenewals;
      const days = daysBetween(todayIso(), end);
      const deadlineText = state.key === 'upcoming' ? `Débute le ${formatDateIso(contract.startDate)}` : state.key === 'expired' ? `Terminé depuis ${Math.abs(days)} j` : days === 0 ? 'Se termine aujourd’hui' : days > 0 ? `Fin dans ${days} j` : 'Mission terminée';
      const liaison = liaisonMeta(contract);
      return `<article class="contract-card-simple status-${escapeHtml(state.key)} ${historical ? 'historical-contract' : ''}">
        <div class="contract-card-main"><div class="contract-avatar">${escapeHtml(person.name.slice(0, 1).toUpperCase())}</div><div><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(contract.agency || person.company || 'Agence non renseignée')}${contract.position ? ` · ${escapeHtml(contract.position)}` : ''}</small></div></div>
        <div class="contract-period"><span>${formatDateIso(contract.startDate)} → ${formatDateIso(end)}</span><small>${renewalCount ? `${renewalCount}/${maxRenewals} renouvellement${renewalCount > 1 ? 's' : ''}` : 'Contrat initial'} · <b class="liaison-inline-status ${escapeHtml(liaison.level)}">${escapeHtml(liaison.label)}</b>${historical ? ' · Ancienne mission' : ''}</small></div>
        <div class="contract-deadline"><span class="contract-status ${escapeHtml(state.level)}">${escapeHtml(state.label)}</span><small>${escapeHtml(deadlineText)}</small></div>
        <div class="contract-simple-actions">${!historical ? `<button type="button" class="button ${liaisonNeedsAttention(contract) ? 'primary' : 'ghost'} small" data-open-liaison="${escapeHtml(contract.id)}">Liaison</button>` : ''}${canRenew && !historical ? `<button type="button" class="button secondary small" data-renew-contract="${escapeHtml(contract.id)}">Renouveler</button>` : ''}<button type="button" class="button ghost small" data-edit-contract="${escapeHtml(contract.id)}">Détails</button></div>
      </article>`;
    }).join('') : '<div class="empty-state"><strong>Aucun contrat trouvé</strong>Modifiez la recherche ou le filtre.</div>';
  }

  function contractPersonOptions(selectedPersonId = '') {
    const people = db.people.filter(person => person.type === 'Intérim');
    return `<option value="">Choisir un intérimaire…</option>` + people.map(person => `<option value="${escapeHtml(person.id)}" ${person.id === selectedPersonId ? 'selected' : ''}>${escapeHtml(person.name)} · ${escapeHtml(person.company || 'Sans agence')}</option>`).join('');
  }

  function openContractDialog(contractId = '', personId = '') {
    const contract = contractId ? (db.interimContracts || []).find(item => item.id === contractId) : null;
    const selectedPerson = personId || contract?.personId || '';
    document.getElementById('contract-dialog-title').textContent = contract ? 'Détails du contrat' : 'Nouveau contrat';
    document.getElementById('contract-dialog-help').textContent = contract ? 'Modifiez uniquement les informations nécessaires.' : 'Renseignez l’intérimaire, l’agence et les dates.';
    document.getElementById('contract-id').value = contract?.id || '';
    document.getElementById('contract-person').innerHTML = contractPersonOptions(selectedPerson);
    document.getElementById('contract-person').value = selectedPerson;
    document.getElementById('contract-person').disabled = Boolean(contract);
    const person = getPerson(selectedPerson);
    document.getElementById('contract-agency').value = contract?.agency || person?.company || '';
    document.getElementById('contract-number').value = contract?.contractNumber || '';
    document.getElementById('contract-position').value = contract?.position || '';
    document.getElementById('contract-reason').value = contract?.reason || 'Accroissement temporaire';
    document.getElementById('contract-start').value = contract?.startDate || '';
    document.getElementById('contract-initial-end').value = contract?.initialEndDate || '';
    document.getElementById('contract-max-months').value = contract?.maxDurationMonths || '';
    document.getElementById('contract-carence-exempt').checked = Boolean(contract?.carenceExempt);
    document.getElementById('contract-note').value = contract?.note || '';
    document.getElementById('contract-closed').checked = Boolean(contract?.closed);
    const deleteButton = document.getElementById('delete-contract-dialog');
    deleteButton.hidden = !contract;
    deleteButton.dataset.contractId = contract?.id || '';
    const advanced = document.querySelector('#contract-dialog .advanced-contract-details');
    if (advanced) advanced.open = Boolean(contract && (contract.contractNumber || contract.reason !== 'Accroissement temporaire' || contract.maxDurationMonths || contract.carenceExempt || contract.note || contract.closed));
    document.getElementById('contract-dialog').showModal();
  }

  function saveContract(event) {
    event.preventDefault();
    const id = document.getElementById('contract-id').value || nextId('contract');
    const personId = document.getElementById('contract-person').value;
    const person = getPerson(personId);
    const startDate = document.getElementById('contract-start').value;
    const initialEndDate = document.getElementById('contract-initial-end').value;
    if (!person || person.type !== 'Intérim') { showToast('Choisissez un intérimaire valide.', true); return; }
    if (!startDate || !initialEndDate || initialEndDate < startDate) { showToast('Vérifiez les dates de début et de fin.', true); return; }
    const current = (db.interimContracts || []).find(item => item.id === id);
    const overlapping = contractsForPerson(personId).find(item => item.id !== id && !item.closed && startDate <= contractCurrentEnd(item) && initialEndDate >= item.startDate);
    if (overlapping) { showToast('Cette mission chevauche une autre mission ouverte pour cet intérimaire.', true); return; }
    const data = {
      id, personId,
      agency: document.getElementById('contract-agency').value.trim(),
      contractNumber: document.getElementById('contract-number').value.trim(),
      position: document.getElementById('contract-position').value.trim(),
      reason: document.getElementById('contract-reason').value,
      startDate, initialEndDate,
      maxDurationMonths: Number(document.getElementById('contract-max-months').value || 0) || '',
      carenceExempt: document.getElementById('contract-carence-exempt').checked,
      note: document.getElementById('contract-note').value.trim(),
      closed: document.getElementById('contract-closed').checked,
      createdAt: current?.createdAt || new Date().toISOString(),
      renewals: current?.renewals || [],
      liaison: current?.liaison || { status: 'to_send', agencyEmail: '', contactName: '', contactPhone: '', hourlyRate: '', billingCoefficient: '', mealAllowance: '', travelAllowance: '', transportAllowance: '', weeklyHours: '', note: '', sentAt: '', completedAt: '', validatedAt: '', emailPreparedAt: '', token: nextId('liaison') }
    };
    const maxEnd = contractMaximumEnd(data);
    if (maxEnd && contractCurrentEnd(data) > maxEnd) { showToast(`La fin dépasse la limite paramétrée du ${formatDateIso(maxEnd)}.`, true); return; }
    const index = (db.interimContracts || []).findIndex(item => item.id === id);
    if (index >= 0) db.interimContracts[index] = data; else db.interimContracts.push(data);
    if (data.agency) person.company = data.agency;
    const week = currentWeek();
    if (person.active !== false && isPersonEligibleForWeek(person, db.currentWeek.year, db.currentWeek.week) && !week.rosterIds.includes(person.id) && !week.locked) week.rosterIds.push(person.id);
    if (!isPersonEligibleForWeek(person, db.currentWeek.year, db.currentWeek.week) && !week.entries.some(entry => entry.personId === person.id) && !week.absences.some(item => item.personId === person.id) && !(week.lates || []).some(item => item.personId === person.id) && !week.locked) week.rosterIds = week.rosterIds.filter(idValue => idValue !== person.id);
    saveDatabase();
    document.getElementById('contract-dialog').close();
    renderContracts(); renderPersonnel(); renderPointage();
    showToast(index >= 0 ? 'Mission mise à jour.' : 'Mission ajoutée.');
    if (index < 0) window.setTimeout(() => openLiaisonDialog(id), 0);
  }

  function openLiaisonDialog(contractId) {
    const contract = (db.interimContracts || []).find(item => item.id === contractId);
    if (!contract) return;
    const person = getPerson(contract.personId);
    const liaison = contract.liaison || {};
    document.getElementById('liaison-contract-id').value = contract.id;
    document.getElementById('liaison-dialog-meta').textContent = `${person?.name || 'Intérimaire'} · ${contract.agency || person?.company || 'Agence'} · arrivée ${formatDateIso(contract.startDate)}`;
    document.getElementById('liaison-agency-email').value = liaison.agencyEmail || '';
    document.getElementById('liaison-status').value = liaison.status || 'to_send';
    document.getElementById('liaison-hourly-rate').value = liaison.hourlyRate ?? '';
    document.getElementById('liaison-billing-coefficient').value = liaison.billingCoefficient ?? '';
    document.getElementById('liaison-meal-allowance').value = liaison.mealAllowance ?? '';
    document.getElementById('liaison-travel-allowance').value = liaison.travelAllowance ?? '';
    document.getElementById('liaison-transport-allowance').value = liaison.transportAllowance ?? '';
    document.getElementById('liaison-weekly-hours').value = liaison.weeklyHours ?? '';
    document.getElementById('liaison-contact-name').value = liaison.contactName || '';
    document.getElementById('liaison-contact-phone').value = liaison.contactPhone || '';
    document.getElementById('liaison-note').value = liaison.note || '';
    document.getElementById('liaison-dialog').showModal();
  }

  function persistLiaisonForm(close = false) {
    const contract = (db.interimContracts || []).find(item => item.id === document.getElementById('liaison-contract-id').value);
    if (!contract) return null;
    const previous = contract.liaison || {};
    const status = document.getElementById('liaison-status').value;
    const now = new Date().toISOString();
    contract.liaison = {
      ...previous,
      status,
      agencyEmail: document.getElementById('liaison-agency-email').value.trim(),
      hourlyRate: document.getElementById('liaison-hourly-rate').value === '' ? '' : Number(document.getElementById('liaison-hourly-rate').value),
      billingCoefficient: document.getElementById('liaison-billing-coefficient').value === '' ? '' : Number(document.getElementById('liaison-billing-coefficient').value),
      mealAllowance: document.getElementById('liaison-meal-allowance').value === '' ? '' : Number(document.getElementById('liaison-meal-allowance').value),
      travelAllowance: document.getElementById('liaison-travel-allowance').value === '' ? '' : Number(document.getElementById('liaison-travel-allowance').value),
      transportAllowance: document.getElementById('liaison-transport-allowance').value === '' ? '' : Number(document.getElementById('liaison-transport-allowance').value),
      weeklyHours: document.getElementById('liaison-weekly-hours').value === '' ? '' : Number(document.getElementById('liaison-weekly-hours').value),
      contactName: document.getElementById('liaison-contact-name').value.trim(),
      contactPhone: document.getElementById('liaison-contact-phone').value.trim(),
      note: document.getElementById('liaison-note').value.trim(),
      token: previous.token || nextId('liaison'),
      sentAt: previous.sentAt || (status === 'sent' || status === 'completed' || status === 'validated' ? now : ''),
      completedAt: previous.completedAt || (status === 'completed' || status === 'validated' ? now : ''),
      validatedAt: previous.validatedAt || (status === 'validated' ? now : '')
    };
    saveDatabase();
    renderContracts();
    if (close) document.getElementById('liaison-dialog').close();
    return contract;
  }

  function saveLiaison(event) {
    event.preventDefault();
    const contract = persistLiaisonForm(true);
    if (contract) showToast('Fiche de liaison enregistrée.');
  }

  function prepareLiaisonEmail() {
    const contract = persistLiaisonForm(false);
    if (!contract) return;
    const person = getPerson(contract.personId);
    const email = contract.liaison?.agencyEmail || '';
    if (!email) { showToast('Renseignez d’abord l’adresse e-mail de l’agence.', true); document.getElementById('liaison-agency-email').focus(); return; }
    contract.liaison.emailPreparedAt = new Date().toISOString();
    saveDatabase('Mail préparé');
    const subject = `Fiche de liaison intérimaire – ${person?.name || 'Nouvel intérimaire'} – ${db.project.name}`;
    const body = `Bonjour,

Dans le cadre de l’arrivée de ${person?.name || 'cet intérimaire'} sur le chantier ${db.project.name}${db.project.code ? ` (${db.project.code})` : ''} à compter du ${formatDateIso(contract.startDate)}, merci de nous retourner la fiche de liaison complétée avec les éléments nécessaires à la mission (taux horaire, coefficient, indemnités et informations utiles).

La fiche peut être générée depuis l’application Pointages GCC.

Merci par avance.

Cordialement`;
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function markLiaisonSent() {
    const contract = persistLiaisonForm(false);
    if (!contract) return;
    contract.liaison.status = 'sent';
    contract.liaison.sentAt = contract.liaison.sentAt || new Date().toISOString();
    document.getElementById('liaison-status').value = 'sent';
    saveDatabase();
    renderContracts();
    showToast('Fiche marquée comme envoyée.');
  }

  function printLiaisonSheet() {
    const contract = persistLiaisonForm(false);
    if (!contract) return;
    const person = getPerson(contract.personId);
    const l = contract.liaison || {};
    const popup = window.open('', '_blank');
    if (!popup) { showToast('Autorisez les fenêtres contextuelles pour imprimer la fiche.', true); return; }
    const money = value => value === '' || value == null ? '' : `${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    popup.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiche liaison - ${escapeHtml(person?.name || '')}</title><style>body{font-family:Arial,sans-serif;color:#202020;margin:32px}header{border-bottom:5px solid #ffd800;padding-bottom:14px;margin-bottom:24px}h1{margin:0 0 6px;font-size:24px}.meta{color:#666}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{border:1px solid #bbb;border-radius:8px;padding:10px;min-height:42px}.field b{display:block;font-size:11px;color:#666;text-transform:uppercase;margin-bottom:5px}.full{grid-column:1/-1}.sign{margin-top:36px;display:grid;grid-template-columns:1fr 1fr;gap:24px}.sign div{height:90px;border:1px solid #aaa;padding:10px}small{color:#666}@media print{body{margin:12mm}}</style></head><body><header><h1>Fiche de liaison intérimaire</h1><div class="meta">${escapeHtml(db.project.name)}${db.project.code ? ` · ${escapeHtml(db.project.code)}` : ''}</div></header><div class="grid"><div class="field"><b>Intérimaire</b>${escapeHtml(person?.name || '')}</div><div class="field"><b>Agence</b>${escapeHtml(contract.agency || person?.company || '')}</div><div class="field"><b>Début de mission</b>${escapeHtml(formatDateIso(contract.startDate))}</div><div class="field"><b>Fin prévue</b>${escapeHtml(formatDateIso(contractCurrentEnd(contract)))}</div><div class="field"><b>Poste / qualification</b>${escapeHtml(contract.position || '')}</div><div class="field"><b>Contact agence</b>${escapeHtml(l.contactName || '')}</div><div class="field"><b>Taux horaire</b>${escapeHtml(money(l.hourlyRate))}</div><div class="field"><b>Coefficient / taux facturation</b>${escapeHtml(l.billingCoefficient ?? '')}</div><div class="field"><b>Panier repas</b>${escapeHtml(money(l.mealAllowance))}</div><div class="field"><b>Indemnité trajet</b>${escapeHtml(money(l.travelAllowance))}</div><div class="field"><b>Indemnité transport</b>${escapeHtml(money(l.transportAllowance))}</div><div class="field"><b>Durée hebdomadaire</b>${escapeHtml(l.weeklyHours ? `${l.weeklyHours} h` : '')}</div><div class="field full"><b>Observations</b>${escapeHtml(l.note || '')}</div></div><div class="sign"><div><b>Agence d’intérim</b></div><div><b>GCC / Chantier</b></div></div><p><small>Document préparé depuis Pointages GCC · ${new Date().toLocaleDateString('fr-FR')}</small></p><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  }

  function openRenewalDialog(contractId) {
    const contract = (db.interimContracts || []).find(item => item.id === contractId);
    if (!contract) return;
    const person = getPerson(contract.personId);
    const currentEnd = contractCurrentEnd(contract);
    const nextDate = parseDateOnly(currentEnd); if (nextDate) nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    document.getElementById('renewal-contract-id').value = contract.id;
    document.getElementById('renewal-dialog-meta').textContent = `${person?.name || 'Intérimaire'} · fin actuelle ${formatDateIso(currentEnd)}`;
    document.getElementById('renewal-end').value = '';
    document.getElementById('renewal-end').min = nextDate ? nextDate.toISOString().slice(0, 10) : '';
    document.getElementById('renewal-signed').value = todayIso();
    document.getElementById('renewal-reference').value = '';
    document.getElementById('renewal-note').value = '';
    document.getElementById('renewal-rule-summary').innerHTML = `<strong>${(contract.renewals || []).length}/${db.contractRules.maxRenewals} renouvellement(s) utilisé(s)</strong><span>Fin maximale paramétrée : ${formatDateIso(contractMaximumEnd(contract))}</span>`;
    document.getElementById('renewal-dialog').showModal();
  }

  function saveRenewal(event) {
    event.preventDefault();
    const contract = (db.interimContracts || []).find(item => item.id === document.getElementById('renewal-contract-id').value);
    if (!contract) return;
    const count = (contract.renewals || []).length;
    if (count >= Number(db.contractRules.maxRenewals || 0)) { showToast('Le nombre maximal de renouvellements paramétré est atteint.', true); return; }
    const currentEnd = contractCurrentEnd(contract);
    const endDate = document.getElementById('renewal-end').value;
    if (!endDate || endDate <= currentEnd) { showToast('La nouvelle date de fin doit être postérieure à la fin actuelle.', true); return; }
    const maxEnd = contractMaximumEnd(contract);
    if (maxEnd && endDate > maxEnd) { showToast(`La nouvelle fin dépasse la limite paramétrée du ${formatDateIso(maxEnd)}.`, true); return; }
    const start = parseDateOnly(currentEnd); start?.setUTCDate(start.getUTCDate() + 1);
    contract.renewals ||= [];
    contract.renewals.push({ id: nextId('renewal'), startDate: start?.toISOString().slice(0, 10) || '', endDate, signedDate: document.getElementById('renewal-signed').value, reference: document.getElementById('renewal-reference').value.trim(), note: document.getElementById('renewal-note').value.trim() });
    contract.closed = false;
    saveDatabase();
    document.getElementById('renewal-dialog').close();
    renderContracts(); renderPersonnel(); renderPointage();
    showToast('Renouvellement enregistré.');
  }

  function deleteContract(contractId) {
    const contract = (db.interimContracts || []).find(item => item.id === contractId);
    if (!contract) return;
    const person = getPerson(contract.personId);
    if (!window.confirm(`Supprimer définitivement la mission de ${person?.name || 'cet intérimaire'} du ${formatDateIso(contract.startDate)} au ${formatDateIso(contractCurrentEnd(contract))} ?`)) return;
    db.interimContracts = db.interimContracts.filter(item => item.id !== contractId);
    saveDatabase(); renderContracts(); renderPersonnel();
    showToast('Mission supprimée.');
  }

  function saveContractRules(event) {
    event.preventDefault();
    const alertDays = document.getElementById('rule-alert-days').value.split(/[,; ]+/).map(Number).filter(value => Number.isFinite(value) && value >= 0);
    const arrivalAlertDays = document.getElementById('rule-arrival-alert-days').value.split(/[,; ]+/).map(Number).filter(value => Number.isFinite(value) && value >= 0);
    db.contractRules = {
      maxRenewals: Math.max(0, Number(document.getElementById('rule-max-renewals').value || 0)),
      maxDurationMonths: Math.max(1, Number(document.getElementById('rule-max-months').value || 18)),
      alertDays: [...new Set(alertDays)].sort((a, b) => b - a),
      arrivalAlertDays: [...new Set(arrivalAlertDays)].sort((a, b) => b - a),
      carenceMode: document.getElementById('rule-carence-mode').value,
      blockOutsideContract: document.getElementById('rule-block-outside').checked,
      excludeExpiredFromNewWeeks: document.getElementById('rule-exclude-expired').checked
    };
    saveDatabase(); renderContracts();
    document.getElementById('contract-rules-dialog')?.close();
    showToast('Règles de suivi enregistrées.');
  }

  function renderTasks() {
    const search = ui.taskSearch.trim().toLocaleLowerCase('fr');
    const tasks = db.tasks.filter(task => !search || task.name.toLocaleLowerCase('fr').includes(search));
    const list = document.getElementById('task-list');
    list.innerHTML = tasks.length ? tasks.map((task, index) => {
      const total = currentWeek().entries.filter(entry => entry.taskId === task.id).reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
      return `<div class="management-row ${task.active === false ? 'inactive' : ''}">
        <div><span class="task-index">${index + 1}</span><strong style="display:inline">${escapeHtml(task.name)}</strong></div>
        <div><span class="status-pill ${task.active === false ? 'empty' : 'complete'}">${task.active === false ? 'Désactivée' : 'Active'}</span> <small>${hours(total)} cette semaine</small></div>
        <div class="row-actions"><button type="button" data-edit-task="${escapeHtml(task.id)}">Modifier</button><button type="button" class="delete-action" data-delete-task="${escapeHtml(task.id)}">Supprimer</button></div>
      </div>`;
    }).join('') : '<div class="empty-state"><strong>Aucune tâche trouvée</strong>Ajoutez une nouvelle tâche ou modifiez la recherche.</div>';
  }

  function renderExports() {
    document.getElementById('project-name').value = db.project.name || '';
    document.getElementById('project-code').value = db.project.code || '';
    document.getElementById('project-management').value = db.project.management || '';
    document.getElementById('project-zone').value = db.project.defaultZone || '';
    document.getElementById('project-secretary-email').value = db.project.secretaryEmail || '';
    renderDefaultScheduleInputs();
  }

  function openPointageDialog(personId, day) {
    const person = getPerson(personId);
    if (!person) return;
    ui.editingPointage = { personId, day };
    ui.entryDraft = personEntries(personId, day).map(entry => ({ ...entry, draftId: nextId('draft') }));
    const absence = personAbsence(personId, day);
    const late = personLate(personId, day);
    document.getElementById('pointage-dialog-day').textContent = `${DAY_NAMES[day]} ${formatDate(dateForDay(day))}`;
    document.getElementById('pointage-dialog-person').textContent = person.name;
    document.getElementById('pointage-dialog-meta').textContent = `${person.type} · ${person.company || 'Sans entreprise'}${person.zone ? ` · ${person.zone}` : ''}${isWeekLocked() ? ' · lecture seule' : ''}`;
    document.getElementById('day-status-options').innerHTML = ABSENCE_CODES.map(item => `
      <label class="status-option"><input type="radio" name="day-status" value="${item.code}" ${(absence?.code || 'PRESENT') === item.code ? 'checked' : ''} ${isWeekLocked() ? 'disabled' : ''}><span>${escapeHtml(item.label)}</span></label>`).join('');
    document.getElementById('absence-note').value = absence?.note || '';
    document.getElementById('absence-note').disabled = isWeekLocked();
    document.getElementById('late-checkbox').checked = Boolean(late);
    document.getElementById('late-checkbox').disabled = isWeekLocked();
    document.getElementById('late-note').value = late?.note || '';
    document.getElementById('late-note').disabled = isWeekLocked();
    if (!ui.entryDraft.length && !absence && !isWeekLocked()) addDraftLine(false);
    renderEntryLines();
    document.querySelectorAll('#entry-lines input, #entry-lines select, #entry-lines button, #add-entry-line, #copy-previous-day').forEach(element => element.disabled = isWeekLocked());
    const submit = document.querySelector('#pointage-form button[type="submit"]');
    submit.hidden = isWeekLocked();
    updatePointageStatusDisplay();
    document.getElementById('pointage-dialog').showModal();
  }

  function selectedStatusCode() {
    return document.querySelector('input[name="day-status"]:checked')?.value || 'PRESENT';
  }

  function taskOptions(selectedTaskId = '', includePlaceholder = true) {
    const options = db.tasks.filter(task => task.active !== false || task.id === selectedTaskId);
    const placeholder = includePlaceholder ? `<option value="" ${selectedTaskId ? '' : 'selected'}>Choisir une tâche…</option>` : '';
    return placeholder + options.map(task => `<option value="${escapeHtml(task.id)}" ${task.id === selectedTaskId ? 'selected' : ''}>${escapeHtml(task.name)}${task.active === false ? ' (inactive)' : ''}</option>`).join('');
  }

  function addDraftLine(render = true) {
    if (!activeTasks().length) {
      showToast('Ajoutez d’abord une tâche dans la bibliothèque.', true);
      return;
    }
    const editing = ui.editingPointage;
    const person = getPerson(editing?.personId);
    const current = ui.entryDraft.reduce((sum, line) => sum + Number(line.hours || 0), 0);
    const remaining = Math.max(0, personTarget(person, editing?.day || 0) - current);
    ui.entryDraft.push({ id: nextId('entry'), draftId: nextId('draft'), personId: editing?.personId, day: editing?.day, taskId: '', hours: remaining || '', note: '' });
    if (render) renderEntryLines();
  }

  function renderEntryLines() {
    const container = document.getElementById('entry-lines');
    if (!ui.entryDraft.length) {
      container.innerHTML = '<div class="empty-state"><strong>Aucune tâche</strong>Ajoutez une ligne pour ventiler les heures.</div>';
    } else {
      container.innerHTML = ui.entryDraft.map(line => `
        <div class="entry-line" data-draft-id="${escapeHtml(line.draftId)}">
          <select class="entry-task" aria-label="Tâche">${taskOptions(line.taskId)}</select>
          <input class="entry-hours" type="number" min="0" max="24" step="0.25" value="${escapeHtml(line.hours)}" placeholder="Heures" aria-label="Nombre d'heures">
          <input class="entry-note" value="${escapeHtml(line.note || '')}" placeholder="Observation" aria-label="Observation">
          <button type="button" class="remove-line" aria-label="Supprimer cette ligne">×</button>
        </div>`).join('');
    }
    updatePointageDialogTotal();
  }

  function syncDraftFromDom() {
    const rows = [...document.querySelectorAll('#entry-lines .entry-line')];
    ui.entryDraft = rows.map(row => ({
      id: ui.entryDraft.find(item => item.draftId === row.dataset.draftId)?.id || nextId('entry'),
      draftId: row.dataset.draftId,
      personId: ui.editingPointage.personId,
      day: ui.editingPointage.day,
      taskId: row.querySelector('.entry-task').value,
      hours: Number(row.querySelector('.entry-hours').value || 0),
      note: row.querySelector('.entry-note').value.trim()
    }));
  }

  function updatePointageDialogTotal() {
    if (!ui.editingPointage) return;
    const total = ui.entryDraft.reduce((sum, line) => sum + Number(line.hours || 0), 0);
    const person = getPerson(ui.editingPointage.personId);
    const target = personTarget(person, ui.editingPointage.day);
    const lateChecked = document.getElementById('late-checkbox')?.checked;
    const difference = target - total;
    document.getElementById('pointage-dialog-total').textContent = hours(total);
    document.getElementById('pointage-dialog-target').textContent = lateChecked && difference > 0.01
      ? `Horaire théorique : ${hours(target)} · retard déclaré : ${hours(difference)}`
      : `Horaire théorique : ${hours(target)}`;
  }

  function updatePointageStatusDisplay() {
    const isPresent = selectedStatusCode() === 'PRESENT';
    document.getElementById('entries-editor').hidden = !isPresent;
    document.getElementById('absence-note-block').hidden = isPresent;
    const lateChecked = isPresent && document.getElementById('late-checkbox').checked;
    document.getElementById('late-note-block').hidden = !lateChecked;
    const total = isPresent ? ui.entryDraft.reduce((sum, line) => sum + Number(line.hours || 0), 0) : 0;
    document.getElementById('pointage-dialog-total').textContent = hours(total);
    if (ui.editingPointage) {
      const person = getPerson(ui.editingPointage.personId);
      const target = personTarget(person, ui.editingPointage.day);
      const difference = target - total;
      document.getElementById('pointage-dialog-target').textContent = lateChecked && difference > 0.01
        ? `Horaire théorique : ${hours(target)} · retard déclaré : ${hours(difference)}`
        : `Horaire théorique : ${hours(target)}`;
    }
  }

  function savePointage(event) {
    event.preventDefault();
    if (!assertWeekEditable()) return;
    if (!ui.editingPointage) return;
    const advanceAfterSave = Boolean(window.matchMedia?.('(max-width: 680px)').matches);
    const { personId, day } = ui.editingPointage;
    const status = selectedStatusCode();
    const lateChecked = status === 'PRESENT' && document.getElementById('late-checkbox').checked;
    const lateNote = document.getElementById('late-note').value.trim();
    let mergedValues = [];

    if (status === 'PRESENT') {
      const contractCheck = pointageContractCheck(personId, day);
      if (!contractCheck.ok) { showToast(contractCheck.warning, true); return; }
      if (contractCheck.warning) showToast(contractCheck.warning, true);
      syncDraftFromDom();
      const linesWithHours = ui.entryDraft.filter(line => Number(line.hours) > 0);
      if (linesWithHours.some(line => !line.taskId)) {
        showToast('Choisissez une tâche pour chaque ligne comportant des heures.', true);
        return;
      }
      const total = linesWithHours.reduce((sum, line) => sum + Number(line.hours), 0);
      if (total > 24) {
        showToast('Le total journalier ne peut pas dépasser 24 heures.', true);
        return;
      }
      const merged = new Map();
      linesWithHours.forEach(line => {
        const existing = merged.get(line.taskId);
        if (existing) {
          existing.hours += Number(line.hours);
          if (line.note) existing.note = [existing.note, line.note].filter(Boolean).join(' · ');
        } else {
          merged.set(line.taskId, { ...line, hours: Number(line.hours) });
        }
      });
      mergedValues = [...merged.values()];
    }

    const week = currentWeek();
    week.entries = week.entries.filter(entry => !(entry.personId === personId && entry.day === day));
    week.absences = week.absences.filter(item => !(item.personId === personId && item.day === day));
    week.lates = (week.lates || []).filter(item => !(item.personId === personId && item.day === day));

    if (status === 'PRESENT') {
      mergedValues.forEach(line => week.entries.push({ id: nextId('e'), personId, day, taskId: line.taskId, hours: line.hours, note: line.note || '' }));
      if (lateChecked && mergedValues.length) week.lates.push({ id: nextId('late'), personId, day, note: lateNote });
    } else {
      week.absences.push({ id: nextId('a'), personId, day, code: status, note: document.getElementById('absence-note').value.trim() });
    }

    saveDatabase();
    const nextPerson = advanceAfterSave ? nextPendingPerson(personId, day) : null;
    document.getElementById('pointage-dialog').close();
    ui.editingPointage = null;
    ui.entryDraft = [];
    renderPointage();
    renderWeek();
    if (nextPerson) {
      showToast('Enregistré · passage au suivant.');
      setTimeout(() => openPointageDialog(nextPerson.id, day), 80);
    } else {
      showToast(advanceAfterSave ? 'Pointage enregistré · journée à jour.' : 'Pointage enregistré.');
    }
  }

  function copyPreviousDay() {
    if (!assertWeekEditable()) return;
    if (!ui.editingPointage || ui.editingPointage.day === 0) {
      showToast('Il n’y a pas de jour précédent dans cette semaine.', true);
      return;
    }
    const previous = personEntries(ui.editingPointage.personId, ui.editingPointage.day - 1);
    const previousAbsence = personAbsence(ui.editingPointage.personId, ui.editingPointage.day - 1);
    const previousLate = personLate(ui.editingPointage.personId, ui.editingPointage.day - 1);
    document.getElementById('late-checkbox').checked = false;
    document.getElementById('late-note').value = '';
    if (previousAbsence) {
      const radio = document.querySelector(`input[name="day-status"][value="${previousAbsence.code}"]`);
      if (radio) radio.checked = true;
      document.getElementById('absence-note').value = previousAbsence.note || '';
      ui.entryDraft = [];
    } else if (previous.length) {
      document.querySelector('input[name="day-status"][value="PRESENT"]').checked = true;
      ui.entryDraft = previous.map(entry => ({ ...entry, id: nextId('entry'), draftId: nextId('draft'), day: ui.editingPointage.day }));
      document.getElementById('late-checkbox').checked = Boolean(previousLate);
      document.getElementById('late-note').value = previousLate?.note || '';
    } else {
      showToast('Le jour précédent est vide.', true);
      return;
    }
    renderEntryLines();
    updatePointageStatusDisplay();
    showToast('Jour précédent recopié.');
  }

  function openBulkDialog() {
    if (!assertWeekEditable()) return;
    if (!ui.selectedPeople.size) return;
    document.getElementById('bulk-dialog-meta').textContent = `${ui.selectedPeople.size} personne(s) · ${DAY_NAMES[ui.day]} ${formatDate(dateForDay(ui.day))}`;
    document.getElementById('bulk-task').innerHTML = taskOptions();
    document.getElementById('bulk-hours').value = '7.5';
    document.getElementById('bulk-note').value = '';
    document.getElementById('bulk-mode').value = 'add';
    document.getElementById('bulk-dialog').showModal();
  }

  function saveBulk(event) {
    event.preventDefault();
    if (!assertWeekEditable()) return;
    const taskId = document.getElementById('bulk-task').value;
    const amount = Number(document.getElementById('bulk-hours').value || 0);
    const note = document.getElementById('bulk-note').value.trim();
    const mode = document.getElementById('bulk-mode').value;
    if (!taskId || amount <= 0) {
      showToast('Sélectionnez une tâche et un nombre d’heures valide.', true);
      return;
    }
    const week = currentWeek();
    const contractBlocked = [...ui.selectedPeople].find(personId => !pointageContractCheck(personId, ui.day).ok);
    if (contractBlocked) { showToast(pointageContractCheck(contractBlocked, ui.day).warning, true); return; }
    const contractWarnings = [...ui.selectedPeople].map(personId => pointageContractCheck(personId, ui.day)).filter(result => result.warning);
    if (contractWarnings.length) showToast(`${contractWarnings.length} personne(s) sans contrat couvrant clairement cette date.`, true);
    const impossible = [...ui.selectedPeople].find(personId => mode === 'add' && personDayTotal(personId, ui.day) + amount > 24);
    if (impossible) {
      showToast(`Le total dépasserait 24 h pour ${getPerson(impossible)?.name || 'une personne'}.`, true);
      return;
    }
    ui.selectedPeople.forEach(personId => {
      week.absences = week.absences.filter(item => !(item.personId === personId && item.day === ui.day));
      if (mode === 'replace') week.entries = week.entries.filter(entry => !(entry.personId === personId && entry.day === ui.day));
      const existing = week.entries.find(entry => entry.personId === personId && entry.day === ui.day && entry.taskId === taskId && (entry.note || '') === note);
      if (existing && mode === 'add') existing.hours = Number(existing.hours || 0) + amount;
      else week.entries.push({ id: nextId('e'), personId, day: ui.day, taskId, hours: amount, note });
    });
    saveDatabase();
    document.getElementById('bulk-dialog').close();
    ui.selectedPeople.clear();
    ui.selectionMode = false;
    renderPointage();
    renderWeek();
    showToast('Affectation groupée enregistrée.');
  }

  function openPersonDialog(personId = null, presetType = '') {
    const person = personId ? getPerson(personId) : null;
    document.getElementById('person-dialog-title').textContent = person ? 'Modifier la personne' : 'Ajouter une personne';
    document.getElementById('person-id').value = person?.id || '';
    const initialType = person?.type || presetType || 'GCC';
    document.getElementById('person-name').value = person?.name || '';
    document.getElementById('person-type').value = initialType;
    document.getElementById('person-company').value = person?.company || (initialType === 'GCC' ? 'GCC' : '');
    document.getElementById('person-zone').value = person?.zone || db.project.defaultZone || '';
    document.getElementById('person-active').checked = person?.active !== false;
    const defaultKey = initialType === 'GCC' ? 'GCC' : (initialType === 'Prêt de MO' ? 'PretMO' : 'Interim');
    const schedule = person?.schedule || db.defaultSchedules?.[defaultKey] || [8, 8, 8, 8, 7];
    document.getElementById('schedule-grid').innerHTML = DAY_SHORT.map((day, index) => `<label>${day}<input class="schedule-input" data-schedule-day="${index}" type="number" min="0" max="24" step="0.25" value="${escapeHtml(schedule[index] ?? 0)}"></label>`).join('');
    document.getElementById('person-dialog').showModal();
  }

  function deletePerson(personId) {
    const person = getPerson(personId);
    if (!person) return;
    let entryCount = 0;
    let absenceCount = 0;
    let lateCount = 0;
    let linkedHours = 0;
    Object.values(db.weeks).forEach(week => {
      (week.entries || []).forEach(entry => {
        if (entry.personId === personId) {
          entryCount += 1;
          linkedHours += Number(entry.hours || 0);
        }
      });
      absenceCount += (week.absences || []).filter(item => item.personId === personId).length;
      lateCount += (week.lates || []).filter(item => item.personId === personId).length;
    });
    const linkedText = entryCount || absenceCount
      ? `\n\nCette suppression effacera aussi ${entryCount} ligne(s) de pointage (${numberText(linkedHours)} h), ${absenceCount} absence(s) et ${lateCount} retard(s), toutes semaines confondues.`
      : '';
    if (!window.confirm(`Supprimer définitivement ${person.name} ?${linkedText}`)) return;
    Object.values(db.weeks).forEach(week => {
      week.entries = (week.entries || []).filter(entry => entry.personId !== personId);
      week.absences = (week.absences || []).filter(item => item.personId !== personId);
      week.lates = (week.lates || []).filter(item => item.personId !== personId);
    });
    db.people = db.people.filter(item => item.id !== personId);
    db.interimContracts = (db.interimContracts || []).filter(contract => contract.personId !== personId);
    (db.teams || []).forEach(team => { team.memberIds = (team.memberIds || []).filter(id => id !== personId); });
    Object.values(db.weeks).forEach(week => { week.rosterIds = (week.rosterIds || []).filter(id => id !== personId); });
    ui.selectedPeople.delete(personId);
    saveDatabase();
    renderPointage();
    renderWeek();
    renderPersonnel();
    renderTasks();
    showToast('Personne et pointages associés supprimés.');
  }

  function savePerson(event) {
    event.preventDefault();
    const id = document.getElementById('person-id').value || nextId('p');
    const name = document.getElementById('person-name').value.trim();
    const type = document.getElementById('person-type').value;
    const company = document.getElementById('person-company').value.trim();
    if (!name || !company) {
      showToast('Le nom et l’entreprise sont obligatoires.', true);
      return;
    }
    const schedule = [...document.querySelectorAll('.schedule-input')].map(input => Number(input.value || 0));
    const data = { id, name, type, company, zone: document.getElementById('person-zone').value.trim(), active: document.getElementById('person-active').checked, schedule };
    const index = db.people.findIndex(person => person.id === id);
    const shouldCreateContract = ui.pendingInterimOnboarding && index < 0 && data.type === 'Intérim';
    ui.pendingInterimOnboarding = false;
    if (index >= 0) db.people[index] = { ...db.people[index], ...data };
    else {
      db.people.push(data);
      if (data.active && !isWeekLocked() && !currentWeek().rosterIds.includes(id)) currentWeek().rosterIds.push(id);
    }
    saveDatabase();
    document.getElementById('person-dialog').close();
    renderPointage();
    renderWeek();
    renderPersonnel();
    renderContracts();
    showToast(index >= 0 ? 'Personne mise à jour.' : 'Personne ajoutée.');
    if (shouldCreateContract) window.setTimeout(() => openContractDialog('', id), 0);
  }

  function openTaskDialog(taskId = null) {
    const task = taskId ? getTask(taskId) : null;
    document.getElementById('task-dialog-title').textContent = task ? 'Modifier la tâche' : 'Ajouter une tâche';
    document.getElementById('task-id').value = task?.id || '';
    document.getElementById('task-name').value = task?.name || '';
    document.getElementById('task-active').checked = task?.active !== false;
    document.getElementById('task-dialog').showModal();
  }

  function deleteTask(taskId) {
    const task = getTask(taskId);
    if (!task) return;
    let entryCount = 0;
    let linkedHours = 0;
    Object.values(db.weeks).forEach(week => {
      (week.entries || []).forEach(entry => {
        if (entry.taskId === taskId) {
          entryCount += 1;
          linkedHours += Number(entry.hours || 0);
        }
      });
    });
    const linkedText = entryCount
      ? `\n\nCette suppression effacera aussi ${entryCount} ligne(s) de pointage représentant ${numberText(linkedHours)} h, toutes semaines confondues.`
      : '';
    if (!window.confirm(`Supprimer définitivement la tâche « ${task.name} » ?${linkedText}`)) return;
    Object.values(db.weeks).forEach(week => {
      week.entries = (week.entries || []).filter(entry => entry.taskId !== taskId);
    });
    db.tasks = db.tasks.filter(item => item.id !== taskId);
    saveDatabase();
    renderPointage();
    renderWeek();
    renderTasks();
    showToast('Tâche et pointages associés supprimés.');
  }

  function saveTask(event) {
    event.preventDefault();
    const id = document.getElementById('task-id').value || nextId('t');
    const name = document.getElementById('task-name').value.trim();
    if (!name) {
      showToast('Le nom de la tâche est obligatoire.', true);
      return;
    }
    const duplicate = db.tasks.find(task => task.id !== id && task.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'));
    if (duplicate) {
      showToast('Une tâche porte déjà ce nom.', true);
      return;
    }
    const data = { id, name, active: document.getElementById('task-active').checked };
    const index = db.tasks.findIndex(task => task.id === id);
    if (index >= 0) db.tasks[index] = data;
    else db.tasks.push(data);
    saveDatabase();
    document.getElementById('task-dialog').close();
    renderPointage();
    renderWeek();
    renderTasks();
    showToast(index >= 0 ? 'Tâche mise à jour.' : 'Tâche ajoutée.');
  }

  function changeWeek(offset) {
    const monday = isoWeekMonday(db.currentWeek.year, db.currentWeek.week);
    monday.setUTCDate(monday.getUTCDate() + offset * 7);
    db.currentWeek = getIsoWeekInfo(monday);
    ensureCurrentWeek();
    ui.selectedPeople.clear();
    ui.selectionMode = false;
    renderAll();
    saveDatabase();
  }

  function openWeekPicker() {
    document.getElementById('picker-year').value = db.currentWeek.year;
    document.getElementById('picker-week').value = db.currentWeek.week;
    document.getElementById('week-picker-dialog').showModal();
  }

  function chooseWeek(event) {
    event.preventDefault();
    const year = Number(document.getElementById('picker-year').value);
    const week = Number(document.getElementById('picker-week').value);
    if (year < 2020 || year > 2100 || week < 1 || week > 53) {
      showToast('Semaine ou année invalide.', true);
      return;
    }
    db.currentWeek = { year, week };
    ensureCurrentWeek();
    document.getElementById('week-picker-dialog').close();
    renderAll();
    saveDatabase();
  }

  function downloadBlob(content, filename, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCsv() {
    const rows = [['Chantier', 'Code', 'Semaine', 'Date', 'Jour', 'Nom', 'Type', 'Entreprise', 'Zone', 'Tâche', 'Heures', 'Observation', 'Statut']];
    currentWeek().entries.forEach(entry => {
      const person = getPerson(entry.personId);
      const task = getTask(entry.taskId);
      const late = personLate(entry.personId, entry.day);
      const observation = [entry.note || '', late ? `Retard${late.note ? ` : ${late.note}` : ''}` : ''].filter(Boolean).join(' · ');
      rows.push([db.project.name, db.project.code, db.currentWeek.week, dateIso(entry.day), DAY_NAMES[entry.day], person?.name || '', person?.type || '', person?.company || '', person?.zone || '', task?.name || '', Number(entry.hours || 0), observation, late ? 'Retard' : 'Présent']);
    });
    currentWeek().absences.forEach(item => {
      const person = getPerson(item.personId);
      rows.push([db.project.name, db.project.code, db.currentWeek.week, dateIso(item.day), DAY_NAMES[item.day], person?.name || '', person?.type || '', person?.company || '', person?.zone || '', '', '', item.note || '', item.code]);
    });
    const csv = '\ufeff' + rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\r\n');
    downloadBlob(csv, `Pointages_${slug(db.project.name)}_S${db.currentWeek.week}_${db.currentWeek.year}.csv`, 'text/csv;charset=utf-8');
    showToast('Export CSV généré.');
  }

  function xmlEscape(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
  }

  function xmlCell(value, type = 'String', style = '', mergeAcross = 0) {
    const attrs = `${style ? ` ss:StyleID="${style}"` : ''}${mergeAcross ? ` ss:MergeAcross="${mergeAcross}"` : ''}`;
    return `<Cell${attrs}><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
  }

  function xmlRow(cells, style = '') {
    return `<Row${style ? ` ss:StyleID="${style}"` : ''}>${cells.join('')}</Row>`;
  }

  function excelWorksheet(name, rows, expandedColumns) {
    return `<Worksheet ss:Name="${xmlEscape(name.slice(0, 31))}"><Table ss:ExpandedColumnCount="${expandedColumns}" ss:ExpandedRowCount="${rows.length}" x:FullColumns="1" x:FullRows="1">${rows.join('')}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane><ActivePane>2</ActivePane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions></Worksheet>`;
  }

  function buildExportContext() {
    const tasks = db.tasks.filter(task => task.active !== false || currentWeek().entries.some(entry => entry.taskId === task.id));
    return {
      project: clone(db.project),
      weekInfo: clone(db.currentWeek),
      week: clone(currentWeek()),
      people: clone(activePeople()),
      allPeople: clone(db.people),
      tasks: clone(tasks),
      teams: clone(db.teams || []),
      interimContracts: clone(db.interimContracts || []),
      contractRules: clone(db.contractRules || {}),
      integration: clone(db.integration || {})
    };
  }

  function exportExcelXml() {
    try {
      if (!window.GCCExcelExporter?.exportWorkbook) {
        showToast('Le module Excel n’est pas disponible. Rechargez l’application.', true);
        return;
      }
      const output = window.GCCExcelExporter.exportWorkbook(buildExportContext());
      downloadBlob(output.blob, output.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const detail = output.interimSheetCount
        ? `${output.interimSheetCount} fiche${output.interimSheetCount > 1 ? 's' : ''} intérimaire${output.interimSheetCount > 1 ? 's' : ''}`
        : 'aucune fiche intérimaire';
      showToast(`Classeur Excel généré : ${detail}.`);
    } catch (error) {
      console.error('Erreur pendant la génération Excel.', error);
      showToast('Impossible de générer le classeur Excel.', true);
    }
  }

  function createIbatExport() {
    if (!window.GCCExcelExporter?.exportIbatWorkbook) {
      showToast('Le module d’export iBAT n’est pas disponible. Rechargez l’application.', true);
      return null;
    }
    return window.GCCExcelExporter.exportIbatWorkbook(buildExportContext());
  }

  function exportIbatWorkbook() {
    try {
      const output = createIbatExport();
      if (!output) return;
      downloadBlob(output.blob, output.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      showToast('Export Saisie iBAT généré.');
    } catch (error) {
      console.error('Erreur pendant la génération de l’export iBAT.', error);
      showToast('Impossible de générer l’export iBAT.', true);
    }
  }

  async function shareIbatWithSecretary() {
    try {
      const output = createIbatExport();
      if (!output) return;
      const email = String(db.project.secretaryEmail || '').trim();
      const file = new File([output.blob], output.filename, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const title = `Pointages ${db.project.name || 'chantier'} — S${db.currentWeek.week}`;
      const text = `Bonjour,\n\nVoici les pointages de la semaine ${db.currentWeek.week} (${db.currentWeek.year}) pour ${db.project.name || 'le chantier'}.\n\nLe fichier « Saisie iBAT » présente, pour chaque personne, les heures ventilées par tâche et par journée afin de faciliter la ressaisie dans iBAT Temps.\n\nCordialement`;

      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        if (email && navigator.clipboard?.writeText) {
          try { await navigator.clipboard.writeText(email); } catch (_) { /* presse-papiers facultatif */ }
        }
        await navigator.share({ title, text: email ? `${text}\n\nDestinataire : ${email}` : text, files: [file] });
        showToast(email ? 'Fichier partagé. Adresse de la secrétaire copiée.' : 'Fichier partagé.');
        return;
      }

      downloadBlob(output.blob, output.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const subject = encodeURIComponent(title);
      const body = encodeURIComponent(`${text}\n\nLe fichier Excel vient d’être téléchargé : ajoutez-le en pièce jointe.`);
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
      showToast('Fichier téléchargé et e-mail préparé. Ajoutez le fichier en pièce jointe.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error('Erreur pendant le partage iBAT.', error);
      showToast('Le partage n’a pas pu être ouvert.', true);
    }
  }

  function openCopyDayDialog() {
    if (!assertWeekEditable()) return;
    const options = DAY_NAMES.map((day, index) => `<option value="${index}">${day} ${formatDate(dateForDay(index))}</option>`).join('');
    document.getElementById('copy-source-day').innerHTML = options;
    document.getElementById('copy-target-day').innerHTML = options;
    document.getElementById('copy-source-day').value = String(Math.max(0, ui.day - 1));
    document.getElementById('copy-target-day').value = String(ui.day);
    document.getElementById('copy-overwrite-day').checked = true;
    document.getElementById('copy-day-dialog').showModal();
  }

  function copyDayForAll(event) {
    event.preventDefault();
    if (!assertWeekEditable()) return;
    const source = Number(document.getElementById('copy-source-day').value);
    const target = Number(document.getElementById('copy-target-day').value);
    const overwrite = document.getElementById('copy-overwrite-day').checked;
    if (source === target) { showToast('Choisissez deux jours différents.', true); return; }
    const week = currentWeek();
    const sourceEntries = week.entries.filter(entry => entry.day === source);
    const sourceAbsences = week.absences.filter(item => item.day === source);
    const sourceLates = (week.lates || []).filter(item => item.day === source);
    if (!sourceEntries.length && !sourceAbsences.length && !sourceLates.length) { showToast('Le jour source ne contient aucune saisie.', true); return; }
    const targetHasData = week.entries.some(entry => entry.day === target) || week.absences.some(item => item.day === target) || (week.lates || []).some(item => item.day === target);
    if (targetHasData && !overwrite) {
      const occupied = new Set([...week.entries.filter(entry => entry.day === target).map(entry => entry.personId), ...week.absences.filter(item => item.day === target).map(item => item.personId), ...(week.lates || []).filter(item => item.day === target).map(item => item.personId)]);
      sourceEntries.filter(entry => !occupied.has(entry.personId)).forEach(entry => week.entries.push({ ...entry, id: nextId('e'), day: target }));
      sourceAbsences.filter(item => !occupied.has(item.personId)).forEach(item => week.absences.push({ ...item, id: nextId('a'), day: target }));
      sourceLates.filter(item => !occupied.has(item.personId)).forEach(item => week.lates.push({ ...item, id: nextId('late'), day: target }));
    } else {
      week.entries = week.entries.filter(entry => entry.day !== target);
      week.absences = week.absences.filter(item => item.day !== target);
      week.lates = (week.lates || []).filter(item => item.day !== target);
      sourceEntries.forEach(entry => week.entries.push({ ...entry, id: nextId('e'), day: target }));
      sourceAbsences.forEach(item => week.absences.push({ ...item, id: nextId('a'), day: target }));
      sourceLates.forEach(item => week.lates.push({ ...item, id: nextId('late'), day: target }));
    }
    saveDatabase();
    document.getElementById('copy-day-dialog').close();
    ui.day = target;
    renderAll();
    showToast(`${DAY_NAMES[source]} copié vers ${DAY_NAMES[target]}.`);
  }

  function copyPreviousWeek() {
    if (!assertWeekEditable()) return;
    const previous = previousWeekInfo();
    const source = db.weeks[`${previous.year}-W${String(previous.week).padStart(2, '0')}`];
    if (!source || (!(source.entries || []).length && !(source.absences || []).length && !(source.lates || []).length)) { showToast('La semaine précédente ne contient aucun pointage.', true); return; }
    const target = currentWeek();
    const hasTarget = target.entries.length || target.absences.length || (target.lates || []).length;
    if (!window.confirm(`${hasTarget ? 'Remplacer les saisies actuelles par' : 'Copier'} les pointages de la semaine ${previous.week} ?`)) return;
    target.entries = (source.entries || []).filter(entry => getPerson(entry.personId) && getTask(entry.taskId)).map(entry => ({ ...entry, id: nextId('e') }));
    target.absences = (source.absences || []).filter(item => getPerson(item.personId)).map(item => ({ ...item, id: nextId('a') }));
    target.lates = (source.lates || []).filter(item => getPerson(item.personId)).map(item => ({ ...item, id: nextId('late') }));
    target.rosterIds = [...new Set((source.rosterIds || []).filter(id => getPerson(id)))];
    saveDatabase();
    renderAll();
    showToast(`Semaine ${previous.week} recopiée.`);
  }

  function toggleWeekLock() {
    const week = currentWeek();
    if (week.locked) {
      if (!window.confirm('Déverrouiller cette semaine et autoriser à nouveau les modifications ?')) return;
      week.locked = false;
      week.lockedAt = '';
      saveDatabase();
      renderAll();
      showToast('Semaine déverrouillée.');
      return;
    }
    const blocking = collectAlerts().filter(alert => alert.blocking !== false);
    if (blocking.length) {
      showToast(`Corrigez d’abord ${blocking.length} anomalie(s) bloquante(s).`, true);
      setView('semaine');
      return;
    }
    if (!currentWeek().entries.length && !currentWeek().absences.length) { showToast('Impossible de verrouiller une semaine vide.', true); return; }
    if (!window.confirm('Valider et verrouiller définitivement cette semaine ? Elle pourra être déverrouillée manuellement.')) return;
    week.locked = true;
    week.lockedAt = new Date().toISOString();
    ui.selectionMode = false;
    ui.selectedPeople.clear();
    saveDatabase();
    renderAll();
    showToast('Semaine validée et verrouillée.');
  }

  function renderDefaultScheduleInputs() {
    const schedules = db.defaultSchedules || { GCC: [8, 8, 8, 8, 7], Interim: [7.5, 7.5, 7.5, 7.5, 7], PretMO: [7.5, 7.5, 7.5, 7.5, 7] };
    document.getElementById('default-schedule-gcc').innerHTML = DAY_SHORT.map((day, index) => `<label>${day}<input type="number" min="0" max="24" step="0.25" data-default-schedule="GCC" data-day="${index}" value="${escapeHtml(schedules.GCC[index] ?? 0)}"></label>`).join('');
    document.getElementById('default-schedule-interim').innerHTML = DAY_SHORT.map((day, index) => `<label>${day}<input type="number" min="0" max="24" step="0.25" data-default-schedule="Interim" data-day="${index}" value="${escapeHtml(schedules.Interim[index] ?? 0)}"></label>`).join('');
    document.getElementById('default-schedule-pretmo').innerHTML = DAY_SHORT.map((day, index) => `<label>${day}<input type="number" min="0" max="24" step="0.25" data-default-schedule="PretMO" data-day="${index}" value="${escapeHtml(schedules.PretMO[index] ?? 0)}"></label>`).join('');
  }

  function saveDefaultSchedules(event) {
    event.preventDefault();
    ['GCC', 'Interim', 'PretMO'].forEach(type => {
      db.defaultSchedules[type] = [...document.querySelectorAll(`[data-default-schedule="${type}"]`)].map(input => Number(input.value || 0));
    });
    saveDatabase();
    showToast('Horaires par défaut enregistrés.');
  }

  function applyDefaultSchedule(type) {
    const personType = type === 'GCC' ? 'GCC' : (type === 'PretMO' ? 'Prêt de MO' : 'Intérim');
    const people = db.people.filter(person => person.active !== false && person.type === personType);
    if (!people.length) { showToast(`Aucune personne ${personType} active.`, true); return; }
    if (!window.confirm(`Appliquer les horaires par défaut à ${people.length} personne(s) ${personType} active(s) ?`)) return;
    people.forEach(person => { person.schedule = [...db.defaultSchedules[type]]; });
    saveDatabase();
    renderAll();
    showToast('Horaires appliqués au personnel actif.');
  }

  function exportJson() {
    const content = JSON.stringify(db, null, 2);
    downloadBlob(content, `Sauvegarde_Pointages_${slug(db.project.name)}_${new Date().toISOString().slice(0, 10)}.json`, 'application/json;charset=utf-8');
    showToast('Sauvegarde complète générée.');
  }

  async function importJsonFile(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!isProjectDatabase(parsed)) throw new Error('Format incompatible');
      const currentId = db.project.id;
      const createdAt = db.project.createdAt;
      db = normalizeProject(parsed);
      db.project.id = currentId;
      db.project.createdAt = createdAt || db.project.createdAt;
      ensureCurrentWeek();
      saveDatabase();
      renderAll();
      showToast('Sauvegarde du chantier restaurée.');
    } catch (error) {
      console.error(error);
      showToast('Ce fichier de sauvegarde est invalide.', true);
    }
  }

  function printWeek() {
    setView('semaine');
    window.setTimeout(() => window.print(), 120);
  }

  function saveProject(event) {
    event.preventDefault();
    db.project.name = document.getElementById('project-name').value.trim() || 'Chantier';
    db.project.code = document.getElementById('project-code').value.trim();
    db.project.management = document.getElementById('project-management').value.trim();
    db.project.defaultZone = document.getElementById('project-zone').value.trim();
    db.project.secretaryEmail = document.getElementById('project-secretary-email').value.trim();
    saveDatabase();
    renderHeader();
    showToast('Informations chantier enregistrées.');
  }

  function resetApp() {
    if (!window.confirm(`Vider entièrement le chantier « ${db.project.name} » ? Le personnel, les tâches et tous ses pointages seront supprimés.`)) return;
    const metadata = clone(db.project);
    db = createProjectData(metadata);
    db.project.id = metadata.id;
    db.project.createdAt = metadata.createdAt || db.project.createdAt;
    ui.day = 0;
    ui.selectedPeople.clear();
    ui.selectionMode = false;
    saveDatabase();
    renderAll();
    setView('pointage');
    showToast('Le chantier a été vidé.');
  }

  function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function attachEvents() {
    document.getElementById('create-project-home').addEventListener('click', () => openProjectDialog());
    document.getElementById('project-create-form').addEventListener('submit', saveProjectFromDialog);
    document.getElementById('back-to-projects').addEventListener('click', showProjectHome);
    document.getElementById('project-list').addEventListener('click', event => {
      const createButton = event.target.closest('[data-create-project]');
      if (createButton) { openProjectDialog(); return; }
      const deleteButton = event.target.closest('[data-delete-project]');
      if (deleteButton) { deleteProject(deleteButton.dataset.deleteProject); return; }
      const editButton = event.target.closest('[data-edit-project]');
      if (editButton) { openProjectDialog(editButton.dataset.editProject); return; }
      const openButton = event.target.closest('[data-open-project]');
      if (openButton) openProject(openButton.dataset.openProject);
    });

    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    document.getElementById('previous-week').addEventListener('click', () => changeWeek(-1));
    document.getElementById('next-week').addEventListener('click', () => changeWeek(1));
    document.getElementById('open-week-picker').addEventListener('click', openWeekPicker);
    document.getElementById('week-picker-form').addEventListener('submit', chooseWeek);

    document.getElementById('manage-week-roster').addEventListener('click', openRosterDialog);
    document.getElementById('manage-week-roster-personnel').addEventListener('click', openRosterDialog);
    document.getElementById('roster-form').addEventListener('submit', saveRoster);
    document.getElementById('roster-search').addEventListener('input', event => { ui.rosterSearch = event.target.value; renderRosterDialogList(); });
    document.getElementById('roster-select-all').addEventListener('click', () => document.querySelectorAll('#roster-list input[type="checkbox"]').forEach(input => input.checked = true));
    document.getElementById('roster-clear-all').addEventListener('click', () => document.querySelectorAll('#roster-list input[type="checkbox"]').forEach(input => input.checked = false));
    document.getElementById('copy-day').addEventListener('click', openCopyDayDialog);
    document.getElementById('copy-day-form').addEventListener('submit', copyDayForAll);
    document.getElementById('copy-previous-week').addEventListener('click', copyPreviousWeek);
    document.getElementById('toggle-week-lock').addEventListener('click', toggleWeekLock);
    document.getElementById('week-status-panel').addEventListener('click', event => { if (event.target.closest('[data-toggle-week-lock]')) toggleWeekLock(); });
    document.getElementById('week-lock-banner').addEventListener('click', event => { if (event.target.closest('[data-unlock-week]')) toggleWeekLock(); });

    document.getElementById('day-tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-day]');
      if (!button) return;
      ui.day = Number(button.dataset.day);
      ui.selectedPeople.clear();
      renderPointage();
    });

    document.getElementById('mobile-pointage-summary').addEventListener('click', event => {
      const filter = event.target.closest('[data-mobile-pointage-filter]');
      if (filter) {
        ui.mobilePointageFilter = filter.dataset.mobilePointageFilter;
        renderPointage();
        return;
      }
      const toggle = event.target.closest('[data-mobile-toggle-filters]');
      if (toggle) {
        ui.mobileFiltersOpen = !ui.mobileFiltersOpen;
        renderPointage();
      }
    });

    document.getElementById('people-search').addEventListener('input', event => { ui.peopleSearch = event.target.value; renderPointage(); });
    document.getElementById('type-filter').addEventListener('click', event => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      ui.typeFilter = button.dataset.filter;
      document.querySelectorAll('#type-filter button').forEach(item => item.classList.toggle('active', item === button));
      renderPointage();
    });

    document.getElementById('team-filter').addEventListener('change', event => { ui.teamFilter = event.target.value; ui.selectedPeople.clear(); renderPointage(); });
    document.getElementById('select-filtered-team').addEventListener('click', () => {
      if (!assertWeekEditable()) return;
      const team = (db.teams || []).find(item => item.id === ui.teamFilter);
      if (!team) return;
      const allowed = new Set(activePeople().map(person => person.id));
      ui.selectedPeople = new Set((team.memberIds || []).filter(id => allowed.has(id)));
      ui.selectionMode = true;
      renderPointage();
    });

    document.getElementById('toggle-selection').addEventListener('click', () => {
      ui.selectionMode = !ui.selectionMode;
      if (!ui.selectionMode) ui.selectedPeople.clear();
      renderPointage();
    });
    document.getElementById('clear-selection').addEventListener('click', () => { ui.selectedPeople.clear(); ui.selectionMode = false; renderPointage(); });
    document.getElementById('open-bulk-dialog').addEventListener('click', openBulkDialog);
    document.getElementById('bulk-form').addEventListener('submit', saveBulk);

    document.getElementById('people-grid').addEventListener('click', event => {
      const showAll = event.target.closest('[data-show-all-pointages]');
      if (showAll) { ui.mobilePointageFilter = 'all'; renderPointage(); return; }
      const checkbox = event.target.closest('[data-select-person]');
      if (checkbox) {
        const id = checkbox.dataset.selectPerson;
        checkbox.checked ? ui.selectedPeople.add(id) : ui.selectedPeople.delete(id);
        renderPointage();
        return;
      }
      const edit = event.target.closest('[data-edit-pointage]');
      const card = event.target.closest('.person-card');
      if (!card) return;
      const personId = edit?.dataset.editPointage || card.dataset.personId;
      if (ui.selectionMode && !edit) {
        ui.selectedPeople.has(personId) ? ui.selectedPeople.delete(personId) : ui.selectedPeople.add(personId);
        renderPointage();
      } else {
        openPointageDialog(personId, ui.day);
      }
    });

    document.getElementById('week-table-body').addEventListener('click', event => {
      const button = event.target.closest('[data-week-person]');
      if (button) openPointageDialog(button.dataset.weekPerson, Number(button.dataset.weekDay));
    });
    document.getElementById('alerts-list').addEventListener('click', event => {
      const button = event.target.closest('[data-alert-person]');
      if (button) openPointageDialog(button.dataset.alertPerson, Number(button.dataset.alertDay));
    });

    document.getElementById('pointage-form').addEventListener('submit', savePointage);
    document.getElementById('day-status-options').addEventListener('change', updatePointageStatusDisplay);
    document.getElementById('late-checkbox').addEventListener('change', updatePointageStatusDisplay);
    document.getElementById('add-entry-line').addEventListener('click', () => { syncDraftFromDom(); addDraftLine(); });
    document.getElementById('copy-previous-day').addEventListener('click', copyPreviousDay);
    document.getElementById('entry-lines').addEventListener('input', () => { syncDraftFromDom(); updatePointageDialogTotal(); });
    document.getElementById('entry-lines').addEventListener('change', () => { syncDraftFromDom(); updatePointageDialogTotal(); });
    document.getElementById('entry-lines').addEventListener('click', event => {
      const remove = event.target.closest('.remove-line');
      if (!remove) return;
      const row = remove.closest('.entry-line');
      ui.entryDraft = ui.entryDraft.filter(line => line.draftId !== row.dataset.draftId);
      renderEntryLines();
    });

    document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.dialog)?.close()));

    document.getElementById('add-person').addEventListener('click', () => openPersonDialog());
    document.getElementById('add-person-from-pointage').addEventListener('click', () => openPersonDialog());
    document.getElementById('person-form').addEventListener('submit', savePerson);
    document.getElementById('person-dialog').addEventListener('close', () => { ui.pendingInterimOnboarding = false; });
    document.getElementById('person-type').addEventListener('change', event => {
      if (!document.getElementById('person-id').value) {
        if (event.target.value === 'GCC') {
          document.getElementById('person-company').value = 'GCC';
          [...document.querySelectorAll('.schedule-input')].forEach((input, index) => input.value = (db.defaultSchedules?.GCC || [8, 8, 8, 8, 7])[index]);
        } else {
          if (document.getElementById('person-company').value === 'GCC') document.getElementById('person-company').value = '';
          const scheduleKey = event.target.value === 'Prêt de MO' ? 'PretMO' : 'Interim';
          const fallback = [7.5, 7.5, 7.5, 7.5, 7];
          [...document.querySelectorAll('.schedule-input')].forEach((input, index) => input.value = (db.defaultSchedules?.[scheduleKey] || fallback)[index]);
        }
      }
    });
    document.getElementById('personnel-search').addEventListener('input', event => { ui.personnelSearch = event.target.value; ui.selectedPersonnel.clear(); renderPersonnel(); });
    document.getElementById('show-inactive-people').addEventListener('change', event => { ui.showInactivePeople = event.target.checked; ui.selectedPersonnel.clear(); renderPersonnel(); });
    document.getElementById('toggle-personnel-selection').addEventListener('click', () => {
      ui.personnelSelectionMode = !ui.personnelSelectionMode;
      if (!ui.personnelSelectionMode) ui.selectedPersonnel.clear();
      renderPersonnel();
    });
    document.getElementById('select-all-personnel').addEventListener('change', event => {
      filteredPersonnel().forEach(person => {
        if (event.target.checked) ui.selectedPersonnel.add(person.id);
        else ui.selectedPersonnel.delete(person.id);
      });
      renderPersonnel();
    });
    document.getElementById('clear-personnel-selection').addEventListener('click', () => {
      ui.selectedPersonnel.clear();
      renderPersonnel();
    });
    document.getElementById('bulk-deactivate-personnel').addEventListener('click', () => setPeopleActive(ui.selectedPersonnel, false));
    document.getElementById('bulk-activate-personnel').addEventListener('click', () => setPeopleActive(ui.selectedPersonnel, true));
    document.getElementById('personnel-list').addEventListener('change', event => {
      const checkbox = event.target.closest('[data-select-personnel]');
      if (!checkbox) return;
      if (checkbox.checked) ui.selectedPersonnel.add(checkbox.dataset.selectPersonnel);
      else ui.selectedPersonnel.delete(checkbox.dataset.selectPersonnel);
      renderPersonnel();
    });
    document.getElementById('personnel-list').addEventListener('click', event => {
      const deleteButton = event.target.closest('[data-delete-person]');
      if (deleteButton) {
        deletePerson(deleteButton.dataset.deletePerson);
        return;
      }
      const contractButton = event.target.closest('[data-open-contract-person]');
      if (contractButton) {
        const personId = contractButton.dataset.openContractPerson;
        const contract = latestContractForPerson(personId);
        contract ? openContractDialog(contract.id) : openContractDialog('', personId);
        return;
      }
      const toggleButton = event.target.closest('[data-toggle-person-active]');
      if (toggleButton) {
        const person = getPerson(toggleButton.dataset.togglePersonActive);
        if (person) setPeopleActive([person.id], person.active === false);
        return;
      }
      const button = event.target.closest('[data-edit-person]');
      if (button) openPersonDialog(button.dataset.editPerson);
    });

    document.getElementById('add-team').addEventListener('click', () => openTeamDialog());
    document.getElementById('team-form').addEventListener('submit', saveTeam);
    document.getElementById('team-list').addEventListener('click', event => {
      const point = event.target.closest('[data-point-team]');
      if (point) { ui.teamFilter = point.dataset.pointTeam; ui.view = 'pointage'; setView('pointage'); renderPointage(); return; }
      const edit = event.target.closest('[data-edit-team]');
      if (edit) { openTeamDialog(edit.dataset.editTeam); return; }
      const remove = event.target.closest('[data-delete-team]');
      if (remove) deleteTeam(remove.dataset.deleteTeam);
    });

    document.getElementById('add-interim-onboarding').addEventListener('click', () => { ui.pendingInterimOnboarding = true; openPersonDialog(null, 'Intérim'); });
    document.getElementById('add-contract').addEventListener('click', () => openContractDialog());
    document.getElementById('open-contract-settings').addEventListener('click', () => { renderContractRules(); document.getElementById('contract-rules-dialog').showModal(); });
    document.getElementById('toggle-contract-history').addEventListener('click', () => { ui.showContractHistory = !ui.showContractHistory; renderContracts(); });
    document.getElementById('contract-stats').addEventListener('click', event => { const card = event.target.closest('[data-contract-filter]'); if (!card) return; ui.contractStatusFilter = card.dataset.contractFilter; document.getElementById('contract-status-filter').value = ui.contractStatusFilter; renderContracts(); });
    document.getElementById('delete-contract-dialog').addEventListener('click', event => { const id = event.currentTarget.dataset.contractId; if (!id) return; document.getElementById('contract-dialog').close(); deleteContract(id); });
    document.getElementById('contract-form').addEventListener('submit', saveContract);
    document.getElementById('renewal-form').addEventListener('submit', saveRenewal);
    document.getElementById('contract-rules-form').addEventListener('submit', saveContractRules);
    document.getElementById('contract-search').addEventListener('input', event => { ui.contractSearch = event.target.value; renderContracts(); });
    document.getElementById('contract-status-filter').addEventListener('change', event => { ui.contractStatusFilter = event.target.value; renderContracts(); });
    document.getElementById('contract-person').addEventListener('change', event => {
      const person = getPerson(event.target.value);
      if (person && !document.getElementById('contract-agency').value) document.getElementById('contract-agency').value = person.company || '';
    });
    document.getElementById('contract-list').addEventListener('click', event => {
      const liaison = event.target.closest('[data-open-liaison]');
      if (liaison) { openLiaisonDialog(liaison.dataset.openLiaison); return; }
      const create = event.target.closest('[data-new-contract-person]');
      if (create) { openContractDialog('', create.dataset.newContractPerson); return; }
      const renew = event.target.closest('[data-renew-contract]');
      if (renew) { openRenewalDialog(renew.dataset.renewContract); return; }
      const edit = event.target.closest('[data-edit-contract]');
      if (edit) { openContractDialog(edit.dataset.editContract); return; }
      const remove = event.target.closest('[data-delete-contract]');
      if (remove) deleteContract(remove.dataset.deleteContract);
    });
    document.getElementById('contract-reminder-center').addEventListener('click', event => {
      if (event.target.closest('#enable-reminders-inline')) { requestDeviceNotifications(); return; }
      const liaison = event.target.closest('[data-reminder-liaison]');
      if (liaison) { openLiaisonDialog(liaison.dataset.reminderLiaison); return; }
      const end = event.target.closest('[data-reminder-end]');
      if (end) { openRenewalDialog(end.dataset.reminderEnd); return; }
      const create = event.target.closest('[data-new-contract-person]');
      if (create) openContractDialog('', create.dataset.newContractPerson);
    });
    document.getElementById('liaison-form').addEventListener('submit', saveLiaison);
    document.getElementById('prepare-liaison-email').addEventListener('click', prepareLiaisonEmail);
    document.getElementById('mark-liaison-sent').addEventListener('click', markLiaisonSent);
    document.getElementById('print-liaison-sheet').addEventListener('click', printLiaisonSheet);
    document.getElementById('enable-browser-notifications').addEventListener('click', requestDeviceNotifications);

    document.getElementById('add-task').addEventListener('click', () => openTaskDialog());
    document.getElementById('task-form').addEventListener('submit', saveTask);
    document.getElementById('task-search').addEventListener('input', event => { ui.taskSearch = event.target.value; renderTasks(); });
    document.getElementById('task-list').addEventListener('click', event => {
      const deleteButton = event.target.closest('[data-delete-task]');
      if (deleteButton) {
        deleteTask(deleteButton.dataset.deleteTask);
        return;
      }
      const button = event.target.closest('[data-edit-task]');
      if (button) openTaskDialog(button.dataset.editTask);
    });

    document.getElementById('export-csv').addEventListener('click', exportCsv);
    document.getElementById('export-excel').addEventListener('click', exportExcelXml);
    document.getElementById('export-excel-week').addEventListener('click', exportExcelXml);
    document.getElementById('export-ibat').addEventListener('click', exportIbatWorkbook);
    document.getElementById('share-ibat-secretary').addEventListener('click', shareIbatWithSecretary);
    document.getElementById('share-ibat-week').addEventListener('click', shareIbatWithSecretary);
    document.getElementById('export-json').addEventListener('click', exportJson);
    document.getElementById('import-json-button').addEventListener('click', () => document.getElementById('import-json-file').click());
    document.getElementById('import-json-file').addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) importJsonFile(file);
      event.target.value = '';
    });
    document.getElementById('print-week').addEventListener('click', printWeek);
    document.getElementById('export-pdf').addEventListener('click', printWeek);
    document.getElementById('project-form').addEventListener('submit', saveProject);
    document.getElementById('default-schedules-form').addEventListener('submit', saveDefaultSchedules);
    document.getElementById('apply-default-gcc').addEventListener('click', () => applyDefaultSchedule('GCC'));
    document.getElementById('apply-default-interim').addEventListener('click', () => applyDefaultSchedule('Interim'));
    document.getElementById('apply-default-pretmo').addEventListener('click', () => applyDefaultSchedule('PretMO'));
    document.getElementById('reset-app').addEventListener('click', resetApp);

    document.querySelectorAll('dialog').forEach(dialog => {
      dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
      });
    });
  }

  function syncMobileViewport() {
    const viewport = window.visualViewport;
    const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight);
    const offsetTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
    document.documentElement.style.setProperty('--pointage-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--pointage-viewport-offset-top', `${offsetTop}px`);
  }

  function init() {
    syncMobileViewport();
    window.addEventListener('resize', syncMobileViewport, { passive: true });
    window.addEventListener('orientationchange', syncMobileViewport, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncMobileViewport, { passive: true });
      window.visualViewport.addEventListener('scroll', syncMobileViewport, { passive: true });
    }
    attachEvents();
    renderProjectHome();
    document.getElementById('project-home').hidden = false;
    document.getElementById('app').hidden = true;
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker non enregistré.', error));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
