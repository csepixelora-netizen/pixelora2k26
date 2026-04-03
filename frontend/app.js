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
const TECHNICAL_EVENTS_WITHOUT_TEAM_DETAILS = new Set(['Devfolio', 'Promptcraft']);
const adminPortal = document.getElementById('admin-portal');
const adminClose = document.getElementById('admin-close');
const adminRefresh = document.getElementById('admin-refresh');
const adminDownload = document.getElementById('admin-download');
const adminReset = document.getElementById('admin-reset');
const adminSecret = document.getElementById('admin-secret');
const adminStatus = document.getElementById('admin-status');
const adminTableBody = document.getElementById('admin-table-body');
const technicalTeamDetails = document.getElementById('technical-team-details');
const nonTechnicalTeamDetails = document.getElementById('nontechnical-team-details');

const TEAM_RULES = {
  Innopitch: { min: 3, max: 3 },
  'E-Sports (Free fire)': { min: 4, max: 4 },
  'IPL Auction': { min: 3, max: 3 },
  'Channel Surfing': { min: 3, max: 3 },
  'Visual Connect': { min: 1, max: 3 },
  Devfolio: { min: 1, max: 1 },
  Promptcraft: { min: 1, max: 1 }
};

const IPL_TOTAL_SLOTS = 10;
let iplRegisteredTeams = 0;
let iplStatusPollHandle = null;

const APP_CONFIG = window.__PIXELORA_CONFIG__ || {};
const API_BASE_URL = String(APP_CONFIG.apiBaseUrl || '').trim().replace(/\/+$/, '');

function buildApiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
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

    renderAdminRegistrations(Array.isArray(result.registrations) ? result.registrations : []);
    setAdminStatus(`Loaded ${Array.isArray(result.registrations) ? result.registrations.length : 0} registrations.`, 'ok');
  } catch (error) {
    setAdminStatus(error.message || 'Unable to load registrations.', 'err');
    adminTableBody.innerHTML = '<tr><td class="admin-empty" colspan="6">Unable to load registrations.</td></tr>';
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
  } catch (_error) {
    updateIplSlotUI();
  }
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

addEventListener('keydown', (event) => {
  const isCtrlF7 = event.ctrlKey && event.key === 'F7';
  const isMetaF7 = event.metaKey && event.key === 'F7';

  if (isCtrlF7 || isMetaF7) {
    event.preventDefault();
    if (adminPortal?.classList.contains('open')) {
      closeAdminPortal();
    } else {
      openAdminPortal();
    }
  }

  if (event.key === 'Escape' && adminPortal?.classList.contains('open')) {
    closeAdminPortal();
  }
});

if (adminPortal) {
  adminPortal.addEventListener('click', (event) => {
    if (event.target === adminPortal) {
      closeAdminPortal();
    }
  });
}

if (regForm) {
  regForm.querySelectorAll('input[name="technicalEvents"]').forEach((input) => {
    input.addEventListener('change', () => updateTeamDetails('technical'));
  });

  regForm.querySelectorAll('input[name="nonTechnicalEvents"]').forEach((input) => {
    input.addEventListener('change', () => updateTeamDetails('nontechnical'));
  });

  if (technicalTeamDetails) {
    technicalTeamDetails.addEventListener('change', (event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.name === 'technicalTeamSize') {
        updateTeamDetails('technical');
      }
    });
  }

  if (nonTechnicalTeamDetails) {
    nonTechnicalTeamDetails.addEventListener('change', (event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.name === 'nontechnicalTeamSize') {
        updateTeamDetails('nontechnical');
      }
    });
  }

  refreshTeamDetails();
}

function setRegStatus(message, type) {
  if (!regStatus) return;
  regStatus.textContent = message;
  regStatus.classList.remove('ok', 'err');
  if (type) regStatus.classList.add(type);
}

function getTeamRule(eventName) {
  return TEAM_RULES[eventName] || { min: 1, max: 1 };
}

