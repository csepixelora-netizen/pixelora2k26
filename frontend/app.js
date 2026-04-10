window.addEventListener('scroll',()=>document.getElementById('nav').classList.toggle('on',scrollY>60));
function toggleMenu(){document.getElementById('mm').classList.toggle('open')}

/* Universal scroll-reveal: auto-targets ALL revealable elements */
const REVEAL_SEL = '.rv,.ev-card,.com-card,.tm-card,.lead-card,.cdb,.ft-loc-box,.ft-soc,.tl2-card';
function chk(){
  const t = innerHeight * .88;
  document.querySelectorAll(REVEAL_SEL).forEach(el=>{
    if(el.getBoundingClientRect().top < t) el.classList.add('in');
  });
}
addEventListener('scroll', chk, {passive:true});
chk(); /* run on load for above-fold items */

const ti=document.querySelectorAll('.ti');
let ix=0;
if (ti.length) {
  setInterval(()=>{ti[ix].classList.remove('on');ix=(ix+1)%ti.length;ti[ix].classList.add('on')},3500);
}

const end=new Date('2026-04-16T18:00:00').getTime();
function upd(){
  const g=end-Date.now();
  if(g<=0)return;
  const d=Math.floor(g/864e5),h=Math.floor(g%864e5/36e5),m=Math.floor(g%36e5/6e4),s=Math.floor(g%6e4/1e3);
  ['d','h','m','s'].forEach((k,i)=>document.getElementById('cd-'+k).textContent=String([d,h,m,s][i]).padStart(2,'0'));
}
upd();
setInterval(upd,1000);

// Lenis smooth scroll
if (typeof Lenis !== 'undefined') {
  const lenis = new Lenis({ duration: 1.2, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t))});
  function raf(t) { lenis.raf(t); requestAnimationFrame(raf); }
  requestAnimationFrame(raf);
}

// Mouse tracking spotlight
const cg = document.getElementById('cglow');
if (cg) {
  addEventListener('mousemove', (e) => { cg.style.transform = `translate(${e.clientX - 350}px, ${e.clientY - 350}px)`});
}

// Vanilla Tilt 3D Physics (applied to all card types)
if (typeof VanillaTilt !== 'undefined') {
  VanillaTilt.init(document.querySelectorAll('.ev-card, .com-card, .tm-card, .tl2-card, .lead-card, .poster-container'), { max: 7, speed: 400, glare: true, 'max-glare': 0.12, scale: 1.01 });
}

// Registration form submit to backend DB API
const regForm = document.getElementById('reg-form');
const regStatus = document.getElementById('reg-status');
const regSubmit = document.getElementById('reg-submit');
const iplSlotCard = document.getElementById('ipl-slot-card');
const iplSlotForm = document.getElementById('ipl-slot-form');
const iplFormOption = document.getElementById('ipl-form-option');
const adminPortal = document.getElementById('admin-portal');
const adminClose = document.getElementById('admin-close');
const adminRefresh = document.getElementById('admin-refresh');
const adminDownload = document.getElementById('admin-download');
const adminReset = document.getElementById('admin-reset');
const adminSecret = document.getElementById('admin-secret');
const adminStatus = document.getElementById('admin-status');
const adminTableBody = document.getElementById('admin-table-body');

const TEAM_RULES = {
  Innopitch: { min: 1, max: 3 },
  'E-Sports (Free fire)': { min: 4, max: 4 },
  'IPL Auction': { min: 4, max: 4 },
  'Channel Surfing': { min: 2, max: 2 },
  'Visual Content': { min: 3, max: 3 },
  'Visual Connect': { min: 3, max: 3 },
  Devfolio: { min: 1, max: 1 },
  Promptcraft: { min: 1, max: 1 }
};

const TEAM_RULE_ALIAS = {
  'Visual Connect': 'Visual Content'
};

function resolveTeamRuleEventName(eventName) {
  const raw = String(eventName || '').trim();
  return TEAM_RULE_ALIAS[raw] || raw;
}

const IPL_TOTAL_SLOTS = 10;
let iplRegisteredTeams = 0;
let iplStatusPollHandle = null;

const APP_CONFIG = window.__PIXELORA_CONFIG__ || {};
const configuredApiBaseUrl = String(APP_CONFIG.apiBaseUrl || '').trim().replace(/\/+$/, '');
const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocalHost ? '' : configuredApiBaseUrl;
const ADMIN_SHORTCUT_AUTH_KEY = 'pixelora-admin-shortcut-auth';

function buildApiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function getStoredAdminSecret() {
  return (localStorage.getItem('pixelora-admin-secret') || '').trim();
}

function getAdminSecretValue() {
  const savedSecret = localStorage.getItem('pixelora-admin-secret') || '';
  return adminSecret?.value?.trim() || savedSecret;
}

