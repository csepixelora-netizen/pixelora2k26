const adminUnlock = document.getElementById('admin-unlock');
const adminRefresh = document.getElementById('admin-refresh');
const adminDownload = document.getElementById('admin-download');
const adminReset = document.getElementById('admin-reset');
const adminSecret = document.getElementById('admin-secret');
const adminStatus = document.getElementById('admin-status');
const adminTableBody = document.getElementById('admin-table-body');

const APP_CONFIG = window.__PIXELORA_CONFIG__ || {};
const configuredApiBaseUrl = String(APP_CONFIG.apiBaseUrl || '').trim().replace(/\/+$/, '');
const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocalHost ? '' : configuredApiBaseUrl;
const ADMIN_SHORTCUT_AUTH_KEY = 'pixelora-admin-shortcut-auth';

let unlockedSecret = '';

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
    adminTableBody.innerHTML = '<tr><td class="admin-empty" colspan="7">No registrations found.</td></tr>';
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
      <td>${renderPaymentScreenshotCell(registration.paymentScreenshot)}</td>
      <td>${escapeHtml(registration.createdAt)}</td>
    </tr>
  `).join('');
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

  return Array.isArray(result.registrations) ? result.registrations : [];
}

async function unlockAdminPortal() {
  const secret = getSecretFromInput();
  if (!secret) {
    setAdminStatus('Admin secret is required.', 'err');
    return;
  }

  setAdminStatus('Verifying admin secret...', null);

  try {
    const registrations = await fetchRegistrations(secret);
    unlockedSecret = secret;
    localStorage.setItem('pixelora-admin-secret', secret);
    sessionStorage.setItem(ADMIN_SHORTCUT_AUTH_KEY, String(Date.now()));
    renderAdminRegistrations(registrations);
    setAdminStatus(`Loaded ${registrations.length} registrations.`, 'ok');
  } catch (error) {
    unlockedSecret = '';
    setAdminStatus(error.message || 'Invalid admin secret.', 'err');
    renderAdminRegistrations([]);
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
    const registrations = await fetchRegistrations(secret);
    renderAdminRegistrations(registrations);
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
