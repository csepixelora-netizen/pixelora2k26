const adminUnlock = document.getElementById('admin-unlock');
const adminRefresh = document.getElementById('admin-refresh');
const adminDownload = document.getElementById('admin-download');
const adminReset = document.getElementById('admin-reset');
const adminSecret = document.getElementById('admin-secret');
const adminStatus = document.getElementById('admin-status');
const adminTableBody = document.getElementById('admin-table-body');
const adminTableHead = document.getElementById('admin-table-head');
const adminScopeHint = document.getElementById('admin-scope-hint');
const adminEventStats = document.getElementById('admin-event-stats');

const APP_CONFIG = window.__PIXELORA_CONFIG__ || {};
const configuredApiBaseUrl = String(APP_CONFIG.apiBaseUrl || '').trim().replace(/\/+$/, '');
const API_BASE_URL = configuredApiBaseUrl;
const ADMIN_SHORTCUT_AUTH_KEY = 'pixelora-admin-shortcut-auth';

let unlockedSecret = '';
let currentAdminScope = 'full';

const SCOPE_LABELS = {
  full: 'Full access — all columns, export, and delete (main secret only).',
  technical: 'Technical committee — registrant contact, technical event, team, per-person food for technical participants, payment proof.',
  nontechnical:
    'Non-technical committee — registrant contact, non-technical event, team, per-person food for those participants, payment proof.',
  food: 'Food & hospitality — names, both events, per-person meal preferences (Veg / Non-Veg); payment links hidden.',
};

function buildApiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
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

function formatFoodByPerson(team) {
  const pf = team?.participantFoods;
  if (!Array.isArray(pf) || !pf.length) return '<span class="admin-muted">—</span>';
  return `<ul class="admin-food-list">${pf
    .map(
      (p) =>
        `<li><span class="admin-food-name">${escapeHtml(p.name || '')}</span> — <strong>${escapeHtml(p.food || '')}</strong></li>`
    )
    .join('')}</ul>`;
}

function formatAdminTeam(team, eventName) {
  if (!team) return '<span class="admin-muted">—</span>';
  const pf = team.participantFoods;
  const isSoloTech =
    Array.isArray(pf) &&
    pf.length === 1 &&
    (!(team.members || []).length || (team.members || []).length === 0);
  if (isSoloTech && eventName) {
    return `
        <div class="admin-team">
          <span class="admin-evtag">${escapeHtml(eventName)}</span>
          <span>Individual — ${escapeHtml(pf[0]?.name || team.teamLeader || '')}</span>
          ${formatFoodByPerson(team)}
        </div>`;
  }
  if (!team.teamName && !team.teamLeader && !(team.members || []).length) {
    return '<span class="admin-muted">—</span>';
  }
  const members = Array.isArray(team.members) ? team.members.join(', ') : '';
  return `
    <div class="admin-team">
      ${eventName ? `<span class="admin-evtag">${escapeHtml(eventName)}</span>` : ''}
      <strong>${escapeHtml(team.teamName || '—')}</strong>
      <span>Leader: ${escapeHtml(team.teamLeader || '—')}</span>
      <span>Size: ${escapeHtml(team.teamSize || '—')}</span>
      <span>Members: ${escapeHtml(members || '—')}</span>
      <div class="admin-food-wrap"><span class="admin-subh">Food by person</span>${formatFoodByPerson(team)}</div>
    </div>
  `;
}

function renderEventStats(registrations) {
  if (!adminEventStats) return;
  if (!registrations.length) {
    adminEventStats.hidden = true;
    adminEventStats.innerHTML = '';
    return;
  }
  const tech = {};
  const nontech = {};
  for (const r of registrations) {
    const te = r.technicalEvents || '—';
    tech[te] = (tech[te] || 0) + 1;
    const ne = r.nonTechnicalEvents || '—';
    nontech[ne] = (nontech[ne] || 0) + 1;
  }
  const chip = (label, obj) =>
    `<div class="admin-stat-block"><h4>${label}</h4><div class="admin-stat-chips">${Object.entries(obj)
      .map(([k, v]) => `<span class="admin-chip">${escapeHtml(k)}: <strong>${v}</strong></span>`)
      .join('')}</div></div>`;
  adminEventStats.innerHTML = `${chip('Technical events (registrations)', tech)}${chip(
    'Non-technical events (registrations)',
    nontech
  )}`;
  adminEventStats.hidden = false;
}

function applyScopeUi(scope) {
  currentAdminScope = scope || 'full';
  if (adminScopeHint) {
    adminScopeHint.textContent = SCOPE_LABELS[currentAdminScope] || '';
    adminScopeHint.hidden = !SCOPE_LABELS[currentAdminScope];
  }
  if (adminReset) {
    adminReset.style.display = currentAdminScope === 'full' ? '' : 'none';
  }
}

function tableColspan() {
  if (currentAdminScope === 'food') return 6;
  if (currentAdminScope === 'technical' || currentAdminScope === 'nontechnical') return 6;
  return 7;
}