function setAdminStatus(message, type) {
  if (!adminStatus) return;
  adminStatus.textContent = message;
  adminStatus.classList.remove('ok', 'err');
  if (type) adminStatus.classList.add(type);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatAdminTeam(team) {
  if (!team) return '<span>None</span>';
  const members = Array.isArray(team.members) ? team.members.join(', ') : '';
  return `
    <div class="admin-team">
      <strong>${escapeHtml(team.teamName || '—')}</strong>
      <span>Leader: ${escapeHtml(team.teamLeader || '—')}</span>
      <span>Size: ${escapeHtml(team.teamSize || '—')}</span>
      <span>Members: ${escapeHtml(members || '—')}</span>
    </div>
  `;
}

function renderAdminRegistrations(registrations) {
  if (!adminTableBody) return;

  if (!registrations.length) {
    adminTableBody.innerHTML = '<tr><td class="admin-empty" colspan="6">No registrations found.</td></tr>';
    return;
  }

  adminTableBody.innerHTML = registrations.map((registration) => `
    <tr>
      <td>
        <strong>${escapeHtml(registration.name)}</strong><br>
        <span style="opacity:.7">${escapeHtml(registration.email)}</span><br>
        <span style="opacity:.7">${escapeHtml(registration.whatsapp)}</span>
      </td>
      <td>${escapeHtml(registration.year)}</td>
      <td>${formatAdminTeam(registration.technicalTeam)}</td>
      <td>${formatAdminTeam(registration.nonTechnicalTeam)}</td>
      <td>${escapeHtml(registration.food)}</td>
      <td>${escapeHtml(registration.createdAt)}</td>
    </tr>
  `).join('');
}

// Replace placeholder values with your Firebase project config before deployment.
const FIREBASE_CONFIG = {
  apiKey: APP_CONFIG.firebase?.apiKey || 'REPLACE_WITH_API_KEY',
  authDomain: APP_CONFIG.firebase?.authDomain || 'REPLACE_WITH_AUTH_DOMAIN',
  projectId: APP_CONFIG.firebase?.projectId || 'REPLACE_WITH_PROJECT_ID',
  storageBucket: APP_CONFIG.firebase?.storageBucket || 'REPLACE_WITH_STORAGE_BUCKET',
  messagingSenderId: APP_CONFIG.firebase?.messagingSenderId || 'REPLACE_WITH_MESSAGING_SENDER_ID',
  appId: APP_CONFIG.firebase?.appId || 'REPLACE_WITH_APP_ID'
};

function hasFirebaseConfig(config) {
  return Object.values(config).every((value) => value && !String(value).startsWith('REPLACE_WITH_'));
}

let firebaseDb = null;
if (typeof firebase !== 'undefined' && hasFirebaseConfig(FIREBASE_CONFIG)) {
  const app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
  firebaseDb = app.firestore();
}

function normalizeRegistrationRecord(registration) {
  return {
    id: registration.id || '',
    name: registration.name || '',
    email: registration.email || '',
    whatsapp: registration.whatsapp || '',
    year: registration.year || '',
    collegeName: registration.collegeName || '',
    departmentName: registration.departmentName || '',
    technicalEvents: registration.technicalEvents || '',
    technicalTeam: registration.technicalTeam || {},
    nonTechnicalEvents: registration.nonTechnicalEvents || '',
    nonTechnicalTeam: registration.nonTechnicalTeam || {},
    food: registration.food || '',
    paymentScreenshot: registration.paymentScreenshot || '',
    createdAt: registration.createdAt || ''
  };
}

async function loadFirestoreRegistrations() {
  if (!firebaseDb) return [];

  const snapshot = await firebaseDb.collection('registrations').get();
  return snapshot.docs.map((document) => normalizeRegistrationRecord({ id: document.id, ...document.data() }));
}

async function loadAdminRegistrations() {
  if (!adminTableBody) return;

  setAdminStatus('Loading registrations...', null);
  try {
    const response = await fetch(buildApiUrl('/api/admin/registrations'), {
      headers: getAdminSecretValue() ? { 'X-Admin-Secret': getAdminSecretValue() } : {}
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail || result.error || 'Unable to load registrations.');
    }

    const registrations = Array.isArray(result.registrations) ? result.registrations : [];
    if (registrations.length) {
      renderAdminRegistrations(registrations);
      setAdminStatus(`Loaded ${registrations.length} registrations.`, 'ok');
      return;
    }

    const firestoreRegistrations = await loadFirestoreRegistrations();
    renderAdminRegistrations(firestoreRegistrations);
    setAdminStatus(`Loaded ${firestoreRegistrations.length} registrations from Firestore.`, 'ok');
  } catch (error) {
    try {
      const firestoreRegistrations = await loadFirestoreRegistrations();
      renderAdminRegistrations(firestoreRegistrations);
      setAdminStatus(`Loaded ${firestoreRegistrations.length} registrations from Firestore.`, 'ok');
    } catch (_fallbackError) {
      setAdminStatus(error.message || 'Unable to load registrations.', 'err');
      adminTableBody.innerHTML = '<tr><td class="admin-empty" colspan="6">Unable to load registrations.</td></tr>';
    }
  }
}

async function downloadAdminCsv() {
  setAdminStatus('Preparing CSV download...', null);
  try {
    const response = await fetch(buildApiUrl('/api/admin/registrations.csv'), {
      headers: getAdminSecretValue() ? { 'X-Admin-Secret': getAdminSecretValue() } : {}
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.detail || result.error || 'Unable to download CSV.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pixelora-registrations.csv';
    anchor.click();
    URL.revokeObjectURL(url);
    setAdminStatus('CSV download started.', 'ok');
  } catch (error) {
    setAdminStatus(error.message || 'Unable to download CSV.', 'err');
  }
}

function openAdminPortal() {
  if (!adminPortal) return;
  adminPortal.classList.add('open');
  adminPortal.setAttribute('aria-hidden', 'false');
  const savedSecret = localStorage.getItem('pixelora-admin-secret') || '';
  if (adminSecret) {
    adminSecret.value = savedSecret;
    adminSecret.focus();
  }
  loadAdminRegistrations();
}

function closeAdminPortal() {
  if (!adminPortal) return;
  adminPortal.classList.remove('open');
  adminPortal.setAttribute('aria-hidden', 'true');
}

function getIplSlotsLeft() {
  return Math.max(0, IPL_TOTAL_SLOTS - iplRegisteredTeams);
}

function applyIplSlotStatus(status) {
  const registered = Number(status?.registered || 0);
  iplRegisteredTeams = Math.min(IPL_TOTAL_SLOTS, Math.max(0, registered));
  updateIplSlotUI();
}

async function loadIplSlotStatus() {
  try {
    const response = await fetch(buildApiUrl('/api/slots/ipl-auction'));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail || result.error || 'Unable to load slot status.');
    }

    applyIplSlotStatus(result);
    if (typeof updateRegistrationDomFromState === 'function') {
      updateRegistrationDomFromState();
    }
  } catch (_error) {
    updateIplSlotUI();
    if (typeof updateRegistrationDomFromState === 'function') {
      updateRegistrationDomFromState();
    }
  }
}

function updateFomoStrip() {
  const el = document.getElementById('fomo-text');
  if (!el) return;
  const left = getIplSlotsLeft();
  const parts = [];
  if (left > 0 && left <= 4) {
    parts.push(`IPL Auction: only ${left} team slot${left === 1 ? '' : 's'} left.`);
  }
  parts.push('Online registration is limited — secure your spot before the countdown hits zero.');
  el.textContent = parts.join(' ');
}

function updateIplSlotUI() {
  const left = getIplSlotsLeft();

  if (iplSlotCard) {
    iplSlotCard.textContent = left > 0 ? `Slots Left: ${left}` : 'Slots Left: 0 (Full)';
    iplSlotCard.classList.toggle('full', left <= 0);
  }

  if (iplSlotForm) {
    iplSlotForm.textContent = left > 0 ? `(${left} slots left)` : '(Full)';
  }

  if (iplFormOption) {
    if (left <= 0) {
      const selected = iplFormOption.querySelector('input[type="radio"]');
      if (selected) selected.checked = false;
      iplFormOption.style.display = 'none';
    } else {
      iplFormOption.style.display = 'flex';
    }
  }

  updateFomoStrip();
}

function watchIplSlots() {
  loadIplSlotStatus();

  if (iplStatusPollHandle) {
    clearInterval(iplStatusPollHandle);
  }

  iplStatusPollHandle = setInterval(loadIplSlotStatus, 30000);
}

watchIplSlots();

if (adminSecret) {
  adminSecret.addEventListener('input', () => {
    localStorage.setItem('pixelora-admin-secret', adminSecret.value.trim());
  });
}

if (adminClose) {
  adminClose.addEventListener('click', closeAdminPortal);
}

if (adminRefresh) {
  adminRefresh.addEventListener('click', loadAdminRegistrations);
}

if (adminDownload) {
  adminDownload.addEventListener('click', downloadAdminCsv);
}

async function resetAllRegistrations() {
  const adminSecretValue = getAdminSecretValue();
  if (!adminSecretValue) {
    setAdminStatus('Admin secret is required to delete data.', 'err');
    return;
  }

  const confirmed = window.confirm('Delete all registrations and reset IPL slots back to 10?');
  if (!confirmed) return;

  setAdminStatus('Deleting all registration data...', null);
  try {
    const response = await fetch(buildApiUrl('/api/admin/registrations'), {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': adminSecretValue }
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail || result.error || 'Unable to delete registrations.');
    }

    applyIplSlotStatus(result);
    await loadAdminRegistrations();
    setAdminStatus('All registrations deleted. IPL slots are reset to 10.', 'ok');
  } catch (error) {
    setAdminStatus(error.message || 'Unable to delete registrations.', 'err');
  }
}

if (adminReset) {
  adminReset.addEventListener('click', resetAllRegistrations);
}

const ADMIN_SURFACE_GATE_KEY = 'pixelora-admin-surface-gate';
const ADMIN_PORTAL_MODE_KEY = 'pixelora-admin-mode';
const COORDINATOR_SESSION_KEY = 'pixelora-coordinator-session';
const ADMIN_SURFACE_PASSWORD = 'CSE';
const ADMIN_HOTZONE_TAPS = 3;
const ADMIN_HOTZONE_WINDOW_MS = 2000;

const adminAccessHotzone = document.getElementById('admin-access-hotzone');
const adminGateDialog = document.getElementById('admin-gate-dialog');
const adminGatePass = document.getElementById('admin-gate-pass');
const adminGateErr = document.getElementById('admin-gate-err');
const adminGateSubmit = document.getElementById('admin-gate-submit');
const adminGateCancel = document.getElementById('admin-gate-cancel');
const adminGateBackdrop = document.getElementById('admin-gate-backdrop');
const adminGateStepPassword = document.getElementById('admin-gate-step-password');
const adminGateStepRole = document.getElementById('admin-gate-step-role');
const adminGateStepCoord = document.getElementById('admin-gate-step-coord');
const adminGateStepFullSecret = document.getElementById('admin-gate-step-fullsecret');
const adminGateRoleFull = document.getElementById('admin-gate-role-full');
const adminGateRoleCoord = document.getElementById('admin-gate-role-coord');
const adminGateBackRole = document.getElementById('admin-gate-back-role');
const adminGateCoordEvent = document.getElementById('admin-gate-coord-event');
const adminGateCoordContinue = document.getElementById('admin-gate-coord-continue');
const adminGateBackCoord = document.getElementById('admin-gate-back-coord');
const adminGateCoordErr = document.getElementById('admin-gate-coord-err');
const adminGateAdminSecret = document.getElementById('admin-gate-admin-secret');
const adminGateFullContinue = document.getElementById('admin-gate-full-continue');
const adminGateBackFull = document.getElementById('admin-gate-back-full');
const adminGateCancelFull = document.getElementById('admin-gate-cancel-full');
const adminGateAdminErr = document.getElementById('admin-gate-admin-err');

const adminHotzoneTapTimes = [];
let adminGateBackdropDismissOk = false;
let adminGateBackdropPointerTimer = 0;

function scheduleAdminGateFocus(el, ms) {
  window.setTimeout(() => el?.focus(), ms);
}

function hideAllAdminGateErrors() {
  [adminGateErr, adminGateCoordErr, adminGateAdminErr].forEach((el) => {
    if (!el) return;
    el.textContent = '';
    el.classList.add('is-hidden');
  });
}

function showAdminGateStep(step) {
  const steps = {
    password: adminGateStepPassword,
    role: adminGateStepRole,
    coord: adminGateStepCoord,
    fullsecret: adminGateStepFullSecret
  };
  Object.values(steps).forEach((el) => el?.classList.add('is-hidden'));
  steps[step]?.classList.remove('is-hidden');
}

function registerAdminHotzoneTap() {
  const now = Date.now();
  adminHotzoneTapTimes.push(now);
  while (adminHotzoneTapTimes.length && now - adminHotzoneTapTimes[0] > ADMIN_HOTZONE_WINDOW_MS) {
    adminHotzoneTapTimes.shift();
  }
  if (adminHotzoneTapTimes.length >= ADMIN_HOTZONE_TAPS) {
    adminHotzoneTapTimes.length = 0;
    openAdminSurfaceGateDialog();
    return true;
  }
  return false;
}

function openAdminSurfaceGateDialog() {
  if (!adminGateDialog) return;
  adminGateBackdropDismissOk = false;
  if (adminGateBackdropPointerTimer) {
    clearTimeout(adminGateBackdropPointerTimer);
    adminGateBackdropPointerTimer = 0;
  }
  adminGateDialog.classList.remove('is-hidden');
  hideAllAdminGateErrors();
  if (adminGatePass) adminGatePass.value = '';
  if (adminGateCoordEvent) adminGateCoordEvent.value = '';
  if (adminGateAdminSecret) adminGateAdminSecret.value = '';
  showAdminGateStep('password');
  if (adminGateBackdrop) {
    adminGateBackdrop.style.pointerEvents = 'none';
  }
  adminGateBackdropPointerTimer = window.setTimeout(() => {
    adminGateBackdropPointerTimer = 0;
    if (adminGateBackdrop) {
      adminGateBackdrop.style.pointerEvents = '';
    }
    adminGateBackdropDismissOk = true;
    adminGatePass?.focus();
  }, 450);
}

function closeAdminSurfaceGateDialog() {
  adminGateBackdropDismissOk = false;
  if (adminGateBackdropPointerTimer) {
    clearTimeout(adminGateBackdropPointerTimer);
    adminGateBackdropPointerTimer = 0;
  }
  if (adminGateBackdrop) {
    adminGateBackdrop.style.pointerEvents = '';
  }
  adminGateDialog?.classList.add('is-hidden');
  showAdminGateStep('password');
}

function goToRoleStepAfterPassword() {
  hideAllAdminGateErrors();
  showAdminGateStep('role');
  scheduleAdminGateFocus(adminGateRoleFull, 60);
}

async function submitCoordinatorGatePath() {
  const SR = window.PixeloraSharedReg;
  if (!SR || typeof SR.extractEventCatalog !== 'function') {
    if (adminGateCoordErr) {
      adminGateCoordErr.textContent = 'Unable to load registration helpers.';
      adminGateCoordErr.classList.remove('is-hidden');
    }
    return;
  }
  const rawVal = String(adminGateCoordEvent?.value || '').trim();
  const key = SR.normalizeEventCatalogKey(rawVal);
  if (!key) {
    if (adminGateCoordErr) {
      adminGateCoordErr.textContent = 'Enter an event name.';
      adminGateCoordErr.classList.remove('is-hidden');
    }
    return;
  }
  if (adminGateCoordContinue) adminGateCoordContinue.disabled = true;
  try {
    const response = await fetch(buildApiUrl('/api/surface/registrations'), {
      headers: { 'X-Surface-Auth': ADMIN_SURFACE_PASSWORD }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof result.detail === 'string' ? result.detail : 'Unable to load events.';
      throw new Error(detail);
    }
    const registrations = Array.isArray(result.registrations) ? result.registrations : [];
    const catalog = SR.extractEventCatalog(registrations);
    if (!catalog.has(key)) {
      if (adminGateCoordErr) {
        adminGateCoordErr.textContent = 'No match for that event in current registrations.';
        adminGateCoordErr.classList.remove('is-hidden');
      }
      return;
    }
    const label = catalog.get(key) || rawVal;
    sessionStorage.setItem(
      COORDINATOR_SESSION_KEY,
      JSON.stringify({ t: Date.now(), eventNorm: key, eventLabel: label })
    );
    closeAdminSurfaceGateDialog();
    window.location.href = 'coordinator.html';
  } catch (err) {
    if (adminGateCoordErr) {
      adminGateCoordErr.textContent = err.message || 'Request failed.';
      adminGateCoordErr.classList.remove('is-hidden');
    }
  } finally {
    if (adminGateCoordContinue) adminGateCoordContinue.disabled = false;
  }
}

async function submitFullAdminGatePath() {
  const secret = String(adminGateAdminSecret?.value || '').trim();
  if (!secret) {
    if (adminGateAdminErr) {
      adminGateAdminErr.textContent = 'Admin secret is required.';
      adminGateAdminErr.classList.remove('is-hidden');
    }
    return;
  }
  if (adminGateFullContinue) adminGateFullContinue.disabled = true;
  hideAllAdminGateErrors();
  try {
    const response = await fetch(buildApiUrl('/api/admin/registrations'), {
      headers: { 'X-Admin-Secret': secret }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof result.detail === 'string' ? result.detail : 'Invalid admin secret.';
      throw new Error(detail);
    }
    sessionStorage.setItem(ADMIN_SURFACE_GATE_KEY, JSON.stringify({ t: Date.now() }));
    sessionStorage.setItem(ADMIN_PORTAL_MODE_KEY, 'full');
    closeAdminSurfaceGateDialog();
    window.location.href = 'admin.html';
  } catch (err) {
    if (adminGateAdminErr) {
      adminGateAdminErr.textContent = err.message || 'Access denied.';
      adminGateAdminErr.classList.remove('is-hidden');
    }
  } finally {
    if (adminGateFullContinue) adminGateFullContinue.disabled = false;
  }
}

if (adminAccessHotzone) {
  adminAccessHotzone.addEventListener(
    'pointerdown',
    (e) => {
      const opened = registerAdminHotzoneTap();
      if (opened) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { passive: false }
  );
}

if (adminGateSubmit) {
  adminGateSubmit.addEventListener('click', () => {
    const v = String(adminGatePass?.value || '').trim();
    if (v === ADMIN_SURFACE_PASSWORD) {
      goToRoleStepAfterPassword();
      return;
    }
    if (adminGateErr) {
      adminGateErr.textContent = 'Incorrect password.';
      adminGateErr.classList.remove('is-hidden');
    }
  });
}

if (adminGateCancel) {
  adminGateCancel.addEventListener('click', closeAdminSurfaceGateDialog);
}
if (adminGateCancelFull) {
  adminGateCancelFull.addEventListener('click', closeAdminSurfaceGateDialog);
}
if (adminGateBackdrop) {
  adminGateBackdrop.addEventListener('click', (e) => {
    if (!adminGateBackdropDismissOk) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    closeAdminSurfaceGateDialog();
  });
}
if (adminGatePass) {
  adminGatePass.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      adminGateSubmit?.click();
    }
    if (e.key === 'Escape') closeAdminSurfaceGateDialog();
  });
}

adminGateRoleFull?.addEventListener('click', () => {
  hideAllAdminGateErrors();
  showAdminGateStep('fullsecret');
  scheduleAdminGateFocus(adminGateAdminSecret, 60);
});

adminGateRoleCoord?.addEventListener('click', () => {
  hideAllAdminGateErrors();
  showAdminGateStep('coord');
  scheduleAdminGateFocus(adminGateCoordEvent, 60);
});

adminGateBackRole?.addEventListener('click', () => {
  hideAllAdminGateErrors();
  showAdminGateStep('password');
  scheduleAdminGateFocus(adminGatePass, 60);
});

adminGateBackCoord?.addEventListener('click', () => {
  hideAllAdminGateErrors();
  showAdminGateStep('role');
  scheduleAdminGateFocus(adminGateRoleFull, 60);
});

adminGateBackFull?.addEventListener('click', () => {
  hideAllAdminGateErrors();
  showAdminGateStep('role');
  scheduleAdminGateFocus(adminGateRoleFull, 60);
});

adminGateCoordContinue?.addEventListener('click', () => {
  void submitCoordinatorGatePath();
});

adminGateCoordEvent?.addEventListener('input', () => {
  adminGateCoordEvent.value = String(adminGateCoordEvent.value || '').toUpperCase();
});

adminGateCoordEvent?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void submitCoordinatorGatePath();
  }
  if (e.key === 'Escape') closeAdminSurfaceGateDialog();
});

