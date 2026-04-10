const adminUnlock = document.getElementById('admin-unlock');
const adminRefresh = document.getElementById('admin-refresh');
const adminReset = document.getElementById('admin-reset');
const adminSecret = document.getElementById('admin-secret');
const adminStatus = document.getElementById('admin-status');
const adminViewRoot = document.getElementById('admin-view-root');
const adminExportBar = document.getElementById('admin-export-bar');
const adminExportToggle = document.getElementById('admin-export-toggle');
const adminBackdrop = document.getElementById('admin-backdrop');

const APP_CONFIG = window.__PIXELORA_CONFIG__ || {};
const configuredApiBaseUrl = String(APP_CONFIG.apiBaseUrl || '').trim().replace(/\/+$/, '');
const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocalHost ? '' : configuredApiBaseUrl;
const SR = window.PixeloraSharedReg;
if (!SR || typeof SR.transformRegistration !== 'function') {
  throw new Error('shared-registrations.js must load before admin.js');
}
const { transformRegistration, resolveLeaderContact, personDedupeKey } = SR;

const ADMIN_SHORTCUT_AUTH_KEY = 'pixelora-admin-shortcut-auth';
const ADMIN_RAW_VIEWER_KEY = 'pixelora-admin-raw-viewer';
const ADMIN_VIEWER_PASSWORD = 'CSE';

const TECH_EXPORT_COLS = [
  'Team ID',
  'Event Name',
  'Team Leader Name',
  'Leader Mobile Number',
  'Team Size',
  'Team Member Names',
  'Team Member Mobile Numbers'
];
const NT_EXPORT_COLS = [...TECH_EXPORT_COLS];
const FOOD_EXPORT_COLS = ['Name', 'Mobile Number', 'Food Preference', 'Event Participation', 'Team ID'];
let unlockedSecret = '';
let cachedRegistrations = [];
let selectedRegistrationId = '';
let listSearchQuery = '';
function buildApiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function setAdminStatus(message, type) {
  if (!adminStatus) return;
  adminStatus.textContent = message;
  adminStatus.classList.remove('ok', 'err');
  if (type) adminStatus.classList.add(type);
}

function setExportPanelVisible(visible) {
  if (!adminExportBar) return;
  adminExportBar.classList.toggle('is-hidden', !visible);
  if (adminExportToggle) {
    adminExportToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
    adminExportToggle.textContent = visible ? 'Hide exports' : 'Export data';
  }
}