function renderAdminRegistrations(registrations, scope) {
  if (!adminTableBody) return;
  applyScopeUi(scope || 'full');

  const sc = currentAdminScope;

  if (adminEventStats) {
    if (sc === 'full' || sc === 'technical' || sc === 'nontechnical') {
      renderEventStats(registrations);
    } else {
      adminEventStats.hidden = true;
      adminEventStats.innerHTML = '';
    }
  }

  if (!registrations.length) {
    if (adminTableHead) adminTableHead.innerHTML = '';
    adminTableBody.innerHTML = `<tr><td class="admin-empty" colspan="${tableColspan()}">No registrations found.</td></tr>`;
    return;
  }

  if (sc === 'full') {
    if (adminTableHead) {
      adminTableHead.innerHTML = `<tr>
        <th>Participant</th>
        <th>Year / College / Dept</th>
        <th>Technical</th>
        <th>Non-technical</th>
        <th>Meal summary</th>
        <th>Payment</th>
        <th>Created</th>
      </tr>`;
    }
    adminTableBody.innerHTML = registrations
      .map(
        (registration) => `
      <tr>
        <td>
          <strong>${escapeHtml(registration.name)}</strong><br>
          <span class="admin-muted">${escapeHtml(registration.email)}</span><br>
          <span class="admin-muted">${escapeHtml(registration.whatsapp)}</span>
        </td>
        <td>
          ${escapeHtml(registration.year)}<br>
          <span class="admin-muted">${escapeHtml(registration.collegeName)}</span><br>
          <span class="admin-muted">${escapeHtml(registration.departmentName)}</span>
        </td>
        <td>${formatAdminTeam(registration.technicalTeam, registration.technicalEvents)}</td>
        <td>${formatAdminTeam(registration.nonTechnicalTeam, registration.nonTechnicalEvents)}</td>
        <td class="admin-meal-sum">${escapeHtml(registration.food)}</td>
        <td>${renderPaymentScreenshotCell(registration.paymentScreenshot)}</td>
        <td>${escapeHtml(registration.createdAt)}</td>
      </tr>`
      )
      .join('');
    return;
  }

  if (sc === 'technical') {
    if (adminTableHead) {
      adminTableHead.innerHTML = `<tr>
        <th>Participant</th>
        <th>Year / College / Dept</th>
        <th>Technical event &amp; team</th>
        <th>Food (technical participants)</th>
        <th>Payment</th>
        <th>Created</th>
      </tr>`;
    }
    adminTableBody.innerHTML = registrations
      .map(
        (r) => `
      <tr>
        <td>
          <strong>${escapeHtml(r.name)}</strong><br>
          <span class="admin-muted">${escapeHtml(r.email)}</span><br>
          <span class="admin-muted">${escapeHtml(r.whatsapp)}</span>
        </td>
        <td>${escapeHtml(r.year)}<br><span class="admin-muted">${escapeHtml(r.collegeName)}</span><br><span class="admin-muted">${escapeHtml(r.departmentName)}</span></td>
        <td>${formatAdminTeam(r.technicalTeam, r.technicalEvents)}</td>
        <td>${formatFoodByPerson(r.technicalTeam)}</td>
        <td>${renderPaymentScreenshotCell(r.paymentScreenshot)}</td>
        <td>${escapeHtml(r.createdAt)}</td>
      </tr>`
      )
      .join('');
    return;
  }

  if (sc === 'nontechnical') {
    if (adminTableHead) {
      adminTableHead.innerHTML = `<tr>
        <th>Participant</th>
        <th>Year / College / Dept</th>
        <th>Non-technical event &amp; team</th>
        <th>Food (non-tech participants)</th>
        <th>Payment</th>
        <th>Created</th>
      </tr>`;
    }
    adminTableBody.innerHTML = registrations
      .map(
        (r) => `
      <tr>
        <td>
          <strong>${escapeHtml(r.name)}</strong><br>
          <span class="admin-muted">${escapeHtml(r.email)}</span><br>
          <span class="admin-muted">${escapeHtml(r.whatsapp)}</span>
        </td>
        <td>${escapeHtml(r.year)}<br><span class="admin-muted">${escapeHtml(r.collegeName)}</span><br><span class="admin-muted">${escapeHtml(r.departmentName)}</span></td>
        <td>${formatAdminTeam(r.nonTechnicalTeam, r.nonTechnicalEvents)}</td>
        <td>${formatFoodByPerson(r.nonTechnicalTeam)}</td>
        <td>${renderPaymentScreenshotCell(r.paymentScreenshot)}</td>
        <td>${escapeHtml(r.createdAt)}</td>
      </tr>`
      )
      .join('');
    return;
  }

  if (sc === 'food') {
    if (adminTableHead) {
      adminTableHead.innerHTML = `<tr>
        <th>Participant</th>
        <th>Technical event</th>
        <th>Food (tech)</th>
        <th>Non-technical event</th>
        <th>Food (non-tech)</th>
        <th>Created</th>
      </tr>`;
    }
    adminTableBody.innerHTML = registrations
      .map(
        (r) => `
      <tr>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td>${escapeHtml(r.technicalEvents)}</td>
        <td>${formatFoodByPerson(r.technicalTeam)}</td>
        <td>${escapeHtml(r.nonTechnicalEvents)}</td>
        <td>${formatFoodByPerson(r.nonTechnicalTeam)}</td>
        <td>${escapeHtml(r.createdAt)}</td>
      </tr>`
      )
      .join('');
  }
}