function createTeamDetailsMarkup(groupName, selectedEvent, selectedSize) {
  if (!selectedEvent) return '';

  if (groupName === 'technical' && TECHNICAL_EVENTS_WITHOUT_TEAM_DETAILS.has(selectedEvent)) {
    return '';
  }

  const safeGroup = groupName === 'technical' ? 'technical' : 'nontechnical';
  const rule = getTeamRule(selectedEvent);
  const teamSize = Math.min(rule.max, Math.max(rule.min, Number(selectedSize) || rule.min));
  const memberCount = Math.max(0, teamSize - 1);
  const sizeHint = rule.min === rule.max ? `Team size: ${rule.max}` : `Team size: ${rule.min} to ${rule.max}`;

  let memberRows = '';
  for (let idx = 1; idx <= memberCount; idx += 1) {
    memberRows += `
      <label class="reg-field">
        <span>Team Member ${idx} Name</span>
        <input type="text" name="${safeGroup}TeamMember${idx}" required>
      </label>
    `;
  }

  return `
    <div class="team-head">
      <span class="team-title">${selectedEvent} Team Details</span>
      <span class="team-hint">${sizeHint}</span>
    </div>
    <label class="reg-field">
      <span>Team Name</span>
      <input type="text" name="${safeGroup}TeamName" required>
    </label>
    <label class="reg-field">
      <span>Team Leader Name</span>
      <input type="text" name="${safeGroup}TeamLeader" required>
    </label>
    ${
      rule.min !== rule.max
        ? `<label class="reg-field">
            <span>Team Size</span>
            <select name="${safeGroup}TeamSize" required>
              ${Array.from({ length: rule.max - rule.min + 1 }, (_, i) => {
                const size = rule.min + i;
                const selected = size === teamSize ? 'selected' : '';
                return `<option value="${size}" ${selected}>${size} members</option>`;
              }).join('')}
            </select>
          </label>`
        : `<input type="hidden" name="${safeGroup}TeamSize" value="${teamSize}">`
    }
    <div class="team-members team-member-row">
      ${memberRows}
    </div>
  `;
}