/** Delete + export toggle: only after successful admin unlock. */
function setUnlockedDangerZone(enabled) {
  if (adminReset) adminReset.disabled = !enabled;
  if (adminExportToggle) adminExportToggle.disabled = !enabled;
  if (!enabled) setExportPanelVisible(false);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatCreatedAt(iso) {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(String(iso));
  return escapeHtml(parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
}

function formatApiDetail(result) {
  const detail = result?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((entry) => entry?.msg || JSON.stringify(entry)).filter(Boolean).join('; ');
  }
  return result?.error || 'Request failed.';
}

function resolvePaymentScreenshotUrl(reference) {
  const value = String(reference || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const normalizedPath = value.startsWith('/') ? value : `/${value}`;
  return buildApiUrl(normalizedPath);
}

function renderPaymentLink(reference) {
  const url = resolvePaymentScreenshotUrl(reference);
  if (!url) return '<span class="admin-muted">Not uploaded</span>';
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="admin-view-link">View payment</a>`;
}

function getSecretFromInput() {
  return adminSecret?.value?.trim() || '';
}

function getSecretFromStorage() {
  return (localStorage.getItem('pixelora-admin-secret') || '').trim();
}

function ensureUnlockedSecret() {
  if (unlockedSecret) return unlockedSecret;
  return getSecretFromInput() || '';
}

function isRawViewerUnlocked() {
  return sessionStorage.getItem(ADMIN_RAW_VIEWER_KEY) === '1';
}

function setRawViewerUnlocked(on) {
  if (on) sessionStorage.setItem(ADMIN_RAW_VIEWER_KEY, '1');
  else sessionStorage.removeItem(ADMIN_RAW_VIEWER_KEY);
}

function classifyMealPreference(foodRaw) {
  const food = String(foodRaw || '').trim().toLowerCase();
  if (!food) return 'unknown';
  const nonVeg = /non\s*-?\s*veg|nonveg|meat|chicken|mutton|beef|pork|fish|seafood|egg/i.test(food);
  if (nonVeg) return 'nonveg';
  const veg = /\bveg\b|vegetarian|vegan|sattvik|pure\s*veg/i.test(food) || (food.includes('veg') && !food.includes('non'));
  if (veg) return 'veg';
  return 'unknown';
}

function foodPreferenceLabel(foodRaw) {
  const c = classifyMealPreference(foodRaw);
  if (c === 'veg') return 'Veg';
  if (c === 'nonveg') return 'Non-Veg';
  return String(foodRaw || '').trim() || 'Unknown';
}

function summarizeFoods(people) {
  const foods = [];
  const seen = new Set();
  people.forEach((p) => {
    const f = String(p.food || '').trim();
    if (!f || seen.has(f.toLowerCase())) return;
    seen.add(f.toLowerCase());
    foods.push(f);
  });
  return foods.length ? foods.join(' · ') : '—';
}

function buildTechnicalExportRows(registrations) {
  const rows = [];
  registrations.forEach((raw) => {
    const clean = transformRegistration(raw);
    const tech = clean.events?.technical;
    if (!tech?.name) return;
    const teamId = String(clean.id || '');
    const leaderContact = resolveLeaderContact(clean, tech.team?.leader);
    const members = Array.isArray(tech.team?.members) ? tech.team.members : [];
    const teamSize = 1 + members.length;
    rows.push({
      'Team ID': teamId,
      'Event Name': tech.name,
      'Team Leader Name': leaderContact.name || '',
      'Leader Mobile Number': String(leaderContact.phone || '').trim(),
      'Team Size': teamSize,
      'Team Member Names': members.map((m) => m.name).filter(Boolean).join(', '),
      'Team Member Mobile Numbers': members.map((m) => String(m.phone || '').trim()).filter(Boolean).join(', ')
    });
  });
  return rows;
}

function buildNonTechnicalExportRows(registrations) {
  const rows = [];
  registrations.forEach((raw) => {
    const clean = transformRegistration(raw);
    const block = clean.events?.nonTechnical;
    if (!block?.name) return;
    const teamId = String(clean.id || '');
    const leaderContact = resolveLeaderContact(clean, block.team?.leader);
    const members = Array.isArray(block.team?.members) ? block.team.members : [];
    const teamSize = 1 + members.length;
    rows.push({
      'Team ID': teamId,
      'Event Name': block.name,
      'Team Leader Name': leaderContact.name || '',
      'Leader Mobile Number': String(leaderContact.phone || '').trim(),
      'Team Size': teamSize,
      'Team Member Names': members.map((m) => m.name).filter(Boolean).join(', '),
      'Team Member Mobile Numbers': members.map((m) => String(m.phone || '').trim()).filter(Boolean).join(', ')
    });
  });
  return rows;
}

function nameInMemberList(name, list) {
  const t = String(name || '')
    .trim()
    .toLowerCase();
  return list.some((m) => String(m.name || '')
    .trim()
    .toLowerCase() === t);
}

function participationForPerson(clean, personName) {
  const nm = String(personName || '')
    .trim()
    .toLowerCase();
  const tech = clean.events?.technical;
  const nt = clean.events?.nonTechnical;
  const techLeader = String(tech?.team?.leader || '')
    .trim()
    .toLowerCase();
  const ntLeader = String(nt?.team?.leader || '')
    .trim()
    .toLowerCase();
  const techMembers = tech?.team?.members || [];
  const ntMembers = nt?.team?.members || [];

  let inTech = tech?.name && (nm === techLeader || nameInMemberList(personName, techMembers));
  let inNt = nt?.name && (nm === ntLeader || nameInMemberList(personName, ntMembers));

  if (nm === String(clean.primaryRegistrant?.name || '').trim().toLowerCase()) {
    if (tech?.name && nm === techLeader) inTech = true;
    if (nt?.name && nm === ntLeader) inNt = true;
  }

  if (inTech && inNt) return 'Both';
  if (inTech) return 'Technical';
  if (inNt) return 'Non-Technical';
  return '—';
}

function buildFoodExportRows(registrations) {
  const rows = [];
  const seenGlobal = new Set();

  registrations.forEach((raw) => {
    const clean = transformRegistration(raw);
    const teamId = String(clean.id || '');
    const add = (person) => {
      const name = String(person?.name || '').trim();
      const phone = String(person?.phone || '').trim();
      if (!name && !phone) return;
      const key = personDedupeKey(name, phone, teamId);
      if (seenGlobal.has(key)) return;
      seenGlobal.add(key);
      rows.push({
        Name: name || '—',
        'Mobile Number': phone,
        'Food Preference': foodPreferenceLabel(person?.food),
        'Event Participation': participationForPerson(clean, name),
        'Team ID': teamId
      });
    };

    add(clean.primaryRegistrant);

    const tech = clean.events?.technical;
    if (tech?.team) {
      add(resolveLeaderContact(clean, tech.team.leader));
      (tech.team.members || []).forEach(add);
    }
    const nt = clean.events?.nonTechnical;
    if (nt?.team) {
      add(resolveLeaderContact(clean, nt.team.leader));
      (nt.team.members || []).forEach(add);
    }
  });

  return rows;
}

function csvEscapeCell(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function rowsToCsv(columns, rows) {
  const header = columns.map(csvEscapeCell).join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscapeCell(row[c])).join(','));
  return `${header}\n${lines.join('\n')}`;
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadRowsCsv(filename, columns, rows) {
  downloadBlob(rowsToCsv(columns, rows), filename, 'text/csv;charset=utf-8');
}

function downloadRowsXlsx(filename, columns, rows, sheetName) {
  if (typeof XLSX === 'undefined') {
    setAdminStatus('XLSX library unavailable; downloaded CSV instead.', 'err');
    downloadRowsCsv(filename.replace(/\.xlsx$/i, '.csv'), columns, rows);
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Export');
  XLSX.writeFile(wb, filename);
}

function downloadRowsPdf(title, columns, rows, filename) {
  const jspdf = window.jspdf;
  if (!jspdf || typeof jspdf.jsPDF !== 'function') {
    setAdminStatus('PDF library unavailable.', 'err');
    return;
  }
  const doc = new jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(11);
  doc.text(title, 40, 32);
  const body = rows.map((r) => columns.map((c) => String(r[c] ?? '')));
  doc.autoTable({
    head: [columns],
    body,
    startY: 44,
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [79, 91, 137] },
    margin: { left: 36, right: 36 }
  });
  doc.save(filename);
}

function cloneForJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function renderDynamicValue(value, depth, seen) {
  if (depth > 14) return '<span class="admin-muted">…</span>';
  if (value === null || value === undefined) return '<span class="admin-muted">—</span>';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return `<span class="admin-dyn-scalar">${escapeHtml(String(value))}</span>`;
  if (t === 'bigint') return escapeHtml(String(value));
  if (value instanceof Date) return escapeHtml(value.toISOString());

  if (Array.isArray(value)) {
    const slice = value.length > 60 ? value.slice(0, 60) : value;
    const more = value.length > 60 ? `<li class="admin-muted">… ${value.length - 60} more</li>` : '';
    return `<ul class="admin-dyn-ul">${slice.map((it) => `<li>${renderDynamicValue(it, depth + 1, seen)}</li>`).join('')}${more}</ul>`;
  }

  if (t === 'object') {
    if (seen.has(value)) return '<span class="admin-muted">[circular]</span>';
    seen.add(value);
    const entries = Object.entries(value);
    const inner = entries
      .map(
        ([k, v]) => `
      <div class="admin-dyn-row">
        <span class="admin-dyn-k">${escapeHtml(k)}</span>
        <div class="admin-dyn-v">${renderDynamicValue(v, depth + 1, seen)}</div>
      </div>`
      )
      .join('');
    seen.delete(value);
    return `<div class="admin-dyn-obj">${inner}</div>`;
  }

  return escapeHtml(String(value));
}

function renderDynamicTree(obj) {
  const seen = new WeakSet();
  return `<div class="admin-dyn-root">${renderDynamicValue(cloneForJson(obj), 0, seen)}</div>`;
}

function primaryKv(label, value) {
  return `<div class="admin-field-row"><span class="admin-field-label">${escapeHtml(label)}</span><span class="admin-field-value">${escapeHtml(value || '—')}</span></div>`;
}

function renderPrimarySection(clean) {
  const p = clean.primaryRegistrant;
  return `
    <section class="admin-detail-block admin-detail-block--compact">
      <h3 class="admin-detail-h">Primary details</h3>
      <div class="admin-primary-cols" role="group" aria-label="Primary registrant">
        <div class="admin-primary-col">
          ${primaryKv('Name', p.name)}
          ${primaryKv('Email', p.email)}
          ${primaryKv('Phone', p.phone)}
        </div>
        <div class="admin-primary-col">
          ${primaryKv('College', p.collegeName)}
          ${primaryKv('Department', p.departmentName)}
          ${primaryKv('Year', p.year)}
        </div>
      </div>
    </section>
  `;
}

function renderTeamBlock(clean, heading, eventBlock) {
  if (!eventBlock?.name) {
    return `
      <section class="admin-detail-block admin-detail-block--compact">
        <div class="admin-section-headrow">
          <h3 class="admin-detail-h">${escapeHtml(heading)}</h3>
        </div>
        <p class="admin-muted admin-detail-line">No team registered.</p>
      </section>`;
  }
  const team = eventBlock.team || {};
  const members = Array.isArray(team.members) ? team.members : [];
  const leaderContact = resolveLeaderContact(clean, team.leader);
  const leaderRow = `<tr><td class="admin-td-role">Leader</td><td>${escapeHtml(leaderContact.name)}</td><td>${escapeHtml(leaderContact.phone || '—')}</td><td>${escapeHtml(leaderContact.email || '—')}</td></tr>`;
  const memberRows = members
    .map(
      (m, i) => `
    <tr>
      <td class="admin-td-role">M${i + 1}</td>
      <td>${escapeHtml(m.name || '—')}</td>
      <td>${escapeHtml(m.phone || '—')}</td>
      <td>${escapeHtml(m.email || '—')}</td>
    </tr>`
    )
    .join('');
  return `
    <section class="admin-detail-block admin-detail-block--compact">
      <div class="admin-section-headrow">
        <h3 class="admin-detail-h">${escapeHtml(heading)}</h3>
        <span class="admin-section-headrow__meta"><span class="admin-pill admin-pill--dense">${escapeHtml(eventBlock.name)}</span><span class="admin-pill admin-pill--dense">${1 + members.length} people</span></span>
      </div>
      <div class="admin-panel admin-panel--table admin-panel--dense">
        <table class="admin-data-table admin-data-table--dense">
          <thead><tr><th>Role</th><th>Name</th><th>Phone</th><th>Email</th></tr></thead>
          <tbody>${leaderRow}${memberRows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function collectFoodPeopleForRegistration(clean) {
  const people = [];
  const pushU = (p) => {
    const k = personDedupeKey(p?.name, p?.phone, clean.id);
    if (!k || people.some((x) => x._k === k)) return;
    people.push({ _k: k, name: p.name, phone: p.phone, food: p.food });
  };
  pushU(clean.primaryRegistrant);
  const tech = clean.events?.technical;
  if (tech?.team) {
    pushU(resolveLeaderContact(clean, tech.team.leader));
    (tech.team.members || []).forEach(pushU);
  }
  const nt = clean.events?.nonTechnical;
  if (nt?.team) {
    pushU(resolveLeaderContact(clean, nt.team.leader));
    (nt.team.members || []).forEach(pushU);
  }
  return people;
}

function renderRegistrationDataStrip(clean) {
  const tech = clean.events?.technical;
  const nt = clean.events?.nonTechnical;
  const techHas = !!(tech?.name && String(tech.name).trim());
  const ntHas = !!(nt?.name && String(nt.name).trim());
  const foodPeople = collectFoodPeopleForRegistration(clean);
  const techTxt = techHas ? tech.name : 'Not registered';
  const ntTxt = ntHas ? nt.name : 'Not registered';
  const foodTxt = foodPeople.length ? `${foodPeople.length} people on file` : 'No meal prefs captured';
  return `
    <div class="admin-data-strip" role="status">
      <div class="admin-data-strip__cell${techHas ? '' : ' is-empty'}">
        <span class="admin-data-strip__k">Technical</span>
        <span class="admin-data-strip__v">${escapeHtml(techTxt)}</span>
      </div>
      <div class="admin-data-strip__cell${ntHas ? '' : ' is-empty'}">
        <span class="admin-data-strip__k">Non-technical</span>
        <span class="admin-data-strip__v">${escapeHtml(ntTxt)}</span>
      </div>
      <div class="admin-data-strip__cell${foodPeople.length ? '' : ' is-empty'}">
        <span class="admin-data-strip__k">Food</span>
        <span class="admin-data-strip__v">${escapeHtml(foodTxt)}</span>
      </div>
    </div>`;
}

function renderFoodSummarySection(clean) {
  const people = collectFoodPeopleForRegistration(clean);
  const summary = summarizeFoods(people.map((x) => ({ food: x.food })));
  const rows = people
    .map(
      (x) => `
    <tr>
      <td>${escapeHtml(x.name || '—')}</td>
      <td>${escapeHtml(x.phone || '—')}</td>
      <td>${escapeHtml(foodPreferenceLabel(x.food))}</td>
      <td>${escapeHtml(String(x.food || '—'))}</td>
    </tr>`
    )
    .join('');
  return `
    <section class="admin-detail-block admin-detail-block--compact">
      <div class="admin-section-headrow">
        <h3 class="admin-detail-h">Food preferences</h3>
        <span class="admin-section-headrow__meta admin-muted"><strong>${escapeHtml(summary)}</strong></span>
      </div>
      <div class="admin-panel admin-panel--table admin-panel--dense">
        <table class="admin-data-table admin-data-table--dense">
          <thead><tr><th>Name</th><th>Phone</th><th>Type</th><th>Raw</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="admin-muted">No entries</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAdminRawSection(raw) {
  const unlocked = isRawViewerUnlocked();
  const tree = unlocked ? renderDynamicTree(raw) : '';
  return `
    <section class="admin-detail-block admin-detail-block--compact admin-detail-block--raw">
      <h3 class="admin-detail-h">Admin · extended data</h3>
      <p class="admin-muted admin-detail-line">Full record · protected view</p>
      ${
        unlocked
          ? `<div class="admin-raw-tree">${tree}</div>`
          : `<div class="admin-raw-gate" id="admin-raw-gate">
          <input type="password" class="admin-raw-input" id="admin-viewer-pass" placeholder="Password" autocomplete="off" aria-label="Viewer password">
          <button type="button" class="btn bm btn-sm" id="admin-viewer-unlock">View admin details</button>
          <p class="admin-gate-err is-hidden" id="admin-gate-err"></p>
        </div>`
      }
    </section>
  `;
}

function bindRawGateOnce() {
  const btn = document.getElementById('admin-viewer-unlock');
  const input = document.getElementById('admin-viewer-pass');
  const err = document.getElementById('admin-gate-err');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => {
    const v = String(input?.value || '').trim();
    if (v === ADMIN_VIEWER_PASSWORD) {
      setRawViewerUnlocked(true);
      err?.classList.add('is-hidden');
      err && (err.textContent = '');
      fillDetailPanel();
    } else {
      if (err) {
        err.textContent = 'Incorrect password.';
        err.classList.remove('is-hidden');
      }
    }
  });
}

function downloadSingleRegistrationPdf(raw, clean) {
  const jspdf = window.jspdf;
  if (!jspdf || typeof jspdf.jsPDF !== 'function') {
    setAdminStatus('PDF library unavailable.', 'err');
    return;
  }
  const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  let y = 40;
  doc.setFontSize(13);
  doc.text(`PIXELORA — Registration ${String(clean.id).slice(0, 8)}`, 40, y);
  y += 22;
  doc.setFontSize(9);
  const p = clean.primaryRegistrant;
  const primaryRows = [
    ['Name', p.name || ''],
    ['Email', p.email || ''],
    ['Phone', p.phone || ''],
    ['College', p.collegeName || ''],
    ['Department', p.departmentName || ''],
    ['Year', p.year || '']
  ];
  doc.autoTable({ startY: y, head: [['Primary', '']], body: primaryRows, theme: 'striped', styles: { fontSize: 9 } });
  y = doc.lastAutoTable.finalY + 16;

  const tech = clean.events?.technical;
  if (tech?.name) {
    const leader = resolveLeaderContact(clean, tech.team?.leader);
    const mems = tech.team?.members || [];
    const body = [['Leader', leader.name, leader.phone, leader.email]];
    mems.forEach((m, i) => body.push([`Member ${i + 1}`, m.name || '', m.phone || '', m.email || '']));
    doc.text(`Technical: ${tech.name}`, 40, y);
    y += 12;
    doc.autoTable({ startY: y, head: [['Role', 'Name', 'Phone', 'Email']], body, styles: { fontSize: 8 } });
    y = doc.lastAutoTable.finalY + 16;
  }

  const nt = clean.events?.nonTechnical;
  if (nt?.name) {
    const leader = resolveLeaderContact(clean, nt.team?.leader);
    const mems = nt.team?.members || [];
    const body = [['Leader', leader.name, leader.phone, leader.email]];
    mems.forEach((m, i) => body.push([`Member ${i + 1}`, m.name || '', m.phone || '', m.email || '']));
    doc.text(`Non-technical: ${nt.name}`, 40, y);
    y += 12;
    doc.autoTable({ startY: y, head: [['Role', 'Name', 'Phone', 'Email']], body, styles: { fontSize: 8 } });
  }

  doc.save(`pixelora-registration-${String(clean.id).slice(0, 8)}.pdf`);
}

function getFilteredRegistrations() {
  const q = listSearchQuery.trim().toLowerCase();
  if (!q) return cachedRegistrations;
  return cachedRegistrations.filter((raw) => {
    const clean = transformRegistration(raw);
    const blob = `${raw.id || ''} ${clean.primaryRegistrant?.name || ''} ${clean.primaryRegistrant?.email || ''} ${clean.primaryRegistrant?.phone || ''}`.toLowerCase();
    return blob.includes(q);
  });
}

function fillDetailPanel() {
  const inner = document.getElementById('admin-detail-inner');
  if (!inner) return;
  const raw = cachedRegistrations.find((r) => String(r.id) === String(selectedRegistrationId));
  if (!raw) {
    inner.innerHTML = '<p class="admin-muted">Select a registration from the list.</p>';
    return;
  }
  const clean = transformRegistration(raw);
  inner.innerHTML = `
    <div class="admin-detail-head admin-detail-head--dense">
      <div class="admin-detail-head__ids">
        <span class="admin-batch-id">${escapeHtml(String(clean.id || '').slice(0, 8))}</span>
        <span class="admin-muted admin-detail-head__when">${formatCreatedAt(clean.createdAt)}</span>
      </div>
      <div class="admin-detail-pay">${renderPaymentLink(clean._meta?.paymentScreenshot)}</div>
    </div>
    ${renderRegistrationDataStrip(clean)}
    ${renderPrimarySection(clean)}
    ${renderTeamBlock(clean, 'Technical team', clean.events.technical)}
    ${renderTeamBlock(clean, 'Non-technical team', clean.events.nonTechnical)}
    ${renderFoodSummarySection(clean)}
    ${renderAdminRawSection(raw)}
  `;
  bindRawGateOnce();
}

function renderMasterList() {
  const listEl = document.getElementById('admin-reg-list');
  const meta = document.getElementById('admin-list-meta');
  if (!listEl) return;
  const rows = getFilteredRegistrations();
  if (meta) meta.textContent = `${rows.length} registration${rows.length === 1 ? '' : 's'}`;

  if (!rows.length) {
    listEl.innerHTML = '<p class="admin-muted admin-list-empty">No matches.</p>';
    return;
  }

  listEl.innerHTML = rows
    .map((raw) => {
      const clean = transformRegistration(raw);
      const id = String(raw.id || '');
      const short = escapeHtml(id.slice(0, 8));
      const active = id === selectedRegistrationId ? ' is-active' : '';
      const tech = clean.events?.technical?.name || '—';
      const nt = clean.events?.nonTechnical?.name || '—';
      const nFood = collectFoodPeopleForRegistration(clean).length;
      const tip = `Technical: ${tech} · Non-technical: ${nt} · Food rows: ${nFood}`;
      return `
      <button type="button" class="admin-reg-row${active}" data-reg-id="${escapeHtml(id)}" title="${escapeHtml(tip)}">
        <span class="admin-reg-row__title">${escapeHtml(clean.primaryRegistrant?.name || '—')}</span>
        <span class="admin-reg-row__meta">${short} · ${formatCreatedAt(clean.createdAt)}</span>
        <span class="admin-reg-row__lanes" aria-hidden="true">
          <span class="admin-reg-lane"><span class="admin-reg-lane__k">Tech</span> <span class="admin-reg-lane__v">${escapeHtml(tech)}</span></span>
          <span class="admin-reg-lane"><span class="admin-reg-lane__k">NT</span> <span class="admin-reg-lane__v">${escapeHtml(nt)}</span></span>
          <span class="admin-reg-lane"><span class="admin-reg-lane__k">Food</span> <span class="admin-reg-lane__v">${nFood}</span></span>
        </span>
      </button>`;
    })
    .join('');

  listEl.querySelectorAll('[data-reg-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedRegistrationId = String(btn.getAttribute('data-reg-id') || '');
      openDetailPanel();
      renderMasterList();
      fillDetailPanel();
    });
  });
}

function useMobileDetailLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function openDetailPanel() {
  document.body.classList.add('admin-detail-open');
  const panel = document.getElementById('admin-detail');
  if (panel) panel.classList.add('is-open');
  if (adminBackdrop && useMobileDetailLayout()) adminBackdrop.classList.add('is-visible');
}

function closeDetailPanel() {
  document.body.classList.remove('admin-detail-open');
  const panel = document.getElementById('admin-detail');
  if (panel) panel.classList.remove('is-open');
  if (adminBackdrop) adminBackdrop.classList.remove('is-visible');
}

function setExportFormatButtonsDisabled(prefix, count) {
  const dis = count === 0;
  const ids =
    prefix === 'tech'
      ? ['export-tech-csv', 'export-tech-xlsx', 'export-tech-pdf']
      : prefix === 'nt'
        ? ['export-nt-csv', 'export-nt-xlsx', 'export-nt-pdf']
        : ['export-food-csv', 'export-food-xlsx', 'export-food-pdf'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = dis;
  });
}

function updateExportCounts() {
  const techRows = buildTechnicalExportRows(cachedRegistrations);
  const ntRows = buildNonTechnicalExportRows(cachedRegistrations);
  const foodRows = buildFoodExportRows(cachedRegistrations);
  const elT = document.getElementById('export-count-tech');
  const elN = document.getElementById('export-count-nt');
  const elF = document.getElementById('export-count-food');
  if (elT) elT.textContent = `${techRows.length} team${techRows.length === 1 ? '' : 's'}`;
  if (elN) elN.textContent = `${ntRows.length} team${ntRows.length === 1 ? '' : 's'}`;
  if (elF) elF.textContent = `${foodRows.length} participant${foodRows.length === 1 ? '' : 's'}`;

  const hT = document.getElementById('export-hint-tech');
  const hN = document.getElementById('export-hint-nt');
  const hF = document.getElementById('export-hint-food');
  if (hT) hT.textContent = techRows.length ? '' : 'No technical teams in the current data.';
  if (hN) hN.textContent = ntRows.length ? '' : 'No non-technical teams in the current data.';
  if (hF) hF.textContent = foodRows.length ? '' : 'No food rows in the current data.';

  setExportFormatButtonsDisabled('tech', techRows.length);
  setExportFormatButtonsDisabled('nt', ntRows.length);
  setExportFormatButtonsDisabled('food', foodRows.length);

  const jsonBtn = document.getElementById('export-json');
  if (jsonBtn) jsonBtn.disabled = !cachedRegistrations.length;
}

function renderWorkspace() {
  if (!adminViewRoot) return;
  adminViewRoot.innerHTML = `
    <div class="admin-workspace" id="admin-workspace">
      <div class="admin-master">
        <div class="admin-master-toolbar">
          <input type="search" class="admin-list-search" id="admin-list-search" placeholder="Filter list…" value="${escapeHtml(listSearchQuery)}" autocomplete="off">
          <span class="admin-list-meta" id="admin-list-meta"></span>
        </div>
        <div class="admin-reg-list" id="admin-reg-list"></div>
      </div>
      <aside class="admin-detail" id="admin-detail" aria-label="Registration details">
        <div class="admin-detail-toolbar">
          <button type="button" class="btn bo btn-sm" id="admin-detail-close">Close panel</button>
          <button type="button" class="btn bm btn-sm" id="admin-detail-pdf">PDF (this)</button>
          <button type="button" class="btn admin-detail-delete btn-sm" id="admin-detail-delete">Delete</button>
        </div>
        <div class="admin-detail-inner" id="admin-detail-inner">
          <p class="admin-muted">Select a registration.</p>
        </div>
      </aside>
    </div>
  `;

  const search = document.getElementById('admin-list-search');
  if (search) {
    search.addEventListener('input', () => {
      listSearchQuery = search.value;
      renderMasterList();
    });
  }

  document.getElementById('admin-detail-close')?.addEventListener('click', () => {
    selectedRegistrationId = '';
    closeDetailPanel();
    renderMasterList();
    fillDetailPanel();
  });

  document.getElementById('admin-detail-pdf')?.addEventListener('click', () => {
    const raw = cachedRegistrations.find((r) => String(r.id) === String(selectedRegistrationId));
    if (!raw) {
      setAdminStatus('Select a registration first.', 'err');
      return;
    }
    downloadSingleRegistrationPdf(raw, transformRegistration(raw));
    setAdminStatus('PDF download started.', 'ok');
  });

  document.getElementById('admin-detail-delete')?.addEventListener('click', deleteSelectedRegistration);

  if (adminBackdrop && !adminBackdrop.dataset.boundBackdrop) {
    adminBackdrop.dataset.boundBackdrop = '1';
    adminBackdrop.addEventListener('click', () => {
      selectedRegistrationId = '';
      closeDetailPanel();
      renderMasterList();
      fillDetailPanel();
    });
  }

  renderMasterList();
  if (selectedRegistrationId) fillDetailPanel();
  else {
    const inner = document.getElementById('admin-detail-inner');
    if (inner) inner.innerHTML = '<p class="admin-muted">Select a registration from the list.</p>';
  }
}

function renderLockedPlaceholder() {
  if (!adminViewRoot) return;
  setUnlockedDangerZone(false);
  closeDetailPanel();
  adminViewRoot.innerHTML = '<p class="admin-empty">Enter admin secret and click Unlock.</p>';
}

function renderEmptyUnlocked() {
  if (!adminViewRoot) return;
  setUnlockedDangerZone(true);
  setExportPanelVisible(false);
  adminViewRoot.innerHTML = '<p class="admin-empty">No registrations found.</p>';
}

async function fetchRegistrations(secret) {
  const response = await fetch(buildApiUrl('/api/admin/registrations'), {
    headers: { 'X-Admin-Secret': secret }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(formatApiDetail(result) || 'Unable to load registrations.');
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
    cachedRegistrations = registrations;
    selectedRegistrationId = '';
    listSearchQuery = '';
    if (!registrations.length) {
      renderEmptyUnlocked();
    } else {
      setUnlockedDangerZone(true);
      setExportPanelVisible(false);
      renderWorkspace();
    }
    updateExportCounts();
    setAdminStatus(`Loaded ${registrations.length} registrations.`, 'ok');
  } catch (error) {
    unlockedSecret = '';
    cachedRegistrations = [];
    renderLockedPlaceholder();
    setAdminStatus(error.message || 'Invalid admin secret.', 'err');
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
    cachedRegistrations = registrations;
    if (!document.getElementById('admin-workspace')) {
      if (!registrations.length) renderEmptyUnlocked();
      else renderWorkspace();
    } else {
      renderMasterList();
      if (selectedRegistrationId && !cachedRegistrations.some((r) => String(r.id) === String(selectedRegistrationId))) {
        selectedRegistrationId = '';
        closeDetailPanel();
      }
      fillDetailPanel();
    }
    updateExportCounts();
    setAdminStatus(`Loaded ${registrations.length} registrations.`, 'ok');
  } catch (error) {
    setAdminStatus(error.message || 'Unable to load registrations.', 'err');
  }
}

async function deleteSelectedRegistration() {
  const id = String(selectedRegistrationId || '').trim();
  if (!id) {
    setAdminStatus('Select a registration first.', 'err');
    return;
  }
  const secret = ensureUnlockedSecret();
  if (!secret) {
    setAdminStatus('Enter admin secret and click Unlock first.', 'err');
    return;
  }
  const raw = cachedRegistrations.find((r) => String(r.id) === id);
  const clean = raw ? transformRegistration(raw) : null;
  const label = clean?.primaryRegistrant?.name || id.slice(0, 8);
  if (!window.confirm(`Delete this registration for “${label}” (${id.slice(0, 8)}…)? This cannot be undone.`)) return;
  setAdminStatus('Deleting registration…', null);
  try {
    const response = await fetch(buildApiUrl(`/api/admin/registrations/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': secret }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatApiDetail(result) || 'Unable to delete registration.');
    }
    cachedRegistrations = cachedRegistrations.filter((r) => String(r.id) !== id);
    selectedRegistrationId = '';
    closeDetailPanel();
    renderMasterList();
    fillDetailPanel();
    updateExportCounts();
    if (!cachedRegistrations.length) {
      renderEmptyUnlocked();
    }
    setAdminStatus('Registration deleted.', 'ok');
  } catch (error) {
    setAdminStatus(error.message || 'Unable to delete registration.', 'err');
  }
}

async function resetAllRegistrations() {
  const secret = ensureUnlockedSecret();
  if (!secret) {
    setAdminStatus('Enter admin secret and click Unlock first.', 'err');
    return;
  }
  if (!window.confirm('Delete all registrations and reset IPL slots back to 10?')) return;
  setAdminStatus('Deleting all registration data...', null);
  try {
    const response = await fetch(buildApiUrl('/api/admin/registrations'), {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': secret }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatApiDetail(result) || 'Unable to delete registrations.');
    }
    await loadAdminRegistrations();
    setAdminStatus('All registrations deleted. IPL slots are reset to 10.', 'ok');
  } catch (error) {
    setAdminStatus(error.message || 'Unable to delete registrations.', 'err');
  }
}

function exportStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function wireExport(id, fn) {
  document.getElementById(id)?.addEventListener('click', fn);
}

wireExport('export-tech-csv', () => {
  const rows = buildTechnicalExportRows(cachedRegistrations);
  downloadRowsCsv(`pixelora-technical-teams-${exportStamp()}.csv`, TECH_EXPORT_COLS, rows);
  setAdminStatus(`Exported ${rows.length} technical team rows (CSV).`, 'ok');
});
wireExport('export-tech-xlsx', () => {
  const rows = buildTechnicalExportRows(cachedRegistrations);
  downloadRowsXlsx(`pixelora-technical-teams-${exportStamp()}.xlsx`, TECH_EXPORT_COLS, rows, 'Technical');
  setAdminStatus(`Exported ${rows.length} technical team rows (XLSX).`, 'ok');
});
wireExport('export-tech-pdf', () => {
  const rows = buildTechnicalExportRows(cachedRegistrations);
  downloadRowsPdf('PIXELORA — Technical teams', TECH_EXPORT_COLS, rows, `pixelora-technical-teams-${exportStamp()}.pdf`);
  setAdminStatus(`Exported ${rows.length} technical team rows (PDF).`, 'ok');
});

wireExport('export-nt-csv', () => {
  const rows = buildNonTechnicalExportRows(cachedRegistrations);
  downloadRowsCsv(`pixelora-nontechnical-teams-${exportStamp()}.csv`, NT_EXPORT_COLS, rows);
  setAdminStatus(`Exported ${rows.length} non-technical team rows (CSV).`, 'ok');
});
wireExport('export-nt-xlsx', () => {
  const rows = buildNonTechnicalExportRows(cachedRegistrations);
  downloadRowsXlsx(`pixelora-nontechnical-teams-${exportStamp()}.xlsx`, NT_EXPORT_COLS, rows, 'NonTechnical');
  setAdminStatus(`Exported ${rows.length} non-technical team rows (XLSX).`, 'ok');
});
wireExport('export-nt-pdf', () => {
  const rows = buildNonTechnicalExportRows(cachedRegistrations);
  downloadRowsPdf('PIXELORA — Non-technical teams', NT_EXPORT_COLS, rows, `pixelora-nontechnical-teams-${exportStamp()}.pdf`);
  setAdminStatus(`Exported ${rows.length} non-technical team rows (PDF).`, 'ok');
});

wireExport('export-food-csv', () => {
  const rows = buildFoodExportRows(cachedRegistrations);
  downloadRowsCsv(`pixelora-food-${exportStamp()}.csv`, FOOD_EXPORT_COLS, rows);
  setAdminStatus(`Exported ${rows.length} food rows (CSV).`, 'ok');
});
wireExport('export-food-xlsx', () => {
  const rows = buildFoodExportRows(cachedRegistrations);
  downloadRowsXlsx(`pixelora-food-${exportStamp()}.xlsx`, FOOD_EXPORT_COLS, rows, 'Food');
  setAdminStatus(`Exported ${rows.length} food rows (XLSX).`, 'ok');
});
wireExport('export-food-pdf', () => {
  const rows = buildFoodExportRows(cachedRegistrations);
  downloadRowsPdf('PIXELORA — Food summary (all participants)', FOOD_EXPORT_COLS, rows, `pixelora-food-${exportStamp()}.pdf`);
  setAdminStatus(`Exported ${rows.length} food rows (PDF).`, 'ok');
});

wireExport('export-json', () => {
  const payload = cachedRegistrations.map((raw) => ({
    ...cloneForJson(raw),
    _canonical: transformRegistration(raw)
  }));
  downloadBlob(JSON.stringify(payload, null, 2), `pixelora-registrations-full-${exportStamp()}.json`, 'application/json;charset=utf-8');
  setAdminStatus('JSON export started.', 'ok');
});

if (adminUnlock) adminUnlock.addEventListener('click', unlockAdminPortal);
if (adminRefresh) adminRefresh.addEventListener('click', loadAdminRegistrations);
if (adminReset) adminReset.addEventListener('click', resetAllRegistrations);
if (adminExportToggle) {
  adminExportToggle.addEventListener('click', () => {
    if (adminExportToggle.disabled) return;
    const open = adminExportBar && !adminExportBar.classList.contains('is-hidden');
    setExportPanelVisible(!open);
  });
}

if (adminSecret) {
  adminSecret.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      unlockAdminPortal();
    }
  });
  adminSecret.value = getSecretFromStorage();
}

if (sessionStorage.getItem(ADMIN_SHORTCUT_AUTH_KEY) && getSecretFromStorage()) {
  unlockAdminPortal();
} else {
  renderLockedPlaceholder();
  setAdminStatus('Enter admin secret and click Unlock to continue.', null);
}