adminGateFullContinue?.addEventListener('click', () => {
  void submitFullAdminGatePath();
});

adminGateAdminSecret?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void submitFullAdminGatePath();
  }
  if (e.key === 'Escape') closeAdminSurfaceGateDialog();
});

[adminGateStepRole, adminGateStepCoord, adminGateStepFullSecret].forEach((el) => {
  el?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAdminSurfaceGateDialog();
  });
});

const REG_SESSION_STORAGE_KEY = 'pixelora-registration-session';
const REGISTRATION_STEP_IDS = [1, 2, 3, 4];
const MEMBER_ID_PREFIX = 'TEMP';
const CATEGORY_EVENTS = {
  technical: [
    { value: 'Innopitch', label: 'Innopitch' },
    { value: 'Devfolio', label: 'Devfolio' },
    { value: 'Promptcraft', label: 'Promptcraft' }
  ],
  nontechnical: [
    { value: 'E-Sports (Free fire)', label: 'E-Sports (Free fire)' },
    { value: 'IPL Auction', label: 'IPL Auction' },
    { value: 'Visual Content', label: 'Visual Content' },
    { value: 'Channel Surfing', label: 'Channel Surfing' }
  ]
};
/** UPI-registered number shown on the payment step and embedded in the pay-to QR. */
const UPI_NUMBER = '26666671';
const PAYMENT_PER_HEAD = 150;

const registrationDom = {
  mainId: document.getElementById('session-main-id'),
  progress: document.getElementById('reg-progress'),
  stepButtons: Array.from(document.querySelectorAll('[data-step-nav]')),
  stepSections: Array.from(document.querySelectorAll('.reg-step')),
  step1Continue: document.getElementById('reg-step1-continue'),
  step2Back: document.getElementById('reg-step2-back'),
  step2Continue: document.getElementById('reg-step2-continue'),
  step3Back: document.getElementById('reg-step3-back'),
  step3Continue: document.getElementById('reg-step3-continue'),
  step4Back: document.getElementById('reg-step4-back'),
  eventSummary: document.getElementById('event-summary'),
  teamNote: document.getElementById('team-note'),
  memberList: document.getElementById('member-list'),
  memberEditor: document.getElementById('member-editor'),
  memberEditorTitle: document.getElementById('member-editor-title'),
  memberEditorHint: document.getElementById('member-editor-hint'),
  memberName: document.getElementById('member-name'),
  memberEmail: document.getElementById('member-email'),
  memberPhone: document.getElementById('member-phone'),
  memberId: document.getElementById('member-id'),
  memberFood: document.getElementById('member-food'),
  memberEventFields: document.getElementById('member-event-fields'),
  memberAddBtn: document.getElementById('member-add-btn'),
  memberSaveBtn: document.getElementById('member-save-btn'),
  memberCancelBtn: document.getElementById('member-cancel-btn'),
  finalReview: document.getElementById('final-review'),
  paymentTotal: document.getElementById('payment-total'),
  paymentQr: document.getElementById('payment-qr'),
  upiIdText: document.getElementById('upi-id-text'),
  technicalEventsGroup: document.getElementById('technical-events-group'),
  nonTechnicalEventsGroup: document.getElementById('nontechnical-events-group')
};

const registrationInputs = {
  name: regForm?.elements.namedItem('name'),
  email: regForm?.elements.namedItem('email'),
  whatsapp: regForm?.elements.namedItem('whatsapp'),
  year: regForm?.elements.namedItem('year'),
  collegeName: regForm?.elements.namedItem('collegeName'),
  departmentName: regForm?.elements.namedItem('departmentName'),
  food: regForm?.elements.namedItem('food'),
  registrationTrack: Array.from(regForm?.querySelectorAll('input[name="registrationTrack"]') || []),
  technicalEvents: Array.from(regForm?.querySelectorAll('input[name="technicalEvents"]') || []),
  nonTechnicalEvents: Array.from(regForm?.querySelectorAll('input[name="nonTechnicalEvents"]') || []),
  paymentScreenshot: regForm?.elements.namedItem('paymentScreenshot')
};

const blankMainUser = () => ({
  memberId: '',
  name: '',
  email: '',
  whatsapp: '',
  year: '',
  collegeName: '',
  departmentName: '',
  food: ''
});