function updateTeamDetails(groupName) {
  if (!regForm) return;

  const isTechnical = groupName === 'technical';
  const container = isTechnical ? technicalTeamDetails : nonTechnicalTeamDetails;
  if (!container) return;

  const eventField = isTechnical ? 'technicalEvents' : 'nonTechnicalEvents';
  const selectedEvent = regForm.querySelector(`input[name="${eventField}"]:checked`)?.value || '';
  const selectedSize = container.querySelector(`select[name="${groupName}TeamSize"]`)?.value;

  if (isTechnical && TECHNICAL_EVENTS_WITHOUT_TEAM_DETAILS.has(selectedEvent)) {
    container.classList.add('empty');
    container.innerHTML = '';
    return;
  }

  if (!selectedEvent) {
    container.classList.add('empty');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('empty');
  container.innerHTML = createTeamDetailsMarkup(groupName, selectedEvent, selectedSize);
}

function refreshTeamDetails() {
  updateTeamDetails('technical');
  updateTeamDetails('nontechnical');
}

window.refreshTeamDetails = refreshTeamDetails;

function collectTeamDetails(groupName, formData) {
  const eventField = groupName === 'technical' ? 'technicalEvents' : 'nonTechnicalEvents';
  const label = groupName === 'technical' ? 'technical' : 'non-technical';
  const selectedEvent = String(formData.get(eventField) || '').trim();

  if (!selectedEvent) {
    return { ok: false, error: `Please select one ${label} event.` };
  }

  if (groupName === 'technical' && TECHNICAL_EVENTS_WITHOUT_TEAM_DETAILS.has(selectedEvent)) {
    return {
      ok: true,
      data: { teamName: '', teamLeader: '', teamSize: 1, members: [] }
    };
  }

  const rule = getTeamRule(selectedEvent);
  const teamName = String(formData.get(`${groupName}TeamName`) || '').trim();
  const teamLeader = String(formData.get(`${groupName}TeamLeader`) || '').trim();
  const teamSize = Math.min(rule.max, Math.max(rule.min, Number(formData.get(`${groupName}TeamSize`) || rule.min)));

  if (!teamName || !teamLeader) {
    return { ok: false, error: `Please fill ${label} team name and leader details.` };
  }

  const members = [];
  for (let idx = 1; idx <= Math.max(0, teamSize - 1); idx += 1) {
    const memberName = String(formData.get(`${groupName}TeamMember${idx}`) || '').trim();
    if (!memberName) {
      return { ok: false, error: `Please fill ${label} team member ${idx} name.` };
    }
    members.push(memberName);
  }

  return {
    ok: true,
    data: {
      event: selectedEvent,
      teamName,
      teamLeader,
      teamSize,
      members
    }
  };
}

if (regForm && regSubmit) {
  regForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (window.location.protocol === 'file:') {
      setRegStatus('Please run through backend server to submit the form.', 'err');
      return;
    }

    const formData = new FormData(regForm);
    const paymentScreenshot = formData.get('paymentScreenshot');

    const required = {
      name: String(formData.get('name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      whatsapp: String(formData.get('whatsapp') || '').trim(),
      year: String(formData.get('year') || '').trim(),
      collegeName: String(formData.get('collegeName') || '').trim(),
      departmentName: String(formData.get('departmentName') || '').trim(),
      food: String(formData.get('food') || '').trim()
    };

    if (Object.values(required).some((value) => !value)) {
      setRegStatus('Please fill all required fields.', 'err');
      return;
    }

    const technicalEvents = String(formData.get('technicalEvents') || '').trim();
    const nonTechnicalEvents = String(formData.get('nonTechnicalEvents') || '').trim();

    if (!technicalEvents) {
      setRegStatus('Please select one technical event.', 'err');
      return;
    }

    if (!nonTechnicalEvents) {
      setRegStatus('Please select one non-technical event.', 'err');
      return;
    }

    const selectedIplAuction = nonTechnicalEvents === 'IPL Auction';
    if (selectedIplAuction && getIplSlotsLeft() <= 0) {
      setRegStatus('IPL Auction slots are full. Please choose another non-technical event.', 'err');
      updateIplSlotUI();
      return;
    }

    const technicalTeam = collectTeamDetails('technical', formData);
    if (!technicalTeam.ok) {
      setRegStatus(technicalTeam.error, 'err');
      return;
    }

    const nonTechnicalTeam = collectTeamDetails('nontechnical', formData);
    if (!nonTechnicalTeam.ok) {
      setRegStatus(nonTechnicalTeam.error, 'err');
      return;
    }

    formData.set('technicalTeamName', technicalTeam.data.teamName);
    formData.set('technicalTeamLeader', technicalTeam.data.teamLeader);
    formData.set('technicalTeamSize', String(technicalTeam.data.teamSize));
    formData.set('technicalTeamMembers', JSON.stringify(technicalTeam.data.members));

    formData.set('nonTechnicalTeamName', nonTechnicalTeam.data.teamName);
    formData.set('nonTechnicalTeamLeader', nonTechnicalTeam.data.teamLeader);
    formData.set('nonTechnicalTeamSize', String(nonTechnicalTeam.data.teamSize));
    formData.set('nonTechnicalTeamMembers', JSON.stringify(nonTechnicalTeam.data.members));

    if (!(paymentScreenshot instanceof File) || !paymentScreenshot.name) {
      setRegStatus('Please upload your payment screenshot.', 'err');
      return;
    }

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
        throw new Error(result.error || 'Submission failed.');
      }

      regForm.reset();
      refreshTeamDetails();
      await loadIplSlotStatus();
      setRegStatus('Registered successfully. See you at PIXELORA 2K26!', 'ok');
    } catch (error) {
      setRegStatus(error.message || 'Unable to submit right now. Try again later.', 'err');
    } finally {
      regSubmit.disabled = false;
      regSubmit.textContent = 'Submit Registration';
    }
  });
}
