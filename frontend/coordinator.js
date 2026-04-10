const COORDINATOR_SESSION_KEY = 'pixelora-coordinator-session';
const SURFACE_AUTH_HEADER = 'CSE';

const COORD_EXPORT_COLS = ['Team ID', 'Event', 'Leader', 'Member Name', 'Role', 'Phone', 'Email'];

const APP_CONFIG = window.__PIXELORA_CONFIG__ || {};
const configuredApiBaseUrl = String(APP_CONFIG.apiBaseUrl || '').trim().replace(/\/+$/, '');
const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocalHost ? '' : configuredApiBaseUrl;

const SR = window.PixeloraSharedReg;
if (!SR || typeof SR.buildCoordinatorTeamsForEvent !== 'function') {
  throw new Error('shared-registrations.js must load before coordinator.js');
}

const {
  extractEventCatalog,
  buildCoordinatorTeamsForEvent,
  flattenCoordinatorExportRows,
  normalizeEventCatalogKey
} = SR;

function buildApiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readCoordinatorSession() {
  try {
    const raw = sessionStorage.getItem(COORDINATOR_SESSION_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.eventNorm) return null;
    return d;
  } catch {
    return null;
  }
}

function setCoordStatus(message, type) {
  const el = document.getElementById('coord-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('ok', 'err');
  if (type === 'ok' || type === 'err') el.classList.add(type);
}

function exportStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
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

function downloadRowsCsv(filename, columns, rows) {
  downloadBlob(rowsToCsv(columns, rows), filename, 'text/csv;charset=utf-8');
}

function downloadRowsXlsx(filename, columns, rows, sheetName) {
  if (typeof XLSX === 'undefined') {
    setCoordStatus('XLSX library unavailable; downloaded CSV instead.', 'err');
    downloadRowsCsv(filename.replace(/\.xlsx$/i, '.csv'), columns, rows);
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Export');
  XLSX.writeFile(wb, filename);
}

function renderCoordinatorResults(teams) {
  const el = document.getElementById('coord-results');
  if (!el) return;
  if (!teams.length) {
    el.innerHTML = '<p class="admin-muted">No teams for this event.</p>';
    return;
  }
  el.innerHTML = teams
    .map(
      (t) => `
    <article class="coord-team-card">
      <header class="coord-team-head">
        <div class="coord-team-head__line"><span class="coord-muted">Team ID</span> <strong>${escapeHtml(t.teamId)}</strong></div>
        <div class="coord-team-head__line"><span class="coord-muted">Team</span> <strong>${escapeHtml(t.teamName)}</strong></div>
        <div class="coord-team-head__line"><span class="coord-muted">Leader</span> <strong>${escapeHtml(t.leaderName)}</strong></div>
        <div class="coord-team-head__line coord-team-head__track"><span class="admin-pill admin-pill--dense">${escapeHtml(t.track)}</span></div>
      </header>
      <div class="admin-panel admin-panel--table admin-panel--dense">
        <table class="admin-data-table admin-data-table--dense">
          <thead><tr><th>Member Name</th><th>Role</th><th>Phone</th><th>Email</th></tr></thead>
          <tbody>
            ${t.memberRows
              .map(
                (r) => `
              <tr>
                <td>${escapeHtml(r.memberName)}</td>
                <td>${escapeHtml(r.role)}</td>
                <td>${escapeHtml(r.phone || '—')}</td>
                <td>${escapeHtml(r.email || '—')}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </article>`
    )
    .join('');
}

function downloadCoordinatorGroupedPdf(teams, eventLabel, filename) {
  const jspdf = window.jspdf;
  if (!jspdf || typeof jspdf.jsPDF !== 'function') {
    setCoordStatus('PDF library unavailable.', 'err');
    return;
  }
  const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  let y = 42;
  doc.setFontSize(12);
  doc.text(`PIXELORA — ${String(eventLabel || 'Event')}`, 40, y);
  y += 20;
  doc.setFontSize(8);
  teams.forEach((t) => {
    if (y > 700) {
      doc.addPage();
      y = 40;
    }
    doc.setFontSize(9);
    doc.text(`${t.teamId} · ${t.teamName} · Leader: ${t.leaderName} · ${t.track}`, 40, y);
    y += 12;
    const body = t.memberRows.map((r) => [r.memberName, r.role, r.phone || '', r.email || '']);
    doc.autoTable({
      startY: y,
      head: [['Member Name', 'Role', 'Phone', 'Email']],
      body,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [79, 91, 137] },
      margin: { left: 36, right: 36 }
    });
    y = doc.lastAutoTable.finalY + 20;
  });
  doc.save(filename);
}

let coordinatorTeams = [];
let coordinatorFlatRows = [];
let coordinatorSelectionNorm = '';
let coordinatorSelectionLabel = '';

async function loadCoordinatorData() {
  const session = readCoordinatorSession();
  if (!session) {
    window.location.replace('index.html');
    return;
  }
  coordinatorSelectionNorm = String(session.eventNorm || '').trim();
  coordinatorSelectionLabel = String(session.eventLabel || coordinatorSelectionNorm).trim();
  const titleEl = document.getElementById('coord-event-title');
  if (titleEl) titleEl.textContent = coordinatorSelectionLabel;

  setCoordStatus('Loading teams…', null);
  try {
    const response = await fetch(buildApiUrl('/api/surface/registrations'), {
      headers: { 'X-Surface-Auth': SURFACE_AUTH_HEADER }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof result.detail === 'string' ? result.detail : 'Unable to load data.';
      throw new Error(detail);
    }
    const registrations = Array.isArray(result.registrations) ? result.registrations : [];
    const catalog = extractEventCatalog(registrations);
    if (!catalog.has(coordinatorSelectionNorm)) {
      setCoordStatus('This event is no longer present in registrations. Close and pick again from the site.', 'err');
      coordinatorTeams = [];
      coordinatorFlatRows = [];
      renderCoordinatorResults([]);
      const xb = document.getElementById('coord-export-xlsx');
      const pb = document.getElementById('coord-export-pdf');
      if (xb) xb.disabled = true;
      if (pb) pb.disabled = true;
      return;
    }
    coordinatorTeams = buildCoordinatorTeamsForEvent(
      registrations,
      coordinatorSelectionNorm,
      coordinatorSelectionLabel
    );
    coordinatorFlatRows = flattenCoordinatorExportRows(coordinatorTeams);
    renderCoordinatorResults(coordinatorTeams);
    setCoordStatus(`Showing ${coordinatorTeams.length} team(s) for “${coordinatorSelectionLabel}”.`, 'ok');
    const xb = document.getElementById('coord-export-xlsx');
    const pb = document.getElementById('coord-export-pdf');
    if (xb) xb.disabled = !coordinatorFlatRows.length;
    if (pb) pb.disabled = !coordinatorTeams.length;
  } catch (err) {
    setCoordStatus(err.message || 'Unable to load teams.', 'err');
  }
}

document.getElementById('coord-refresh')?.addEventListener('click', () => {
  void loadCoordinatorData();
});

document.getElementById('coord-export-xlsx')?.addEventListener('click', () => {
  if (!coordinatorFlatRows.length) return;
  const stamp = exportStamp();
  downloadRowsXlsx(
    `pixelora-event-${normalizeEventCatalogKey(coordinatorSelectionLabel).replace(/[^A-Z0-9]+/g, '-')}-${stamp}.xlsx`,
    COORD_EXPORT_COLS,
    coordinatorFlatRows,
    'Event'
  );
  setCoordStatus('Excel export started.', 'ok');
});

document.getElementById('coord-export-pdf')?.addEventListener('click', () => {
  if (!coordinatorTeams.length) return;
  const stamp = exportStamp();
  downloadCoordinatorGroupedPdf(
    coordinatorTeams,
    coordinatorSelectionLabel,
    `pixelora-event-${normalizeEventCatalogKey(coordinatorSelectionLabel).replace(/[^A-Z0-9]+/g, '-')}-${stamp}.pdf`
  );
  setCoordStatus('PDF export started.', 'ok');
});

void loadCoordinatorData();
