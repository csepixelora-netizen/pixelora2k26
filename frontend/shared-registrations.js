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
    const session = raw.sessionData && typeof raw.sessionData === 'object' ? raw.sessionData : {};
    return {
      id: raw.id || '',
      createdAt: raw.createdAt || '',
      primaryRegistrant: { ...EMPTY_PRIMARY, ...pr },
      events: {
        technical: ev.technical || null,
        nonTechnical: ev.nonTechnical || null
      },
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

function mergedMemberPool(raw) {
  const combined = [];
  parseJsonArray(raw.teamMembers).forEach((m) => {
    if (m && typeof m === 'object') combined.push(m);
  });
  const session = raw.sessionData && typeof raw.sessionData === 'object' ? raw.sessionData : {};
  parseJsonArray(session.teamMembers).forEach((m) => {
    if (m && typeof m === 'object') combined.push(m);
  });
  const out = [];
  const seen = new Set();
  combined.forEach((m) => {
    const key =
      String(m.memberId || '')
        .trim()
        .toLowerCase() ||
      `${String(m.email || '')
        .trim()
        .toLowerCase()}|${String(m.name || '')
        .trim()
        .toLowerCase()}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(m);
  });
  return out;
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

function resolveContact(name, pool, primary) {
  const label = String(name || '').trim();
  if (!label) return { name: '', email: '', phone: '', food: '' };
  const lowered = label.toLowerCase();
  const hit = pool.find((m) => String(m.name || '').trim().toLowerCase() === lowered);
  if (hit) {
    return {
      name: label,
      email: String(hit.email || '').trim(),
      phone: String(hit.phone || '').trim(),
      food: String(hit.food || '').trim()
    };
  }
  if (String(primary.name || '').trim().toLowerCase() === lowered) {
    return {
      name: label,
      email: String(primary.email || '').trim(),
      phone: String(primary.phone || '').trim(),
      food: String(primary.food || '').trim()
    };
  }
  return { name: label, email: '', phone: '', food: '' };
}

function dedupeContacts(list) {
  const out = [];
  const seen = new Set();
  list.forEach((c) => {
    const key =
      String(c.email || '')
        .trim()
        .toLowerCase() || String(c.name || '')
        .trim()
        .toLowerCase();
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

  team.members.forEach((teammate) => {
    const n = String(teammate || '').trim();
    if (!n) return;
    const nl = n.toLowerCase();
    if (seenLower.has(nl)) return;
    if (leader && nl === leader.toLowerCase()) return;
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
    const nl = n.toLowerCase();
    if (leader && nl === leader.toLowerCase()) return;
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
  const primary = parsePrimaryFromLegacy(raw);
  const pool = mergedMemberPool(raw);
  const events = buildEventsStructureJs(primary, raw, pool);
  const session = raw.sessionData && typeof raw.sessionData === 'object' ? raw.sessionData : {};
  return {
    id: raw.id || '',
    createdAt: raw.createdAt || '',
    primaryRegistrant: primary,
    events,
    _meta: {
      paymentScreenshot: raw.paymentScreenshot || '',
      wizardStep: session.step
    }
  };
}

function resolveLeaderContact(clean, leaderName) {
  const name = String(leaderName || '').trim();
  const pr = clean.primaryRegistrant;
  if (name && name.toLowerCase() === String(pr.name || '').trim().toLowerCase()) {
    return { name: pr.name, email: pr.email, phone: pr.phone, food: pr.food };
  }
  const pool = [
    ...(clean.events.technical?.team?.members || []),
    ...(clean.events.nonTechnical?.team?.members || [])
  ];
  const found = pool.find((m) => String(m.name || '').trim().toLowerCase() === name.toLowerCase());
  if (found) {
    return { name: found.name, email: found.email, phone: found.phone, food: found.food };
  }
  return { name: name || '\u2014', email: '\u2014', phone: '\u2014', food: '\u2014' };
}

function personDedupeKey(name, phone, teamId) {
  const p = String(phone || '')
    .replace(/\D/g, '')
    .trim();
  const n = String(name || '')
    .trim()
    .toLowerCase();
  return `${teamId}|${p}|${n}`;
}

function normalizeEventCatalogKey(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
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
      email: String(contact.email || '').trim()
    });
  };
  add(leader, 'Leader');
  (rosterMembers || []).forEach((m, i) => {
    const nl = String(m.name || '').trim().toLowerCase();
    if (nl && nl === String(leader.name || '').trim().toLowerCase()) return;
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
        eventDisplay: displayLabel,
        track: 'Technical',
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
        eventDisplay: displayLabel,
        track: 'Non-technical',
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
        'Member Name': r.memberName,
        Role: r.role,
        Phone: r.phone || '',
        Email: r.email || ''
      });
    });
  });
  return out;
}

  global.PixeloraSharedReg = {
    transformRegistration,
    resolveLeaderContact,
    personDedupeKey,
    normalizeEventCatalogKey,
    extractEventCatalog,
    registrationTechKey,
    registrationNtKey,
    registrationMatchesEventNorm,
    teamDisplayNameFromRaw,
    buildMemberTableRows,
    buildCoordinatorTeamsForEvent,
    flattenCoordinatorExportRows
  };
})(window);
