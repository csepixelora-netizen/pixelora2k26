(function (global) {
const EMPTY_PRIMARY = {
  name: '',
  email: '',
  phone: '',
  collegeName: '',
  departmentName: '',
  year: '',
  food: ''
};

function normalizeMatchName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Prefer non-empty fields when the same person appears twice (e.g. root teamMembers + sessionData). */
function mergeMemberRecords(a, b) {
  const best = (x, y) => {
    const tx = String(x ?? '').trim();
    const ty = String(y ?? '').trim();
    return ty || tx;
  };
  return {
    ...a,
    ...b,
    memberId: best(a.memberId, b.memberId) || String(a.memberId || b.memberId || '').trim(),
    name: best(a.name, b.name) || String(a.name || b.name || '').trim(),
    email: best(a.email, b.email),
    phone: best(a.phone, b.phone),
    food: best(a.food, b.food),
    collegeName: best(a.collegeName, b.collegeName),
    departmentName: best(a.departmentName, b.departmentName),
    technicalEvent: best(a.technicalEvent, b.technicalEvent),
    nonTechnicalEvent: best(a.nonTechnicalEvent, b.nonTechnicalEvent),
    technical_used: Boolean(a.technical_used || b.technical_used),
    nontechnical_used: Boolean(a.nontechnical_used || b.nontechnical_used)
  };
}

function transformRegistration(raw) {
  const pr = raw.primaryRegistrant;
  const ev = raw.events;
  const hasPrimary = pr && typeof pr === 'object' && String(pr.name || '').trim();
  const hasEvents =
    ev &&
    typeof ev === 'object' &&
    Object.prototype.hasOwnProperty.call(ev, 'technical') &&
    Object.prototype.hasOwnProperty.call(ev, 'nonTechnical');

  if (hasPrimary && hasEvents) {
    const session = getSessionDataObject(raw);
    const primary = { ...EMPTY_PRIMARY, ...pr };
    if (!String(primary.phone || '').trim() && raw.whatsapp) primary.phone = String(raw.whatsapp || '').trim();
    if (!String(primary.food || '').trim() && raw.food) primary.food = String(raw.food || '').trim();
    if (!String(primary.collegeName || '').trim() && raw.collegeName) primary.collegeName = String(raw.collegeName || '').trim();
    if (!String(primary.departmentName || '').trim() && raw.departmentName) {
      primary.departmentName = String(raw.departmentName || '').trim();
    }
    const pool = mergedMemberPool(raw);
    const rebuilt = buildEventsStructureJs(primary, raw, pool);
    const events = applyEventsEnrichment(rebuilt, pool, primary);
    return {
      id: raw.id || '',
      createdAt: raw.createdAt || '',
      primaryRegistrant: primary,
      events: {
        technical: events.technical || null,
        nonTechnical: events.nonTechnical || null
      },
      _memberPool: pool,
      _meta: {
        paymentScreenshot: raw.paymentScreenshot || '',
        wizardStep: session.step
      }
    };
  }
  return legacyToCanonical(raw);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Wizard snapshot: APIs sometimes return sessionData as a JSON string (e.g. CSV export path). */
function getSessionDataObject(raw) {
  const sd = raw?.sessionData;
  if (sd && typeof sd === 'object' && !Array.isArray(sd)) return sd;
  if (typeof sd === 'string' && sd.trim()) {
    try {
      const p = JSON.parse(sd);
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

function mergedMemberPool(raw) {
  const combined = [];
  parseJsonArray(raw.teamMembers).forEach((m) => {
    if (m && typeof m === 'object') combined.push(m);
  });
  const session = getSessionDataObject(raw);
  parseJsonArray(session.teamMembers).forEach((m) => {
    if (m && typeof m === 'object') combined.push(m);
  });
  const byKey = new Map();
  combined.forEach((m) => {
    const key =
      String(m.memberId || '')
        .trim()
        .toLowerCase() ||
      `${String(m.email || '')
        .trim()
        .toLowerCase()}|${normalizeMatchName(m.name)}`;
    if (!key) return;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...m });
      return;
    }
    byKey.set(key, mergeMemberRecords(prev, m));
  });
  return Array.from(byKey.values());
}

function enrichEventTeamContacts(block, pool, primary) {
  if (!block?.team) return block;
  const members = (block.team.members || []).map((m) => {
    const nm = String(m?.name || '').trim();
    if (!nm) return m;
    const r = resolveContact(nm, pool, primary);
    return {
      ...m,
      email: String(r.email || m.email || '').trim(),
      phone: String(r.phone || m.phone || '').trim(),
      food: String(r.food || m.food || '').trim(),
      collegeName: String(r.collegeName || m.collegeName || '').trim(),
      departmentName: String(r.departmentName || m.departmentName || '').trim()
    };
  });
  return { ...block, team: { ...block.team, members } };
}

function applyEventsEnrichment(events, pool, primary) {
  if (!events || typeof events !== 'object') return events;
  return {
    technical: events.technical ? enrichEventTeamContacts(events.technical, pool, primary) : null,
    nonTechnical: events.nonTechnical ? enrichEventTeamContacts(events.nonTechnical, pool, primary) : null
  };
}

function normalizeTeamJs(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  let members = data.members;
  if (typeof members === 'string' && members.trim()) {
    try {
      members = JSON.parse(members);
    } catch {
      members = [];
    }
  }
  if (!Array.isArray(members)) members = [];
  return {
    teamName: String(data.teamName || ''),
    teamLeader: String(data.teamLeader || ''),
    teamSize: String(data.teamSize || ''),
    members: members.map((m) => String(m ?? '').trim()).filter(Boolean)
  };
}

function parsePrimaryFromLegacy(raw) {
  const pr = raw.primaryRegistrant;
  if (pr && typeof pr === 'object' && String(pr.name || '').trim()) {
    return {
      name: String(pr.name || '').trim(),
      email: String(pr.email || '').trim(),
      phone: String(pr.phone || pr.whatsapp || '').trim(),
      collegeName: String(pr.collegeName || '').trim(),
      departmentName: String(pr.departmentName || '').trim(),
      year: String(pr.year || '').trim(),
      food: String(pr.food || '').trim()
    };
  }
  return {
    name: String(raw.name || '').trim(),
    email: String(raw.email || '').trim(),
    phone: String(raw.whatsapp || '').trim(),
    collegeName: String(raw.collegeName || '').trim(),
    departmentName: String(raw.departmentName || '').trim(),
    year: String(raw.year || '').trim(),
    food: String(raw.food || '').trim()
  };
}

function formatAffiliatedName(name, college, dept) {
  const n = String(name || '').trim();
  const c = String(college || '').trim();
  const d = String(dept || '').trim();
  const affil = [c, d].filter(Boolean).join(' · ');
  if (!n && !affil) return '';
  if (!affil) return n;
  return `${n} (${affil})`;
}

function resolveContact(name, pool, primary) {
  const label = String(name || '').trim();
  if (!label) return { name: '', email: '', phone: '', food: '', collegeName: '', departmentName: '' };
  const nameKey = normalizeMatchName(label);
  const hit = pool.find((m) => normalizeMatchName(m.name) === nameKey);
  if (hit) {
    return {
      name: label,
      email: String(hit.email || '').trim(),
      phone: String(hit.phone || '').trim(),
      food: String(hit.food || '').trim(),
      collegeName: String(hit.collegeName || '').trim(),
      departmentName: String(hit.departmentName || '').trim()
    };
  }
  if (normalizeMatchName(primary.name) === nameKey) {
    return {
      name: label,
      email: String(primary.email || '').trim(),
      phone: String(primary.phone || '').trim(),
      food: String(primary.food || '').trim(),
      collegeName: String(primary.collegeName || '').trim(),
      departmentName: String(primary.departmentName || '').trim()
    };
  }
  return { name: label, email: '', phone: '', food: '', collegeName: '', departmentName: '' };
}

function dedupeContacts(list) {
  const out = [];
  const seen = new Set();
  list.forEach((c) => {
    const key =
      String(c.email || '')
        .trim()
        .toLowerCase() || normalizeMatchName(c.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(c);
  });
  return out;
}

function buildEventBlockJs(eventName, teamBlob, pool, primary, poolEventKey, poolUsedKey) {
  const name = String(eventName || '').trim();
  if (!name) return null;
  const team = normalizeTeamJs(teamBlob);
  const leader = String(team.teamLeader || primary.name || '').trim();
  const rosterNames = [];
  const seenLower = new Set();

  const leaderKey = leader ? normalizeMatchName(leader) : '';

  team.members.forEach((teammate) => {
    const n = String(teammate || '').trim();
    if (!n) return;
    const nl = normalizeMatchName(n);
    if (seenLower.has(nl)) return;
    if (leaderKey && nl === leaderKey) return;
    seenLower.add(nl);
    rosterNames.push(n);
  });

  pool.forEach((m) => {
    const poolEvent = String(m[poolEventKey] || '').trim();
    const matches = name && poolEvent === name;
    const used = Boolean(m[poolUsedKey]);
    if (!matches && !used) return;
    const n = String(m.name || '').trim();
    if (!n) return;
    const nl = normalizeMatchName(n);
    if (leaderKey && nl === leaderKey) return;
    if (seenLower.has(nl)) return;
    seenLower.add(nl);
    rosterNames.push(n);
  });

  const members = dedupeContacts(rosterNames.map((n) => resolveContact(n, pool, primary)));
  return { name, team: { leader, members } };
}

function buildEventsStructureJs(primary, raw, pool) {
  return {
    technical: buildEventBlockJs(
      raw.technicalEvents,
      raw.technicalTeam,
      pool,
      primary,
      'technicalEvent',
      'technical_used'
    ),
    nonTechnical: buildEventBlockJs(
      raw.nonTechnicalEvents,
      raw.nonTechnicalTeam,
      pool,
      primary,
      'nonTechnicalEvent',
      'nontechnical_used'
    )
  };
}

function legacyToCanonical(raw) {
  const parsed = parsePrimaryFromLegacy(raw);
  const primary = { ...EMPTY_PRIMARY, ...parsed };
  if (!String(primary.phone || '').trim() && raw.whatsapp) primary.phone = String(raw.whatsapp || '').trim();
  if (!String(primary.food || '').trim() && raw.food) primary.food = String(raw.food || '').trim();
  if (!String(primary.collegeName || '').trim() && raw.collegeName) primary.collegeName = String(raw.collegeName || '').trim();
  if (!String(primary.departmentName || '').trim() && raw.departmentName) {
    primary.departmentName = String(raw.departmentName || '').trim();
  }
  const pool = mergedMemberPool(raw);
  const rebuilt = buildEventsStructureJs(primary, raw, pool);
  const events = applyEventsEnrichment(rebuilt, pool, primary);
  const session = getSessionDataObject(raw);
  return {
    id: raw.id || '',
    createdAt: raw.createdAt || '',
    primaryRegistrant: primary,
    events,
    _memberPool: pool,
    _meta: {
      paymentScreenshot: raw.paymentScreenshot || '',
      wizardStep: session.step
    }
  };
}

function leaderLookupPoolFromClean(clean) {
  const list = [];
  (clean._memberPool || []).forEach((m) => list.push(m));
  (clean.events?.technical?.team?.members || []).forEach((m) => list.push(m));
  (clean.events?.nonTechnical?.team?.members || []).forEach((m) => list.push(m));
  const byKey = new Map();
  list.forEach((m) => {
    if (!m || typeof m !== 'object') return;
    const k = normalizeMatchName(m.name);
    if (!k) return;
    const prev = byKey.get(k);
    byKey.set(k, prev ? mergeMemberRecords(prev, m) : { ...m });
  });
  return Array.from(byKey.values());
}

function resolveLeaderContact(clean, leaderName) {
  const name = String(leaderName || '').trim();
  const pr = clean.primaryRegistrant;
  if (name && normalizeMatchName(name) === normalizeMatchName(pr.name)) {
    return {
      name: pr.name,
      email: pr.email,
      phone: pr.phone,
      food: String(pr.food || '').trim(),
      collegeName: String(pr.collegeName || '').trim(),
      departmentName: String(pr.departmentName || '').trim()
    };
  }
  const lookupPool = leaderLookupPoolFromClean(clean);
  const r = resolveContact(name, lookupPool, pr);
  if (
    String(r.email || '').trim() ||
    String(r.phone || '').trim() ||
    String(r.food || '').trim() ||
    String(r.collegeName || '').trim() ||
    String(r.departmentName || '').trim()
  ) {
    return {
      name: name || r.name || '\u2014',
      email: String(r.email || '').trim(),
      phone: String(r.phone || '').trim(),
      food: String(r.food || '').trim(),
      collegeName: String(r.collegeName || '').trim(),
      departmentName: String(r.departmentName || '').trim()
    };
  }
  return {
    name: name || '\u2014',
    email: '\u2014',
    phone: '\u2014',
    food: '\u2014',
    collegeName: '',
    departmentName: ''
  };
}

/** Dedupe food/participant rows without collapsing different people who share a name. */
function personDedupeKey(person, teamId) {
  const tid = String(teamId || '').trim();
  const name = normalizeMatchName(person?.name);
  const phone = String(person?.phone || '').replace(/\D/g, '');
  const email = String(person?.email || '').trim().toLowerCase();
  if (phone) return `${tid}|p:${phone}|n:${name}`;
  if (email) return `${tid}|e:${email}|n:${name}`;
  if (name) return `${tid}|n:${name}`;
  return '';
}

function normalizeEventCatalogKey(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

/** Display venue for exports (aligned with public event cards where listed). */
const EVENT_VENUE_LABELS = {
  Innopitch: 'Main Block Auditorium',
  Devfolio: 'CSE Main Lab',
  DevFolio: 'CSE Main Lab',
  Promptcraft: 'Multimedia Lab',
  'E-Sports (Free fire)': 'Main Block Auditorium',
  'IPL Auction': 'Main Block Auditorium',
  'Channel Surfing': 'Main Block Auditorium',
  'Visual Content': 'Main Block Auditorium',
  'Visual Connect': 'Main Block Auditorium'
};

function getEventVenueLabel(eventName) {
  const key = String(eventName || '').trim();
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(EVENT_VENUE_LABELS, key)) return EVENT_VENUE_LABELS[key];
  const hit = Object.keys(EVENT_VENUE_LABELS).find((k) => k.toUpperCase() === key.toUpperCase());
  return hit ? EVENT_VENUE_LABELS[hit] : 'Main Block Auditorium';
}

/** Map normalized name -> first human-readable label seen (list never exposed in UI). */
function extractEventCatalog(registrations) {
  const map = new Map();
  registrations.forEach((raw) => {
    const candidates = [
      raw.technicalEvents,
      raw.nonTechnicalEvents,
      raw.events?.technical?.name,
      raw.events?.nonTechnical?.name
    ];
    candidates.forEach((v) => {
      const label = String(v || '').trim();
      if (!label) return;
      const key = normalizeEventCatalogKey(label);
      if (!map.has(key)) map.set(key, label);
    });
  });
  return map;
}

function registrationTechKey(raw) {
  return normalizeEventCatalogKey(raw.technicalEvents || raw.events?.technical?.name || '');
}

function registrationNtKey(raw) {
  return normalizeEventCatalogKey(raw.nonTechnicalEvents || raw.events?.nonTechnical?.name || '');
}

function registrationMatchesEventNorm(raw, targetNorm) {
  const t = registrationTechKey(raw);
  const n = registrationNtKey(raw);
  return (t && t === targetNorm) || (n && n === targetNorm);
}

function teamDisplayNameFromRaw(raw, isTechnical) {
  const blob = isTechnical ? raw.technicalTeam : raw.nonTechnicalTeam;
  const t = normalizeTeamJs(blob || {});
  const nm = String(t.teamName || '').trim();
  if (nm) return nm;
  const clean = transformRegistration(raw);
  const block = isTechnical ? clean.events?.technical : clean.events?.nonTechnical;
  return String(block?.name || 'Team').trim() || '\u2014';
}

function buildMemberTableRows(clean, leaderName, rosterMembers) {
  const leader = resolveLeaderContact(clean, leaderName);
  const rows = [];
  const seen = new Set();
  const add = (contact, role) => {
    const nm = String(contact.name || '').trim().toLowerCase();
    const em = String(contact.email || '').trim().toLowerCase();
    const ph = String(contact.phone || '').replace(/\D/g, '');
    const key = `${nm}|${em}|${ph}`;
    if (!String(contact.name || '').trim() && !em && !ph) return;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      memberName: String(contact.name || '\u2014').trim() || '\u2014',
      role,
      phone: String(contact.phone || '').trim(),
      email: String(contact.email || '').trim(),
      collegeName: String(contact.collegeName || '').trim(),
      departmentName: String(contact.departmentName || '').trim(),
      food: String(contact.food || '').trim()
    });
  };
  add(leader, 'Leader');
  (rosterMembers || []).forEach((m, i) => {
    if (normalizeMatchName(m.name) && normalizeMatchName(m.name) === normalizeMatchName(leader.name)) return;
    add(m, `Member ${i + 1}`);
  });
  return rows;
}

function buildCoordinatorTeamsForEvent(registrations, targetNorm, displayLabel) {
  const teams = [];
  registrations.forEach((raw) => {
    if (!registrationMatchesEventNorm(raw, targetNorm)) return;
    const clean = transformRegistration(raw);
    const tk = registrationTechKey(raw);
    const nk = registrationNtKey(raw);
    const rid = String(raw.id || '').trim() || 'unknown';

    if (tk === targetNorm && clean.events?.technical?.name) {
      const b = clean.events.technical;
      const leaderName = b.team?.leader;
      const members = Array.isArray(b.team?.members) ? b.team.members : [];
      const leaderContact = resolveLeaderContact(clean, leaderName);
      const memberRows = buildMemberTableRows(clean, leaderName, members);
      teams.push({
        teamId: `${rid.slice(0, 12)}-T`,
        teamName: teamDisplayNameFromRaw(raw, true),
        leaderName: String(leaderContact.name || '\u2014').trim() || '\u2014',
        leaderYear: String(clean.primaryRegistrant?.year || '').trim(),
        eventDisplay: displayLabel,
        track: 'Technical',
        collegeName: String(clean.primaryRegistrant?.collegeName || '').trim(),
        departmentName: String(clean.primaryRegistrant?.departmentName || '').trim(),
        venue: getEventVenueLabel(b.name),
        memberRows
      });
    }

    if (nk === targetNorm && clean.events?.nonTechnical?.name) {
      const b = clean.events.nonTechnical;
      const leaderName = b.team?.leader;
      const members = Array.isArray(b.team?.members) ? b.team.members : [];
      const leaderContact = resolveLeaderContact(clean, leaderName);
      const memberRows = buildMemberTableRows(clean, leaderName, members);
      teams.push({
        teamId: `${rid.slice(0, 12)}-NT`,
        teamName: teamDisplayNameFromRaw(raw, false),
        leaderName: String(leaderContact.name || '\u2014').trim() || '\u2014',
        leaderYear: String(clean.primaryRegistrant?.year || '').trim(),
        eventDisplay: displayLabel,
        track: 'Non-technical',
        collegeName: String(clean.primaryRegistrant?.collegeName || '').trim(),
        departmentName: String(clean.primaryRegistrant?.departmentName || '').trim(),
        venue: getEventVenueLabel(b.name),
        memberRows
      });
    }
  });
  return teams;
}

function flattenCoordinatorExportRows(teams) {
  const out = [];
  teams.forEach((t) => {
    t.memberRows.forEach((r) => {
      out.push({
        'Team ID': t.teamId,
        Event: t.eventDisplay,
        Leader: t.leaderName,
        'College Name': t.collegeName || '',
        'Department Name': t.departmentName || '',
        Venue: t.venue || '',
        'Member Name': r.memberName,
        'Member College': r.collegeName || '',
        'Member Department': r.departmentName || '',
        Meal: formatFoodPreference(r.food),
        'As recorded': String(r.food || '').trim() || '—',
        Role: r.role,
        Phone: r.phone || '',
        Email: r.email || ''
      });
    });
  });
  return out;
}

/** Columns aligned with the college attendance sheet template (no extra columns). */
const ATTENDANCE_SHEET_COLUMNS = ['S.NO', 'NAME', 'YEAR AND DEPT', 'COLLEGE', 'MOBILE NO', 'SIGNATURE'];

function yearAndDeptForAttendance(leaderYear, memberDept, teamDept) {
  const y = String(leaderYear || '').trim();
  const md = String(memberDept || '').trim();
  const td = String(teamDept || '').trim();
  const dept = md || td;
  if (y && dept) return `${y} · ${dept}`;
  return y || dept || '';
}

/** One row per participant; SIGNATURE left blank for in-person signing. */
function flattenAttendanceSheetRows(teams) {
  let serial = 0;
  const out = [];
  teams.forEach((t) => {
    const leaderYear = String(t.leaderYear || '').trim();
    const teamCollege = String(t.collegeName || '').trim();
    const teamDept = String(t.departmentName || '').trim();
    t.memberRows.forEach((r) => {
      serial += 1;
      const rawName = String(r.memberName || '').trim();
      const name = rawName === '\u2014' ? '' : rawName;
      out.push({
        'S.NO': serial,
        NAME: name,
        'YEAR AND DEPT': yearAndDeptForAttendance(leaderYear, r.departmentName, teamDept),
        COLLEGE: String(r.collegeName || '').trim() || teamCollege,
        'MOBILE NO': String(r.phone || '').trim(),
        SIGNATURE: ''
      });
    });
  });
  return out;
}

function normalizeMealInput(foodRaw) {
  return String(foodRaw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ');
}

function classifyMealPreference(foodRaw) {
  const t = normalizeMealInput(foodRaw);
  if (!t) return 'empty';
  const compact = t.replace(/[\s_-]/g, '');
  if (compact === 'nv' || compact === 'nonveg') return 'nonveg';
  if (
    /\bnon[\s_-]*veg\b/.test(t) ||
    /\bnon[\s_-]*vegetarian\b/.test(t) ||
    /\bnonvegetarian\b/.test(t)
  ) {
    return 'nonveg';
  }
  if (/\bmeat\b|\bchicken\b|\bmutton\b|\bbeef\b|\bpork\b|\bfish\b|seafood|\begg(s)?\b|omnivore|halal/i.test(t)) {
    return 'nonveg';
  }
  if (/\bvegetarian\b|\bvegan\b|\bsattvik\b|pure[\s_-]*veg|plant[\s_-]*based/.test(t) || /^veg$|^v$/.test(t)) {
    return 'veg';
  }
  if (/\bveg\b/.test(t) && !t.includes('non')) return 'veg';
  if (t.includes('veg') && !/non/.test(t)) return 'veg';
  return 'unknown';
}

/** Human-readable meal line for UI, CSV, PDF (never shows the word "Unknown"). */
function formatFoodPreference(foodRaw) {
  const raw = String(foodRaw ?? '').trim();
  if (!raw) return '\u2014';
  const c = classifyMealPreference(raw);
  if (c === 'veg') return 'Veg';
  if (c === 'nonveg') return 'Non-Veg';
  return raw;
}

  global.PixeloraSharedReg = {
    transformRegistration,
    resolveLeaderContact,
    formatAffiliatedName,
    formatFoodPreference,
    classifyMealPreference,
    personDedupeKey,
    normalizeEventCatalogKey,
    getEventVenueLabel,
    extractEventCatalog,
    registrationTechKey,
    registrationNtKey,
    registrationMatchesEventNorm,
    teamDisplayNameFromRaw,
    buildMemberTableRows,
    buildCoordinatorTeamsForEvent,
    flattenCoordinatorExportRows,
    ATTENDANCE_SHEET_COLUMNS,
    flattenAttendanceSheetRows
  };
})(window);