function resolvePaymentScreenshotUrl(reference) {
  const value = String(reference || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;

  const normalizedPath = value.startsWith('/') ? value : `/${value}`;
  return buildApiUrl(normalizedPath);
}

function renderPaymentScreenshotCell(reference) {
  const resolvedUrl = resolvePaymentScreenshotUrl(reference);
  if (!resolvedUrl) return '<span>Not uploaded</span>';

  return `<a href="${escapeHtml(resolvedUrl)}" target="_blank" rel="noopener noreferrer" class="admin-view-link">View Image</a>`;
}

function getSecretFromInput() {
  return adminSecret?.value?.trim() || '';
}

function getSecretFromStorage() {
  return (localStorage.getItem('pixelora-admin-secret') || '').trim();
}

function ensureUnlockedSecret() {
  if (unlockedSecret) return unlockedSecret;

  const typed = getSecretFromInput();
  if (typed) return typed;

  return '';
}

async function fetchRegistrations(secret) {
  const response = await fetch(buildApiUrl('/api/admin/registrations'), {
    headers: { 'X-Admin-Secret': secret }
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.detail || result.error || 'Unable to load registrations.');
  }

  const registrations = Array.isArray(result.registrations) ? result.registrations : [];
  const adminScope = result.adminScope || 'full';
  return { registrations, adminScope };
}

async function unlockAdminPortal() {
  const secret = getSecretFromInput();
  if (!secret) {
    setAdminStatus('Admin secret is required.', 'err');
    return;
  }

  setAdminStatus('Verifying admin secret...', null);

  try {
    const { registrations, adminScope } = await fetchRegistrations(secret);
    unlockedSecret = secret;
    localStorage.setItem('pixelora-admin-secret', secret);
    sessionStorage.setItem(ADMIN_SHORTCUT_AUTH_KEY, String(Date.now()));
    renderAdminRegistrations(registrations, adminScope);
    setAdminStatus(`Loaded ${registrations.length} registrations.`, 'ok');
  } catch (error) {
    unlockedSecret = '';
    setAdminStatus(error.message || 'Invalid admin secret.', 'err');
    renderAdminRegistrations([], 'full');
  }
}

async function loadAdminRegistrations() {
  const secret = ensureUnlockedSecret();
  if (!secret) {
    setAdminStatus('Enter admin secret and click Unlock first.', 'err');
    return;
  }

  setAdminStatus('Loading registrations...', null);

  try {
    const { registrations, adminScope } = await fetchRegistrations(secret);
    renderAdminRegistrations(registrations, adminScope);
    setAdminStatus(`Loaded ${registrations.length} registrations.`, 'ok');
  } catch (error) {
    setAdminStatus(error.message || 'Unable to load registrations.', 'err');
  }
}

async function downloadAdminCsv() {
  const secret = ensureUnlockedSecret();
  if (!secret) {
    setAdminStatus('Enter admin secret and click Unlock first.', 'err');
    return;
  }

  setAdminStatus('Preparing CSV download...', null);

  try {
    const response = await fetch(buildApiUrl('/api/admin/registrations.csv'), {
      headers: { 'X-Admin-Secret': secret }
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

async function resetAllRegistrations() {
  const secret = ensureUnlockedSecret();
  if (!secret) {
    setAdminStatus('Enter admin secret and click Unlock first.', 'err');
    return;
  }

  const confirmed = window.confirm('Delete all registrations and reset IPL slots back to 10?');
  if (!confirmed) return;

  setAdminStatus('Deleting all registration data...', null);

  try {
    const response = await fetch(buildApiUrl('/api/admin/registrations'), {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': secret }
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail || result.error || 'Unable to delete registrations.');
    }

    await loadAdminRegistrations();
    setAdminStatus('All registrations deleted. IPL slots are reset to 10.', 'ok');
  } catch (error) {
    setAdminStatus(error.message || 'Unable to delete registrations.', 'err');
  }
}

if (adminUnlock) {
  adminUnlock.addEventListener('click', unlockAdminPortal);
}

if (adminRefresh) {
  adminRefresh.addEventListener('click', loadAdminRegistrations);
}

if (adminDownload) {
  adminDownload.addEventListener('click', downloadAdminCsv);
}

if (adminReset) {
  adminReset.addEventListener('click', resetAllRegistrations);
}

if (adminSecret) {
  adminSecret.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      unlockAdminPortal();
    }
  });
}

if (adminSecret) {
  adminSecret.value = getSecretFromStorage();
}

if (sessionStorage.getItem(ADMIN_SHORTCUT_AUTH_KEY) && getSecretFromStorage()) {
  unlockAdminPortal();
} else {
  setAdminStatus('Enter admin secret and click Unlock to continue.', null);
}