const blankMemberDraft = (memberId) => ({
  memberId,
  name: '',
  email: '',
  phone: '',
  food: '',
  technical_used: false,
  nontechnical_used: false,
  technicalEvent: '',
  nonTechnicalEvent: ''
});

let registrationState = loadRegistrationState();

function setRegStatus(message, type) {
  if (!regStatus) return;
  regStatus.textContent = message;
  regStatus.classList.remove('ok', 'err');
  if (type) regStatus.classList.add(type);
}

function getTeamRule(eventName) {
  const key = resolveTeamRuleEventName(eventName);
  return TEAM_RULES[key] || { min: 1, max: 1 };
}

function createEmptyRegistrationState() {
  return {
    version: 1,
    step: 1,
    nextMemberIndex: 2,
    mainUser: blankMainUser(),
    registrationTrack: 'both',
    selectedEvents: { technical: '', nonTechnical: '' },
    teamMembers: [],
    draftMember: null,
    updatedAt: ''
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMember(member) {
  return {
    memberId: String(member?.memberId || '').trim(),
    name: String(member?.name || '').trim(),
    email: String(member?.email || '').trim(),
    phone: String(member?.phone || '').trim(),
    food: String(member?.food || '').trim(),
    technical_used: Boolean(member?.technical_used),
    nontechnical_used: Boolean(member?.nontechnical_used),
    technicalEvent: String(member?.technicalEvent || '').trim(),
    nonTechnicalEvent: String(member?.nonTechnicalEvent || '').trim()
  };
}

function normalizeRegistrationState(rawState) {
  const defaultState = createEmptyRegistrationState();
  if (!rawState || typeof rawState !== 'object') return defaultState;

  const state = {
    ...defaultState,
    ...rawState,
    mainUser: { ...defaultState.mainUser, ...(rawState.mainUser || {}) },
    selectedEvents: { ...defaultState.selectedEvents, ...(rawState.selectedEvents || {}) },
    teamMembers: Array.isArray(rawState.teamMembers) ? rawState.teamMembers.map(normalizeMember).filter((member) => member.memberId) : [],
    draftMember: rawState.draftMember ? normalizeMember(rawState.draftMember) : null
  };

  state.registrationTrack = ['both', 'technical', 'nontechnical'].includes(String(rawState.registrationTrack || '').toLowerCase())
    ? String(rawState.registrationTrack).toLowerCase()
    : 'both';

  state.step = REGISTRATION_STEP_IDS.includes(Number(state.step)) ? Number(state.step) : 1;

  if (!state.mainUser.memberId && hasRegistrationMainUserData(state.mainUser)) {
    state.mainUser.memberId = `${MEMBER_ID_PREFIX}001`;
  }

  const memberNumbers = [
    memberNumberFromId(state.mainUser.memberId),
    ...state.teamMembers.map((member) => memberNumberFromId(member.memberId)),
    memberNumberFromId(state.draftMember?.memberId)
  ].filter((value) => value > 0);

  const maxMemberNumber = memberNumbers.length ? Math.max(...memberNumbers) : 1;
  state.nextMemberIndex = Math.max(Number(state.nextMemberIndex || 0), maxMemberNumber + 1, state.mainUser.memberId ? 2 : 1);
  state.nextMemberIndex = Math.max(state.nextMemberIndex, 2);

  return state;
}

function loadRegistrationState() {
  try {
    return normalizeRegistrationState(JSON.parse(localStorage.getItem(REG_SESSION_STORAGE_KEY) || 'null'));
  } catch (_error) {
    return createEmptyRegistrationState();
  }
}

function persistRegistrationState() {
  registrationState.updatedAt = new Date().toISOString();
  localStorage.setItem(REG_SESSION_STORAGE_KEY, JSON.stringify(registrationState));
}

function clearRegistrationState() {
  registrationState = createEmptyRegistrationState();
  localStorage.removeItem(REG_SESSION_STORAGE_KEY);
}

function memberNumberFromId(memberId) {
  const match = String(memberId || '').match(/^(?:TEMP)(\d{3,})$/i);
  return match ? Number(match[1]) : 0;
}

function createNextMemberId() {
  const nextIndex = Math.max(Number(registrationState.nextMemberIndex || 2), 2);
  registrationState.nextMemberIndex = nextIndex + 1;
  return `${MEMBER_ID_PREFIX}${String(nextIndex).padStart(3, '0')}`;
}

function hasRegistrationMainUserData(mainUser) {
  return Boolean(
    String(mainUser?.name || '').trim() ||
    String(mainUser?.email || '').trim() ||
    String(mainUser?.whatsapp || '').trim() ||
    String(mainUser?.year || '').trim() ||
    String(mainUser?.collegeName || '').trim() ||
    String(mainUser?.departmentName || '').trim() ||
    String(mainUser?.food || '').trim()
  );
}

function normalizeComparablePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function isTeamEvent(eventName) {
  return (getTeamRule(eventName).max || 1) > 1;
}

function getSelectedTrack() {
  return String(registrationState.registrationTrack || 'both').toLowerCase();
}

function isTrackEnabled(trackName) {
  const selectedTrack = getSelectedTrack();
  if (selectedTrack === 'both') return true;
  return selectedTrack === trackName;
}

function getSelectedEvent(category) {
  return String(registrationState.selectedEvents?.[category === 'technical' ? 'technical' : 'nonTechnical'] || '').trim();
}

function getTeamEventMembers(category, eventName) {
  const want = String(eventName || '').trim();
  return registrationState.teamMembers.filter((member) => {
    if (category === 'technical') return String(member.technicalEvent || '').trim() === want;
    return String(member.nonTechnicalEvent || '').trim() === want;
  });
}

function countTeammatesForEventOnPool(memberList, category, eventName) {
  const want = String(eventName || '').trim();
  return memberList.filter((member) => {
    if (category === 'technical') return String(member.technicalEvent || '').trim() === want;
    return String(member.nonTechnicalEvent || '').trim() === want;
  }).length;
}

function validateMemberTeamCapacity(memberDraft) {
  const excludeId = memberDraft.memberId;
  const simulated = registrationState.teamMembers
    .filter((m) => m.memberId !== excludeId)
    .concat([
      {
        ...memberDraft,
        technical_used: Boolean(memberDraft.technicalEvent),
        nontechnical_used: Boolean(memberDraft.nonTechnicalEvent)
      }
    ]);

  const check = (category, selectedEvent) => {
    const ev = String(selectedEvent || '').trim();
    if (!ev || !isTeamEvent(ev)) return '';
    const rule = getTeamRule(ev);
    const cap = Math.max(0, rule.max - 1);
    const n = countTeammatesForEventOnPool(simulated, category, ev);
    if (n > cap) {
      return `${ev} allows at most ${cap} teammate(s) besides the leader (${rule.max} total including you).`;
    }
    return '';
  };

  return (
    check('technical', getSelectedEvent('technical')) || check('nontechnical', getSelectedEvent('nontechnical')) || ''
  );
}

function validateTeamMaxSizes() {
  const pool = registrationState.teamMembers;
  const check = (category, selectedEvent) => {
    const ev = String(selectedEvent || '').trim();
    if (!ev || !isTeamEvent(ev)) return '';
    const rule = getTeamRule(ev);
    const cap = Math.max(0, rule.max - 1);
    const n = countTeammatesForEventOnPool(pool, category, ev);
    if (n > cap) {
      return `${ev} has too many teammates (${n}). Maximum is ${cap} besides the leader (${rule.max} including you). Remove or reassign members.`;
    }
    return '';
  };
  return check('technical', getSelectedEvent('technical')) || check('nontechnical', getSelectedEvent('nontechnical')) || '';
}

function canAddAnotherPoolMember() {
  const tech = getSelectedEvent('technical');
  const nt = getSelectedEvent('nontechnical');
  const techEnabled = Boolean(tech) && isTeamEvent(tech);
  const ntEnabled = Boolean(nt) && isTeamEvent(nt);
  if (!techEnabled && !ntEnabled) return false;

  const techHasRoom =
    !techEnabled || getTeamEventMembers('technical', tech).length < getTeamRule(tech).max - 1;
  const ntHasRoom = !ntEnabled || getTeamEventMembers('nontechnical', nt).length < getTeamRule(nt).max - 1;

  if (techEnabled && ntEnabled) return techHasRoom || ntHasRoom;
  if (techEnabled) return techHasRoom;
  if (ntEnabled) return ntHasRoom;
  return false;
}

function syncMemberAddButtonState() {
  if (!registrationDom.memberAddBtn) return;
  const canAdd = canAddAnotherPoolMember();
  registrationDom.memberAddBtn.disabled = !canAdd;
  registrationDom.memberAddBtn.title = canAdd
    ? ''
    : 'Roster is full for your selected event(s). Remove a member or change events to add more.';
}

function getTeamRequirement(category) {
  const eventName = getSelectedEvent(category);
  if (!eventName || !isTeamEvent(eventName)) {
    return { eventName, requiredMembers: 0, totalMin: 1, totalMax: 1, assignedMembers: [] };
  }

  const rule = getTeamRule(eventName);
  const assignedMembers = getTeamEventMembers(category, eventName);
  return {
    eventName,
    requiredMembers: Math.max(0, rule.min - 1),
    totalMin: rule.min,
    totalMax: rule.max,
    assignedMembers
  };
}

function renderEventSummary() {
  if (!registrationDom.eventSummary || !registrationDom.teamNote) return;

  const technicalEvent = getSelectedEvent('technical');
  const nonTechnicalEvent = getSelectedEvent('nontechnical');
  const technicalRequirement = getTeamRequirement('technical');
  const nonTechnicalRequirement = getTeamRequirement('nontechnical');
  const needsMemberStep = shouldShowMemberStep();

  const techCap =
    technicalRequirement.totalMax > 1
      ? ` Max ${technicalRequirement.totalMax} including you (add up to ${technicalRequirement.totalMax - 1} teammate${technicalRequirement.totalMax - 1 === 1 ? '' : 's'}).`
      : ' Solo — main participant only.';
  const ntCap =
    nonTechnicalRequirement.totalMax > 1
      ? ` Max ${nonTechnicalRequirement.totalMax} including you (add up to ${nonTechnicalRequirement.totalMax - 1} teammate${nonTechnicalRequirement.totalMax - 1 === 1 ? '' : 's'}).`
      : ' Solo — main participant only.';

  registrationDom.eventSummary.innerHTML = `
    <div class="review-grid">
      <div class="review-card">
        <h5>Technical</h5>
        <p>${escapeHtml(technicalEvent || 'Not selected')}</p>
        <p>${technicalRequirement.totalMin > 1 ? `At least ${technicalRequirement.requiredMembers} teammate${technicalRequirement.requiredMembers === 1 ? '' : 's'} besides you.` : 'No extra teammates required.'}${techCap}</p>
      </div>
      <div class="review-card">
        <h5>Non-Technical</h5>
        <p>${escapeHtml(nonTechnicalEvent || 'Not selected')}</p>
        <p>${nonTechnicalRequirement.totalMin > 1 ? `At least ${nonTechnicalRequirement.requiredMembers} teammate${nonTechnicalRequirement.requiredMembers === 1 ? '' : 's'} besides you.` : 'No extra teammates required.'}${ntCap}</p>
      </div>
    </div>
  `;

  const lines = [];
  if (technicalRequirement.eventName) {
    lines.push(`<strong>${escapeHtml(technicalRequirement.eventName)}</strong>: ${technicalRequirement.assignedMembers.length}/${technicalRequirement.requiredMembers} teammate${technicalRequirement.requiredMembers === 1 ? '' : 's'} added.`);
  }
  if (nonTechnicalRequirement.eventName) {
    lines.push(`<strong>${escapeHtml(nonTechnicalRequirement.eventName)}</strong>: ${nonTechnicalRequirement.assignedMembers.length}/${nonTechnicalRequirement.requiredMembers} teammate${nonTechnicalRequirement.requiredMembers === 1 ? '' : 's'} added.`);
  }

  registrationDom.teamNote.innerHTML = lines.length
    ? lines.join('<br>')
    : (needsMemberStep ? 'Add members if your chosen events need a team.' : 'You can continue directly to review.');
}

function renderMemberEventFields(memberDraft) {
  if (!registrationDom.memberEventFields) return;

  const selectedTechnicalEvent = getSelectedEvent('technical');
  const technicalTeamEnabled = Boolean(selectedTechnicalEvent) && isTeamEvent(selectedTechnicalEvent);
  const selectedNonTechnicalEvent = getSelectedEvent('nontechnical');
  const nonTechnicalTeamEnabled = Boolean(selectedNonTechnicalEvent) && isTeamEvent(selectedNonTechnicalEvent);

  let technicalEventHtml = '';
  if (technicalTeamEnabled) {
    technicalEventHtml = `
      <div class="member-event-group">
        <h6>Technical Event</h6>
        <div class="reg-field">
          <span>Select the technical team event for this member</span>
          <select id="member-technical-event" name="memberTechnicalEvent">
            <option value="">Select event</option>
            <option value="${escapeHtml(selectedTechnicalEvent)}" ${memberDraft.technicalEvent === selectedTechnicalEvent ? 'selected' : ''}>${escapeHtml(selectedTechnicalEvent)}</option>
          </select>
        </div>
      </div>
    `;
  }

  let nonTechnicalEventHtml = '';
  if (nonTechnicalTeamEnabled) {
    nonTechnicalEventHtml = `
      <div class="member-event-group">
        <h6>Non-Technical Event</h6>
        <div class="reg-field">
          <span>Select the non-technical team event for this member</span>
          <select id="member-nontechnical-event" name="memberNonTechnicalEvent">
            <option value="">Select event</option>
            <option value="${escapeHtml(selectedNonTechnicalEvent)}" ${memberDraft.nonTechnicalEvent === selectedNonTechnicalEvent ? 'selected' : ''}>${escapeHtml(selectedNonTechnicalEvent)}</option>
          </select>
        </div>
      </div>
    `;
  }

  registrationDom.memberEventFields.innerHTML = `${technicalEventHtml}${nonTechnicalEventHtml}` || '<p class="member-empty">No team event is selected.</p>';

  const technicalSelect = document.getElementById('member-technical-event');
  if (technicalSelect) {
    technicalSelect.addEventListener('change', (event) => {
      registrationState.draftMember.technicalEvent = String(event.target.value || '').trim();
      registrationState.draftMember.technical_used = Boolean(registrationState.draftMember.technicalEvent);
      persistRegistrationState();
      renderRegistrationWizard();
    });
  }

  const nonTechnicalSelect = document.getElementById('member-nontechnical-event');
  if (nonTechnicalSelect) {
    nonTechnicalSelect.addEventListener('change', (event) => {
      registrationState.draftMember.nonTechnicalEvent = String(event.target.value || '').trim();
      registrationState.draftMember.nontechnical_used = Boolean(registrationState.draftMember.nonTechnicalEvent);
      persistRegistrationState();
      renderRegistrationWizard();
    });
  }
}

function renderMemberList() {
  if (!registrationDom.memberList) return;

  if (!registrationState.teamMembers.length) {
    registrationDom.memberList.innerHTML = '<div class="member-empty">No members added yet. Use Add Member to build the session list.</div>';
    return;
  }

  registrationDom.memberList.innerHTML = registrationState.teamMembers.map((member) => `
    <article class="member-card">
      <div class="member-card-head">
        <div class="member-card-title">
          <strong>${escapeHtml(member.name || 'Unnamed member')}</strong>
          <span>${escapeHtml(member.memberId)}</span>
        </div>
        <div class="member-actions">
          <button type="button" class="member-edit" data-member-edit="${escapeHtml(member.memberId)}">Edit</button>
          <button type="button" class="member-remove" data-member-remove="${escapeHtml(member.memberId)}">Remove</button>
        </div>
      </div>
      <div class="member-tag-row">
        <span class="member-tag">${escapeHtml(member.email || 'No email')}</span>
        <span class="member-tag">${escapeHtml(member.phone || 'No phone')}</span>
      </div>
      <div class="member-tag-row">
        <span class="member-tag">Tech: ${escapeHtml(member.technicalEvent || 'None')}</span>
        <span class="member-tag">Non-Tech: ${escapeHtml(member.nonTechnicalEvent || 'None')}</span>
      </div>
      <div class="member-tag-row">
        <span class="member-tag">Food: ${escapeHtml(member.food || 'Not selected')}</span>
      </div>
    </article>
  `).join('');

  registrationDom.memberList.querySelectorAll('[data-member-edit]').forEach((button) => {
    button.addEventListener('click', () => openMemberEditor(String(button.getAttribute('data-member-edit') || '')));
  });

  registrationDom.memberList.querySelectorAll('[data-member-remove]').forEach((button) => {
    button.addEventListener('click', () => removeMember(String(button.getAttribute('data-member-remove') || '')));
  });
}

function renderFinalReview() {
  if (!registrationDom.finalReview) return;

  const technicalRequirement = getTeamRequirement('technical');
  const nonTechnicalRequirement = getTeamRequirement('nontechnical');
  const memberCount = registrationState.teamMembers.length;

  registrationDom.finalReview.innerHTML = `
    <div class="review-grid">
      <div class="review-card">
        <h5>Participant</h5>
        <p>${escapeHtml(registrationState.mainUser.name || '—')}</p>
        <p>${escapeHtml(registrationState.mainUser.email || '—')}</p>
        <p>${escapeHtml(registrationState.mainUser.whatsapp || '—')}</p>
        <p>${escapeHtml(registrationState.mainUser.memberId || 'TEMP001')}</p>
      </div>
      <div class="review-card">
        <h5>Selected Events</h5>
        <p>Technical: ${escapeHtml(getSelectedEvent('technical') || '—')}</p>
        <p>Non-Technical: ${escapeHtml(getSelectedEvent('nontechnical') || '—')}</p>
      </div>
    </div>
    <div class="review-card">
      <h5>Member Summary</h5>
      <p>${memberCount} saved member${memberCount === 1 ? '' : 's'} in local session.</p>
      <ul class="review-list">
        <li>${escapeHtml(technicalRequirement.eventName || 'Technical event')}: ${technicalRequirement.assignedMembers.length}/${technicalRequirement.requiredMembers} required teammates added.</li>
        <li>${escapeHtml(nonTechnicalRequirement.eventName || 'Non-technical event')}: ${nonTechnicalRequirement.totalMin > 1 ? `${nonTechnicalRequirement.assignedMembers.length}/${nonTechnicalRequirement.requiredMembers} required teammates added.` : 'Solo registration for the main participant.'}</li>
      </ul>
    </div>
  `;
}

function updateMainUserInputs() {
  if (!regForm) return;

  const fields = ['name', 'email', 'whatsapp', 'year', 'collegeName', 'departmentName', 'food'];
  fields.forEach((fieldName) => {
    const input = registrationInputs[fieldName];
    if (input) input.value = registrationState.mainUser[fieldName] || '';
  });

  registrationInputs.technicalEvents.forEach((input) => {
    input.checked = registrationState.selectedEvents.technical === input.value;
  });

  registrationInputs.nonTechnicalEvents.forEach((input) => {
    input.checked = registrationState.selectedEvents.nonTechnical === input.value;
  });

  registrationInputs.registrationTrack.forEach((input) => {
    input.checked = getSelectedTrack() === String(input.value || '').toLowerCase();
  });
}

function applyTrackSelectionUI() {
  const allowTechnical = isTrackEnabled('technical');
  const allowNonTechnical = isTrackEnabled('nontechnical');

  if (registrationDom.technicalEventsGroup) {
    registrationDom.technicalEventsGroup.classList.toggle('hidden', !allowTechnical);
  }

  if (registrationDom.nonTechnicalEventsGroup) {
    registrationDom.nonTechnicalEventsGroup.classList.toggle('hidden', !allowNonTechnical);
  }

  registrationInputs.technicalEvents.forEach((input) => {
    input.disabled = !allowTechnical;
    if (!allowTechnical) input.checked = false;
  });

  registrationInputs.nonTechnicalEvents.forEach((input) => {
    input.disabled = !allowNonTechnical;
    if (!allowNonTechnical) input.checked = false;
  });
}

function updateRegistrationIdChip() {
  if (registrationDom.mainId) {
    registrationDom.mainId.textContent = registrationState.mainUser.memberId || 'TEMP001';
  }
}

function getUniqueParticipantCount() {
  const uniqueKeys = new Set();
  const mainKey = String(registrationState.mainUser.email || registrationState.mainUser.whatsapp || registrationState.mainUser.memberId || 'MAIN').trim().toLowerCase();
  if (mainKey) uniqueKeys.add(mainKey);

  registrationState.teamMembers.forEach((member) => {
    const memberKey = String(member.email || member.phone || member.memberId || '').trim().toLowerCase();
    if (memberKey) uniqueKeys.add(memberKey);
  });

  return Math.max(1, uniqueKeys.size || 1);
}

function formatCurrencyInr(value) {
  return `Rs.${Number(value || 0).toLocaleString('en-IN')}`;
}

function updatePaymentQrPreview() {
  const participantCount = getUniqueParticipantCount();
  const totalAmount = participantCount * PAYMENT_PER_HEAD;
  const upiPayload = `upi://pay?pa=${encodeURIComponent(UPI_NUMBER)}&pn=${encodeURIComponent('PIXELORA 2K26')}&am=${encodeURIComponent(totalAmount.toFixed(2))}&cu=INR&tn=${encodeURIComponent(`Registration for ${participantCount} participant(s)`)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(upiPayload)}`;

  if (registrationDom.paymentTotal) {
    registrationDom.paymentTotal.textContent = `Total amount - ${formatCurrencyInr(totalAmount)} (${participantCount} participant${participantCount === 1 ? '' : 's'})`;
  }

  if (registrationDom.paymentQr) {
    registrationDom.paymentQr.src = qrUrl;
  }

  if (registrationDom.upiIdText) {
    registrationDom.upiIdText.textContent = UPI_NUMBER;
  }
}

function updateProgressLabels() {
  const showMembers = shouldShowMemberStep();
  const step1 = registrationDom.stepButtons.find((button) => Number(button.getAttribute('data-step-nav')) === 1);
  const step2 = registrationDom.stepButtons.find((button) => Number(button.getAttribute('data-step-nav')) === 2);
  const step3 = registrationDom.stepButtons.find((button) => Number(button.getAttribute('data-step-nav')) === 3);
  const step4 = registrationDom.stepButtons.find((button) => Number(button.getAttribute('data-step-nav')) === 4);

  if (step1) step1.textContent = '1. Participant';
  if (step2) step2.textContent = '2. Events';

  if (showMembers) {
    if (step3) {
      step3.textContent = '3. Members';
      step3.classList.remove('hidden');
      step3.disabled = false;
    }
    if (step4) {
      step4.textContent = '4. Review';
      step4.classList.remove('hidden');
      step4.disabled = false;
    }
  } else {
    if (step3) {
      step3.classList.add('hidden');
      step3.disabled = true;
    }
    if (step4) {
      step4.textContent = '3. Review';
      step4.classList.remove('hidden');
      step4.disabled = false;
    }
  }
}

function shouldShowMemberStep() {
  return (
    isTeamEvent(getSelectedEvent('technical')) ||
    isTeamEvent(getSelectedEvent('nontechnical')) ||
    registrationState.teamMembers.length > 0 ||
    Boolean(registrationState.draftMember)
  );
}

function showStep(step) {
  const visibleStep = shouldShowMemberStep() ? step : (step === 3 ? 4 : step);
  registrationState.step = visibleStep;
  persistRegistrationState();

  registrationDom.stepSections.forEach((section) => {
    const sectionStep = Number(section.getAttribute('data-step') || '0');
    const isVisible = sectionStep === visibleStep || (sectionStep === 3 && shouldShowMemberStep() && visibleStep === 3);
    section.classList.toggle('hidden', !isVisible);
  });

  registrationDom.stepButtons.forEach((button) => {
    const buttonStep = Number(button.getAttribute('data-step-nav') || '0');
    const shouldHide = buttonStep === 3 && !shouldShowMemberStep();
    button.classList.toggle('hidden', shouldHide);
    button.disabled = shouldHide;
    button.classList.toggle('active', buttonStep === visibleStep);
  });
}

function renderMemberEditor() {
  if (!registrationDom.memberEditor || !registrationState.draftMember) {
    if (registrationDom.memberEditor) registrationDom.memberEditor.classList.add('hidden');
    return;
  }

  registrationDom.memberEditor.classList.remove('hidden');
  registrationDom.memberEditorTitle.textContent = registrationState.teamMembers.some((member) => member.memberId === registrationState.draftMember.memberId) ? 'Edit Member' : 'Add Member';
  registrationDom.memberEditorHint.textContent = registrationState.draftMember.memberId === registrationState.teamMembers.find((member) => member.memberId === registrationState.draftMember.memberId)?.memberId ? 'Update the stored member details locally.' : 'Fill in the teammate details and assign the allowed event categories.';
  registrationDom.memberId.value = registrationState.draftMember.memberId || '';
  registrationDom.memberName.value = registrationState.draftMember.name || '';
  registrationDom.memberEmail.value = registrationState.draftMember.email || '';
  registrationDom.memberPhone.value = registrationState.draftMember.phone || '';
  if (registrationDom.memberFood) registrationDom.memberFood.value = registrationState.draftMember.food || '';
  renderMemberEventFields(registrationState.draftMember);
}

function syncMainUserFromForm() {
  if (!regForm) return;

  registrationState.mainUser = {
    ...registrationState.mainUser,
    name: String(registrationInputs.name?.value || '').trim(),
    email: String(registrationInputs.email?.value || '').trim(),
    whatsapp: String(registrationInputs.whatsapp?.value || '').trim(),
    year: String(registrationInputs.year?.value || '').trim(),
    collegeName: String(registrationInputs.collegeName?.value || '').trim(),
    departmentName: String(registrationInputs.departmentName?.value || '').trim(),
    food: String(registrationInputs.food?.value || '').trim()
  };

  persistRegistrationState();
  updateRegistrationIdChip();
}

function syncEventSelectionFromForm() {
  registrationState.registrationTrack = registrationInputs.registrationTrack.find((input) => input.checked)?.value || 'both';

  applyTrackSelectionUI();

  const technicalEvent = registrationInputs.technicalEvents.find((input) => input.checked)?.value || '';
  const nonTechnicalEvent = registrationInputs.nonTechnicalEvents.find((input) => input.checked)?.value || '';
  registrationState.selectedEvents = { technical: technicalEvent, nonTechnical: nonTechnicalEvent };

  const technicalTeamEnabled = Boolean(technicalEvent) && isTeamEvent(technicalEvent);
  const nonTechnicalTeamEnabled = Boolean(nonTechnicalEvent) && isTeamEvent(nonTechnicalEvent);
  registrationState.teamMembers = registrationState.teamMembers
    .map((member) => {
      const nextMember = { ...member };
      if (!technicalTeamEnabled || nextMember.technicalEvent !== technicalEvent) {
        nextMember.technicalEvent = '';
        nextMember.technical_used = false;
      }

      if (!nonTechnicalTeamEnabled || nextMember.nonTechnicalEvent !== nonTechnicalEvent) {
        nextMember.nonTechnicalEvent = '';
        nextMember.nontechnical_used = false;
      }

      return nextMember;
    })
    .filter((member) => Boolean(member.technicalEvent || member.nonTechnicalEvent));

  if (registrationState.draftMember) {
    if (!technicalTeamEnabled || registrationState.draftMember.technicalEvent !== technicalEvent) {
      registrationState.draftMember.technicalEvent = '';
      registrationState.draftMember.technical_used = false;
    }

    if (!nonTechnicalTeamEnabled || registrationState.draftMember.nonTechnicalEvent !== nonTechnicalEvent) {
      registrationState.draftMember.nonTechnicalEvent = '';
      registrationState.draftMember.nontechnical_used = false;
    }
  }

  persistRegistrationState();
  renderRegistrationWizard();
}

function validateMainUserStep() {
  const required = [
    ['Name', registrationState.mainUser.name],
    ['Email', registrationState.mainUser.email],
    ['Whatsapp Number', registrationState.mainUser.whatsapp],
    ['Year', registrationState.mainUser.year],
    ['College Name', registrationState.mainUser.collegeName],
    ['Department Name', registrationState.mainUser.departmentName],
    ['Food Preference', registrationState.mainUser.food]
  ];

  const missingField = required.find(([, value]) => !String(value || '').trim());
  if (missingField) {
    return `Please fill ${missingField[0].toLowerCase()}.`;
  }

  if (!/^\S+@\S+\.\S+$/.test(registrationState.mainUser.email)) {
    return 'Please enter a valid email address.';
  }

  return '';
}

function validateEventStep() {
  const selectedTrack = getSelectedTrack();

  if (selectedTrack === 'technical' && !registrationState.selectedEvents.technical) {
    return 'Please select one technical event.';
  }

  if (selectedTrack === 'nontechnical' && !registrationState.selectedEvents.nonTechnical) {
    return 'Please select one non-technical event.';
  }

  if (selectedTrack === 'both') {
    if (!registrationState.selectedEvents.technical) return 'Please select one technical event.';
    if (!registrationState.selectedEvents.nonTechnical) return 'Please select one non-technical event.';
  }

  if (!registrationState.selectedEvents.technical && !registrationState.selectedEvents.nonTechnical) {
    return 'Please select at least one event.';
  }

  if (registrationState.selectedEvents.nonTechnical === 'IPL Auction' && getIplSlotsLeft() <= 0) {
    return 'IPL Auction slots are full. Please choose another non-technical event.';
  }

  return '';
}

function validateMemberDraft(memberDraft) {
  if (!memberDraft) return 'No member draft is open.';

  if (!String(memberDraft.name || '').trim()) return 'Please enter the member name.';
  if (!String(memberDraft.email || '').trim()) return 'Please enter the member email.';
  if (!String(memberDraft.phone || '').trim()) return 'Please enter the member phone.';
  if (!/^\S+@\S+\.\S+$/.test(memberDraft.email)) return 'Please enter a valid member email address.';

  const selectedTechnicalEvent = getSelectedEvent('technical');
  const selectedNonTechnicalEvent = getSelectedEvent('nontechnical');
  const technicalTeamEnabled = Boolean(selectedTechnicalEvent) && isTeamEvent(selectedTechnicalEvent);
  const nonTechnicalTeamEnabled = Boolean(selectedNonTechnicalEvent) && isTeamEvent(selectedNonTechnicalEvent);

  if (memberDraft.technicalEvent) {
    if (!technicalTeamEnabled || memberDraft.technicalEvent !== selectedTechnicalEvent) {
      return 'Member technical event is not valid.';
    }
  }

  if (memberDraft.nonTechnicalEvent) {
    if (!nonTechnicalTeamEnabled || memberDraft.nonTechnicalEvent !== selectedNonTechnicalEvent) {
      return 'Member non-technical event is not valid.';
    }
  }

  if ((technicalTeamEnabled || nonTechnicalTeamEnabled) && !memberDraft.technicalEvent && !memberDraft.nonTechnicalEvent) {
    return 'Assign this member to at least one selected team event.';
  }

  return '';
}

function validateMemberConflicts(memberDraft) {
  const currentEmail = String(memberDraft.email || '').trim().toLowerCase();
  const currentPhone = normalizeComparablePhone(memberDraft.phone);

  const duplicate = registrationState.teamMembers.find((member) => {
    if (member.memberId === memberDraft.memberId) return false;
    const emailMatches = String(member.email || '').trim().toLowerCase() === currentEmail && currentEmail;
    const phoneMatches = normalizeComparablePhone(member.phone) === currentPhone && currentPhone;
    return emailMatches || phoneMatches;
  });

  if (duplicate) {
    return 'This member already exists in the session. Use a different email or phone number.';
  }

  const mainEmail = String(registrationState.mainUser.email || '').trim().toLowerCase();
  const mainPhone = normalizeComparablePhone(registrationState.mainUser.whatsapp);
  if (mainEmail && mainEmail === currentEmail) return 'The member email cannot match the main participant email.';
  if (mainPhone && mainPhone === currentPhone) return 'The member phone cannot match the main participant phone.';

  return '';
}

function validateTeamRequirements() {
  const technicalRequirement = getTeamRequirement('technical');
  const nonTechnicalRequirement = getTeamRequirement('nontechnical');

  if (technicalRequirement.eventName && isTeamEvent(technicalRequirement.eventName)) {
    if (technicalRequirement.assignedMembers.length < technicalRequirement.requiredMembers) {
      return `${technicalRequirement.eventName} needs ${technicalRequirement.requiredMembers} member${technicalRequirement.requiredMembers === 1 ? '' : 's'} besides you.`;
    }
  }

  if (nonTechnicalRequirement.eventName && isTeamEvent(nonTechnicalRequirement.eventName)) {
    if (nonTechnicalRequirement.assignedMembers.length < nonTechnicalRequirement.requiredMembers) {
      return `${nonTechnicalRequirement.eventName} needs ${nonTechnicalRequirement.requiredMembers} member${nonTechnicalRequirement.requiredMembers === 1 ? '' : 's'} besides you.`;
    }
  }

  return '';
}

function openMemberEditor(memberId = '') {
  const existingMember = registrationState.teamMembers.find((member) => member.memberId === memberId);
  if (!existingMember && !canAddAnotherPoolMember()) {
    setRegStatus(
      'Maximum roster size reached for your selected event(s). Remove a member or pick different events.',
      'err'
    );
    return;
  }

  registrationState.draftMember = existingMember ? cloneJson(existingMember) : blankMemberDraft(createNextMemberId());

  const selectedTechnicalEvent = getSelectedEvent('technical');
  const technicalTeamEnabled = Boolean(selectedTechnicalEvent) && isTeamEvent(selectedTechnicalEvent);
  const selectedNonTechnicalEvent = getSelectedEvent('nontechnical');
  const nonTechnicalTeamEnabled = Boolean(selectedNonTechnicalEvent) && isTeamEvent(selectedNonTechnicalEvent);

  if (!technicalTeamEnabled) {
    registrationState.draftMember.technicalEvent = '';
    registrationState.draftMember.technical_used = false;
  } else if (registrationState.draftMember.technicalEvent && registrationState.draftMember.technicalEvent !== selectedTechnicalEvent) {
    registrationState.draftMember.technicalEvent = '';
    registrationState.draftMember.technical_used = false;
  }

  if (!nonTechnicalTeamEnabled) {
    registrationState.draftMember.nonTechnicalEvent = '';
    registrationState.draftMember.nontechnical_used = false;
  } else if (registrationState.draftMember.nonTechnicalEvent && registrationState.draftMember.nonTechnicalEvent !== selectedNonTechnicalEvent) {
    registrationState.draftMember.nonTechnicalEvent = '';
    registrationState.draftMember.nontechnical_used = false;
  }

  persistRegistrationState();
  renderRegistrationWizard();
  showStep(3);
}

function closeMemberEditor() {
  registrationState.draftMember = null;
  persistRegistrationState();
  renderRegistrationWizard();
}

function saveMemberDraft() {
  const memberDraft = registrationState.draftMember ? normalizeMember(registrationState.draftMember) : null;
  if (!memberDraft) {
    setRegStatus('Open a member form first.', 'err');
    return;
  }

  const draftError = validateMemberDraft(memberDraft);
  if (draftError) {
    setRegStatus(draftError, 'err');
    return;
  }

  const conflictError = validateMemberConflicts(memberDraft);
  if (conflictError) {
    setRegStatus(conflictError, 'err');
    return;
  }

  const capacityError = validateMemberTeamCapacity(memberDraft);
  if (capacityError) {
    setRegStatus(capacityError, 'err');
    return;
  }

  const nextMembers = registrationState.teamMembers.filter((member) => member.memberId !== memberDraft.memberId);
  nextMembers.push({
    ...memberDraft,
    technical_used: Boolean(memberDraft.technicalEvent),
    nontechnical_used: Boolean(memberDraft.nonTechnicalEvent)
  });

  registrationState.teamMembers = nextMembers;
  registrationState.draftMember = null;
  persistRegistrationState();
  setRegStatus('Member saved locally.', 'ok');
  renderRegistrationWizard();
}

function removeMember(memberId) {
  const member = registrationState.teamMembers.find((entry) => entry.memberId === memberId);
  if (!member) return;

  const confirmed = window.confirm(`Remove ${member.name || 'this member'} from the local session?`);
  if (!confirmed) return;

  registrationState.teamMembers = registrationState.teamMembers.filter((entry) => entry.memberId !== memberId);
  if (registrationState.draftMember?.memberId === memberId) {
    registrationState.draftMember = null;
  }

  persistRegistrationState();
  renderRegistrationWizard();
}

function buildTeamSubmissionPayload(category) {
  const eventName = getSelectedEvent(category);
  const assignedMembers = eventName ? getTeamEventMembers(category, eventName) : [];
  const rule = eventName ? getTeamRule(eventName) : { min: 1, max: 1 };
  
  return {
    eventName,
    teamName: eventName,
    teamLeader: registrationState.mainUser.name,
    teamSize: Math.max(1, assignedMembers.length + 1),
    members: assignedMembers.map((member) => member.name),
    requiredMembers: Math.max(0, rule.min - 1)
  };
}

function buildFinalPayload(formData) {
  const technicalTeam = buildTeamSubmissionPayload('technical');
  const nonTechnicalTeam = buildTeamSubmissionPayload('nontechnical');

  formData.set('name', registrationState.mainUser.name);
  formData.set('email', registrationState.mainUser.email);
  formData.set('whatsapp', registrationState.mainUser.whatsapp);
  formData.set('year', registrationState.mainUser.year);
  formData.set('collegeName', registrationState.mainUser.collegeName);
  formData.set('departmentName', registrationState.mainUser.departmentName);
  formData.set('technicalEvents', registrationState.selectedEvents.technical);
  formData.set('nonTechnicalEvents', registrationState.selectedEvents.nonTechnical);
  formData.set('technicalTeamName', technicalTeam.teamName || '');
  formData.set('technicalTeamLeader', technicalTeam.teamLeader || '');
  formData.set('technicalTeamSize', String(technicalTeam.teamSize || 1));
  formData.set('technicalTeamMembers', JSON.stringify(technicalTeam.members || []));
  formData.set('nonTechnicalTeamName', nonTechnicalTeam.teamName || '');
  formData.set('nonTechnicalTeamLeader', nonTechnicalTeam.teamLeader || '');
  formData.set('nonTechnicalTeamSize', String(nonTechnicalTeam.teamSize || 1));
  formData.set('nonTechnicalTeamMembers', JSON.stringify(nonTechnicalTeam.members || []));
  formData.set('food', registrationState.mainUser.food);
  formData.set('sessionData', JSON.stringify({
    ...registrationState,
    paymentScreenshot: undefined
  }));
  formData.set('teamMembers', JSON.stringify(registrationState.teamMembers));

  return formData;
}

function renderRegistrationWizard() {
  updateRegistrationIdChip();
  updateMainUserInputs();
  updateProgressLabels();
  renderEventSummary();
  renderMemberList();
  renderMemberEditor();
  renderFinalReview();
  updatePaymentQrPreview();

  showStep(registrationState.step);
}

function goToStep(step) {
  const targetStep = REGISTRATION_STEP_IDS.includes(Number(step)) ? Number(step) : 1;
  if (targetStep === 3 && !shouldShowMemberStep()) {
    registrationState.step = 4;
  } else {
    registrationState.step = targetStep;
  }
  persistRegistrationState();
  renderRegistrationWizard();
}

function continueFromStep1() {
  syncMainUserFromForm();
  const validationError = validateMainUserStep();
  if (validationError) {
    setRegStatus(validationError, 'err');
    return;
  }

  if (!registrationState.mainUser.memberId) {
    registrationState.mainUser.memberId = `${MEMBER_ID_PREFIX}001`;
  }

  registrationState.nextMemberIndex = Math.max(Number(registrationState.nextMemberIndex || 2), 2);
  persistRegistrationState();
  setRegStatus('Participant details saved locally.', 'ok');
  goToStep(2);
}

function continueFromStep2() {
  syncEventSelectionFromForm();
  const validationError = validateEventStep();
  if (validationError) {
    setRegStatus(validationError, 'err');
    return;
  }

  if (shouldShowMemberStep()) {
    goToStep(3);
  } else {
    goToStep(4);
  }
  setRegStatus('Event selection saved locally.', 'ok');
}

function continueFromStep3() {
  if (registrationState.draftMember) {
    setRegStatus('Save or cancel the open member draft before continuing.', 'err');
    return;
  }

  const teamError = validateTeamRequirements();
  if (teamError) {
    setRegStatus(teamError, 'err');
    return;
  }

  goToStep(4);
  setRegStatus('Team members saved locally.', 'ok');
}

function populateMemberEditorFromState() {
  if (!registrationState.draftMember) return;
  registrationDom.memberId.value = registrationState.draftMember.memberId || '';
  registrationDom.memberName.value = registrationState.draftMember.name || '';
  registrationDom.memberEmail.value = registrationState.draftMember.email || '';
  registrationDom.memberPhone.value = registrationState.draftMember.phone || '';
  if (registrationDom.memberFood) registrationDom.memberFood.value = registrationState.draftMember.food || '';
}

function syncDraftMemberFromInputs() {
  if (!registrationState.draftMember) return;
  registrationState.draftMember = {
    ...registrationState.draftMember,
    name: String(registrationDom.memberName?.value || '').trim(),
    email: String(registrationDom.memberEmail?.value || '').trim(),
    phone: String(registrationDom.memberPhone?.value || '').trim(),
    food: String(registrationDom.memberFood?.value || '').trim()
  };

  const technicalSelect = document.getElementById('member-technical-event');
  const nonTechnicalSelect = document.getElementById('member-nontechnical-event');
  if (technicalSelect) {
    registrationState.draftMember.technicalEvent = String(technicalSelect.value || '').trim();
    registrationState.draftMember.technical_used = Boolean(registrationState.draftMember.technicalEvent);
  }
  if (nonTechnicalSelect) {
    registrationState.draftMember.nonTechnicalEvent = String(nonTechnicalSelect.value || '').trim();
    registrationState.draftMember.nontechnical_used = Boolean(registrationState.draftMember.nonTechnicalEvent);
  } else {
    registrationState.draftMember.nonTechnicalEvent = '';
    registrationState.draftMember.nontechnical_used = false;
  }

  persistRegistrationState();
}

function updateIplSlotSelectionState() {
  const selectedNonTechnical = registrationInputs.nonTechnicalEvents.find((input) => input.checked)?.value || '';
  const iplRadio = registrationInputs.nonTechnicalEvents.find((input) => input.value === 'IPL Auction');
  if (iplRadio) {
    iplRadio.disabled = getIplSlotsLeft() <= 0;
    const option = document.getElementById('ipl-form-option');
    if (option) {
      option.style.display = getIplSlotsLeft() <= 0 ? 'none' : 'flex';
    }
  }
  if (selectedNonTechnical === 'IPL Auction' && getIplSlotsLeft() <= 0) {
    registrationState.selectedEvents.nonTechnical = '';
    registrationInputs.nonTechnicalEvents.forEach((input) => { input.checked = false; });
    persistRegistrationState();
  }
}

function updateRegistrationDomFromState() {
  updateMainUserInputs();
  updateRegistrationIdChip();
  applyTrackSelectionUI();
  updateIplSlotSelectionState();
  renderRegistrationWizard();
}

function handleMemberInputEvents() {
  if (registrationDom.memberName) {
    registrationDom.memberName.addEventListener('input', () => {
      syncDraftMemberFromInputs();
      renderMemberEditor();
    });
  }
  if (registrationDom.memberEmail) {
    registrationDom.memberEmail.addEventListener('input', () => {
      syncDraftMemberFromInputs();
      renderMemberEditor();
    });
  }
  if (registrationDom.memberPhone) {
    registrationDom.memberPhone.addEventListener('input', () => {
      syncDraftMemberFromInputs();
      renderMemberEditor();
    });
  }
  if (registrationDom.memberFood) {
    registrationDom.memberFood.addEventListener('change', () => {
      syncDraftMemberFromInputs();
      renderMemberEditor();
    });
  }
}

function bindRegistrationEvents() {
  if (!regForm) return;

  ['name', 'email', 'whatsapp', 'year', 'collegeName', 'departmentName', 'food'].forEach((fieldName) => {
    const input = registrationInputs[fieldName];
    if (input) {
      input.addEventListener('input', () => {
        syncMainUserFromForm();
        renderRegistrationWizard();
      });
      input.addEventListener('change', () => {
        syncMainUserFromForm();
        renderRegistrationWizard();
      });
    }
  });

  registrationInputs.technicalEvents.forEach((input) => {
    input.addEventListener('change', syncEventSelectionFromForm);
  });

  registrationInputs.nonTechnicalEvents.forEach((input) => {
    input.addEventListener('change', syncEventSelectionFromForm);
  });

  registrationInputs.registrationTrack.forEach((input) => {
    input.addEventListener('change', syncEventSelectionFromForm);
  });

  if (registrationDom.step1Continue) {
    registrationDom.step1Continue.addEventListener('click', continueFromStep1);
  }

  if (registrationDom.step2Back) {
    registrationDom.step2Back.addEventListener('click', () => goToStep(1));
  }

  if (registrationDom.step2Continue) {
    registrationDom.step2Continue.addEventListener('click', continueFromStep2);
  }

  if (registrationDom.step3Back) {
    registrationDom.step3Back.addEventListener('click', () => goToStep(2));
  }

  if (registrationDom.step3Continue) {
    registrationDom.step3Continue.addEventListener('click', continueFromStep3);
  }

  if (registrationDom.step4Back) {
    registrationDom.step4Back.addEventListener('click', () => goToStep(shouldShowMemberStep() ? 3 : 2));
  }

  if (registrationDom.memberAddBtn) {
    registrationDom.memberAddBtn.addEventListener('click', () => openMemberEditor());
  }

  if (registrationDom.memberSaveBtn) {
    registrationDom.memberSaveBtn.addEventListener('click', saveMemberDraft);
  }

  if (registrationDom.memberCancelBtn) {
    registrationDom.memberCancelBtn.addEventListener('click', closeMemberEditor);
  }

  if (registrationDom.progress) {
    registrationDom.progress.addEventListener('click', (event) => {
      const button = event.target.closest('[data-step-nav]');
      if (!button || button.disabled) return;
      goToStep(Number(button.getAttribute('data-step-nav') || '1'));
    });
  }

  regForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (window.location.protocol === 'file:') {
      setRegStatus('Please run through backend server to submit the form.', 'err');
      return;
    }

    syncMainUserFromForm();
    syncEventSelectionFromForm();
    syncDraftMemberFromInputs();

    const mainUserError = validateMainUserStep();
    if (mainUserError) {
      setRegStatus(mainUserError, 'err');
      goToStep(1);
      return;
    }

    const eventError = validateEventStep();
    if (eventError) {
      setRegStatus(eventError, 'err');
      goToStep(2);
      return;
    }

    const teamRequirementError = validateTeamRequirements();
    if (teamRequirementError) {
      setRegStatus(teamRequirementError, 'err');
      goToStep(3);
      return;
    }

    const teamMaxError = validateTeamMaxSizes();
    if (teamMaxError) {
      setRegStatus(teamMaxError, 'err');
      goToStep(3);
      return;
    }

    if (registrationState.draftMember) {
      setRegStatus('Save or cancel the open member draft before submitting.', 'err');
      goToStep(3);
      return;
    }

    const paymentScreenshot = registrationInputs.paymentScreenshot?.files?.[0];
    if (!(paymentScreenshot instanceof File) || !paymentScreenshot.name) {
      setRegStatus('Please upload your payment screenshot.', 'err');
      goToStep(4);
      return;
    }

    const formData = new FormData();
    formData.set('paymentScreenshot', paymentScreenshot);
    buildFinalPayload(formData);

    regSubmit.disabled = true;
    regSubmit.textContent = 'Submitting...';
    setRegStatus('Submitting your registration...', null);

    try {
      const response = await fetch(buildApiUrl('/api/registrations'), {
        method: 'POST',
        body: formData
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || result.detail || 'Submission failed.');
      }

      clearRegistrationState();
      if (regForm) regForm.reset();
      updateIplSlotUI();
      setRegStatus('Registered successfully. See you at PIXELORA 2K26!', 'ok');
      renderRegistrationWizard();
      goToStep(1);
      await loadIplSlotStatus();
    } catch (error) {
      setRegStatus(error.message || 'Unable to submit right now. Try again later.', 'err');
    } finally {
      regSubmit.disabled = false;
      regSubmit.textContent = 'Submit Registration';
      renderRegistrationWizard();
    }
  });
}

function refreshTeamDetails() {
  syncEventSelectionFromForm();
  renderRegistrationWizard();
}

window.refreshTeamDetails = refreshTeamDetails;

bindRegistrationEvents();
handleMemberInputEvents();
updateRegistrationDomFromState();
if (!registrationState.mainUser.memberId && hasRegistrationMainUserData(registrationState.mainUser)) {
  registrationState.mainUser.memberId = `${MEMBER_ID_PREFIX}001`;
  persistRegistrationState();
}
renderRegistrationWizard();
