const express = require('express');
const dayjs   = require('dayjs');
const { getSupabase, throwIfError } = require('../supabaseClient');
const { attachUser, requireAuth, requireAnyRole } = require('../middleware');
const { memberFromRow, attendanceFromRow } = require('../mappers');

const router = express.Router();
router.use(attachUser);
router.use(requireAuth);
router.use(requireAnyRole(['manager', 'trainer']));

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ── Shared helpers ─────────────────────────────────────────────

const SRC_LABELS = {
  kiosk:   'Attendance Desk',
  manual:  'Manual',
  self:    'Self',
  manager: 'Manager'
};

function formatMins(m) {
  if (!m || m <= 0) return '0m';
  if (m < 60) return m + 'm';
  const h   = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? h + 'h ' + rem + 'm' : h + 'h';
}

function calcDuration(inAt, outAt) {
  if (!inAt || !outAt) return null;
  const mins = dayjs(outAt).diff(dayjs(inAt), 'minute');
  if (mins < 0) return null;
  if (mins < 60) return mins + 'm';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return dayjs(iso).format('D MMM YYYY, h:mm A');
}

function fmtTime(iso) {
  if (!iso) return null;
  return dayjs(iso).format('h:mm A');
}

function attendanceStatus(inAt, outAt, source, todayStr) {
  if (outAt) return 'checked-out';
  const inDay = dayjs(inAt).format('YYYY-MM-DD');
  if (source === 'manual') return 'manual';
  return inDay === todayStr ? 'inside' : 'missing-out';
}

function computePlanStatus(planEndDate) {
  if (!planEndDate) return 'no-plan';
  const now  = dayjs().startOf('day');
  const exp  = dayjs(planEndDate).startOf('day');
  const days = exp.diff(now, 'day');
  if (days < 0)   return 'expired';
  if (days === 0) return 'expires-today';
  if (days <= 7)  return 'expiring-soon';
  return 'active';
}

function getDateRange(q) {
  const now = dayjs();

  if (q.calendar_date && dayjs(q.calendar_date).isValid()) {
    const d = dayjs(q.calendar_date);
    return {
      from:  d.startOf('day').toISOString(),
      to:    d.endOf('day').toISOString(),
      mode:  'calendar',
      label: d.format('D MMM YYYY')
    };
  }

  if (q.quick === 'week') {
    const dow    = now.day();
    const monday = now.subtract(dow === 0 ? 6 : dow - 1, 'day').startOf('day');
    const sunday = monday.add(6, 'day').endOf('day');
    return {
      from:  monday.toISOString(),
      to:    sunday.toISOString(),
      mode:  'week',
      label: monday.format('D MMM') + ' – ' + sunday.format('D MMM YYYY')
    };
  }

  if (q.quick === 'month') {
    return {
      from:  now.startOf('month').toISOString(),
      to:    now.endOf('month').toISOString(),
      mode:  'month',
      label: now.format('MMMM YYYY')
    };
  }

  if (q.from || q.to) {
    const f = q.from && dayjs(q.from).isValid() ? dayjs(q.from).startOf('day') : dayjs('2000-01-01');
    const t = q.to   && dayjs(q.to).isValid()   ? dayjs(q.to).endOf('day')     : now.endOf('day');
    return {
      from:  f.toISOString(),
      to:    t.toISOString(),
      mode:  'range',
      label: (q.from || 'All') + ' to ' + (q.to || 'Today')
    };
  }

  return {
    from:  now.startOf('day').toISOString(),
    to:    now.endOf('day').toISOString(),
    mode:  'today',
    label: 'Today (' + now.format('D MMM YYYY') + ')'
  };
}

// ── GET /attendance — simple attendance dashboard ─────────────
router.get('/', asyncRoute(async (req, res) => {
  const supabase   = getSupabase();
  const now        = dayjs();
  const todayStr   = now.format('YYYY-MM-DD');
  const todayStart = now.startOf('day').toISOString();
  const todayEnd   = now.endOf('day').toISOString();
  const isManager  = req.user.role === 'manager';

  // Two parallel queries — today's records + stale currently-inside from previous days
  const [todayRes, staleInsideRes] = await Promise.all([
    supabase
      .from('attendance')
      .select('id, person_type, person_id, in_at, out_at, source')
      .eq('person_type', 'member')
      .gte('in_at', todayStart)
      .lte('in_at', todayEnd)
      .order('in_at', { ascending: false })
      .limit(300),
    supabase
      .from('attendance')
      .select('id, person_type, person_id, in_at, out_at, source')
      .eq('person_type', 'member')
      .is('out_at', null)
      .lt('in_at', todayStart)
      .order('in_at', { ascending: false })
      .limit(50)
  ]);
  throwIfError(todayRes.error);
  throwIfError(staleInsideRes.error);

  // Collect member IDs from both result sets
  const memberIdSet = new Set();
  (todayRes.data     || []).forEach(r => memberIdSet.add(r.person_id));
  (staleInsideRes.data || []).forEach(r => memberIdSet.add(r.person_id));
  const memberIds = Array.from(memberIdSet);

  let memberMap = {};
  if (memberIds.length > 0) {
    const membersRes = await supabase
      .from('members')
      .select('id, member_no, full_name, phone')
      .in('id', memberIds);
    throwIfError(membersRes.error);
    (membersRes.data || []).forEach(m => { memberMap[m.id] = m; });
  }

  function enrichRow(raw) {
    const m      = memberMap[raw.person_id] || {};
    const status = attendanceStatus(raw.in_at, raw.out_at, raw.source, todayStr);
    const dur    = calcDuration(raw.in_at, raw.out_at);
    const liveMins = now.diff(dayjs(raw.in_at), 'minute');
    return {
      id:          raw.id,
      personId:    raw.person_id,
      personName:  m.full_name || 'Unknown',
      memberNo:    m.member_no || '',
      phone:       m.phone     || '',
      inAt:        raw.in_at,
      outAt:       raw.out_at  || null,
      source:      raw.source  || '',
      sourceLabel: SRC_LABELS[raw.source] || raw.source,
      inDisplay:   fmtTime(raw.in_at),
      outDisplay:  fmtTime(raw.out_at),
      duration:    dur || (status === 'inside' ? formatMins(liveMins > 0 ? liveMins : 0) : '—'),
      status
    };
  }

  const todayRecords = (todayRes.data       || []).map(enrichRow);
  const staleInside  = (staleInsideRes.data || []).map(enrichRow);

  const currentlyInsideToday = todayRecords.filter(r => r.status === 'inside');
  const allCurrentlyInside   = [...currentlyInsideToday, ...staleInside];

  const pubStats = {
    insideNow:       allCurrentlyInside.length,
    checkinsToday:   todayRecords.length,
    checkedOutToday: todayRecords.filter(r => r.outAt).length,
    missingOut:      staleInside.length + todayRecords.filter(r => r.status === 'missing-out').length
  };

  const flash = req.session.flash || null;
  delete req.session.flash;

  res.render('attendance/index', {
    title:      'Attendance',
    activePage: 'attendance',
    user:       req.user,
    flash,
    isManager,
    todayRecords,
    currentlyInside: allCurrentlyInside,
    pubStats,
    todayLabel: now.format('dddd, D MMMM YYYY')
  });
}));


// ── GET /attendance/report — full filter report ────────────────
router.get('/report', asyncRoute(async (req, res) => {
  const supabase   = getSupabase();
  const q          = req.query;
  const range      = getDateRange(q);
  const isManager  = req.user.role === 'manager';
  const personType = q.person_type || '';
  const personId   = q.person_id   || '';

  // Fetch members for person search and enrichment; fetch users only for manager
  const [membersRes, usersRes] = await Promise.all([
    supabase
      .from('members')
      .select('id, member_no, full_name, phone, assigned_trainer_id')
      .eq('is_active', true)
      .order('full_name'),
    isManager
      ? supabase.from('app_users').select('id, name, role').eq('is_active', true).order('name')
      : Promise.resolve({ data: [], error: null })
  ]);
  throwIfError(membersRes.error);
  throwIfError(usersRes.error);

  const members  = (membersRes.data || []).map(memberFromRow);
  const users    = (usersRes.data   || []).map(r => ({ id: r.id, name: r.name, role: r.role }));
  const trainers = users.filter(u => u.role === 'trainer');

  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u; });

  // Build attendance query with filters applied server-side
  let attQuery = supabase
    .from('attendance')
    .select('id, person_type, person_id, in_at, out_at, source')
    .gte('in_at', range.from)
    .lte('in_at', range.to)
    .order('in_at', { ascending: false })
    .limit(500);

  if (personType === 'public')  attQuery = attQuery.eq('person_type', 'member');
  if (personType === 'trainer') attQuery = attQuery.eq('person_type', 'trainer');
  if (personId)                 attQuery = attQuery.eq('person_id', personId);
  if (!isManager)               attQuery = attQuery.eq('person_type', 'member');

  const attRes = await attQuery;
  throwIfError(attRes.error);

  const todayStr = dayjs().format('YYYY-MM-DD');

  const enriched = (attRes.data || []).map(rec => {
    const m      = rec.person_type === 'member'  ? memberMap[rec.person_id] : null;
    const u      = rec.person_type === 'trainer' ? userMap[rec.person_id]   : null;
    const name   = m ? (m.fullName || 'Unknown') : (u ? u.name : 'Unknown');
    const status = attendanceStatus(rec.in_at, rec.out_at, rec.source, todayStr);
    const dur    = calcDuration(rec.in_at, rec.out_at);
    return {
      id:          rec.id,
      personType:  rec.person_type,
      personId:    rec.person_id,
      personName:  name,
      memberNo:    m ? (m.memberNo || '') : '',
      phone:       m ? (m.phone    || '') : '',
      inAt:        rec.in_at,
      outAt:       rec.out_at || null,
      source:      rec.source || '',
      sourceLabel: SRC_LABELS[rec.source] || rec.source,
      inDisplay:   fmtDateTime(rec.in_at),
      outDisplay:  rec.out_at ? fmtDateTime(rec.out_at) : '—',
      duration:    dur || (status === 'inside' ? 'Still inside' : '—'),
      status,
      date:        dayjs(rec.in_at).format('D MMM YYYY')
    };
  });

  let publicRecords  = enriched.filter(r => r.personType === 'member');
  let trainerRecords = isManager ? enriched.filter(r => r.personType === 'trainer') : [];

  // Trainer: filter to assigned members only when assignments exist
  if (!isManager && !personId) {
    const assignedIds = new Set(
      members.filter(m => m.assignedTrainerId === req.user.id).map(m => m.id)
    );
    if (assignedIds.size > 0) {
      publicRecords = publicRecords.filter(r => assignedIds.has(r.personId));
    }
  }

  const uniqueMembersSet = new Set(publicRecords.map(r => r.personId));
  const checkedOutRecs   = publicRecords.filter(r => r.status === 'checked-out');
  const totalGymMins     = checkedOutRecs.reduce((acc, r) => {
    if (!r.inAt || !r.outAt) return acc;
    const m = dayjs(r.outAt).diff(dayjs(r.inAt), 'minute');
    return acc + (m > 0 ? m : 0);
  }, 0);
  const avgSessionMins = checkedOutRecs.length > 0
    ? Math.round(totalGymMins / checkedOutRecs.length)
    : 0;

  const pubStats = {
    total:         publicRecords.length,
    uniqueMembers: uniqueMembersSet.size,
    insideNow:     publicRecords.filter(r => r.status === 'inside').length,
    checkedOut:    checkedOutRecs.length,
    missingOut:    publicRecords.filter(r => r.status === 'missing-out' || r.status === 'manual').length,
    totalGymTime:  totalGymMins > 0 ? formatMins(totalGymMins) : '—',
    avgSession:    avgSessionMins > 0 ? formatMins(avgSessionMins) : '—'
  };

  const trainerStats = isManager ? {
    total:      trainerRecords.length,
    insideNow:  trainerRecords.filter(r => r.status === 'inside').length,
    checkedOut: trainerRecords.filter(r => r.status === 'checked-out').length
  } : null;

  let personSummary = null;
  if (personId && enriched.length > 0) {
    const pRecs    = enriched.filter(r => r.personId === personId);
    const totalMin = pRecs.reduce((acc, r) => {
      if (!r.inAt || !r.outAt) return acc;
      const m = dayjs(r.outAt).diff(dayjs(r.inAt), 'minute');
      return acc + (m > 0 ? m : 0);
    }, 0);
    const withDur = pRecs.filter(r => r.inAt && r.outAt).length;
    const avgMin  = withDur > 0 ? Math.round(totalMin / withDur) : 0;
    personSummary = {
      name:          pRecs.length > 0 ? pRecs[0].personName : 'Unknown',
      totalVisits:   pRecs.length,
      totalDuration: formatMins(totalMin),
      avgDuration:   formatMins(avgMin),
      missingOut:    pRecs.filter(r => !r.outAt).length
    };
  }

  let weekSummary = null;
  if (range.mode === 'week') {
    const uniq = new Set(publicRecords.map(r => r.personId));
    weekSummary = {
      totalCheckins: publicRecords.length,
      uniqueMembers: uniq.size,
      avgDaily:      Math.round(publicRecords.length / 7),
      missingOut:    publicRecords.filter(r => r.status === 'missing-out').length
    };
  }

  let selectedFilterLabel = 'Showing public attendance for: ' + range.label;
  if (personId) {
    const pm = members.find(m => m.id === personId);
    const pt = trainers.find(t => t.id === personId);
    const pn = pm ? (pm.fullName || 'Unknown') : (pt ? pt.name : 'Unknown');
    selectedFilterLabel = 'Showing attendance for ' + pn + ' — ' + range.label;
  }

  let rangeMode;
  if (q.calendar_date)     rangeMode = 'calendar';
  else if (q.from || q.to) rangeMode = 'range';
  else if (q.quick)        rangeMode = q.quick;
  else                     rangeMode = 'today';

  const flash = req.session.flash || null;
  delete req.session.flash;

  res.render('attendance/report', {
    title:      'Full Attendance Report',
    activePage: 'attendance',
    user:       req.user,
    flash,
    filters: {
      quick:         q.quick         || '',
      from:          q.from          || '',
      to:            q.to            || '',
      person_type:   personType,
      person_id:     personId,
      calendar_date: q.calendar_date || ''
    },
    rangeMode,
    range,
    publicRecords,
    trainerRecords,
    members,
    trainers,
    pubStats,
    trainerStats,
    personSummary,
    weekSummary,
    selectedFilterLabel,
    isManager
  });
}));


// ── GET /attendance/person/:memberId — per-person history ──────
router.get('/person/:memberId', asyncRoute(async (req, res) => {
  const supabase  = getSupabase();
  const { memberId } = req.params;
  const q         = req.query;
  const now       = dayjs();
  const todayStr  = now.format('YYYY-MM-DD');
  const isManager = req.user.role === 'manager';

  // Fetch member details
  const memberRes = await supabase
    .from('members')
    .select('id, member_no, full_name, phone, email, gender, plan_name, plan_start_date, plan_end_date, plan_status, plan_duration_months, assigned_trainer_id, is_active, notes')
    .eq('id', memberId)
    .maybeSingle();
  throwIfError(memberRes.error);

  if (!memberRes.data) {
    req.session.flash = { type: 'error', message: 'Member not found.' };
    return res.redirect('/attendance');
  }

  const member = memberFromRow(memberRes.data);

  // Trainer access check — block if trainer has assigned members and this isn't one of them
  if (!isManager) {
    if (member.assignedTrainerId && member.assignedTrainerId !== req.user.id) {
      const { count } = await supabase
        .from('members')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_trainer_id', req.user.id)
        .eq('is_active', true);
      if ((count || 0) > 0) {
        req.session.flash = { type: 'error', message: 'Access denied.' };
        return res.redirect('/attendance');
      }
    }
  }

  // Default to this month when no filter is set
  const effectiveQ = Object.keys(q).length === 0 ? { quick: 'month' } : q;
  const range      = getDateRange(effectiveQ);

  // Fetch attendance for this member only
  const attRes = await supabase
    .from('attendance')
    .select('id, in_at, out_at, source, created_at')
    .eq('person_type', 'member')
    .eq('person_id', memberId)
    .gte('in_at', range.from)
    .lte('in_at', range.to)
    .order('in_at', { ascending: false })
    .limit(500);
  throwIfError(attRes.error);

  const records = (attRes.data || []).map(raw => {
    const inAtDJ = dayjs(raw.in_at);
    const status = attendanceStatus(raw.in_at, raw.out_at, raw.source, todayStr);
    const dur    = calcDuration(raw.in_at, raw.out_at);
    return {
      id:          raw.id,
      inAt:        raw.in_at,
      outAt:       raw.out_at  || null,
      source:      raw.source  || '',
      sourceLabel: SRC_LABELS[raw.source] || raw.source,
      inDisplay:   fmtDateTime(raw.in_at),
      outDisplay:  raw.out_at ? fmtDateTime(raw.out_at) : null,
      duration:    dur,
      status,
      date:        inAtDJ.format('D MMM YYYY'),
      month:       inAtDJ.format('MMMM YYYY')
    };
  });

  // Overall stats
  const checkedOut = records.filter(r => r.outAt);
  const totalMins  = checkedOut.reduce((acc, r) => {
    const m = dayjs(r.outAt).diff(dayjs(r.inAt), 'minute');
    return acc + (m > 0 ? m : 0);
  }, 0);
  const avgMins = checkedOut.length > 0 ? Math.round(totalMins / checkedOut.length) : 0;

  const stats = {
    totalVisits:     records.length,
    totalTime:       formatMins(totalMins),
    avgSession:      avgMins > 0 ? formatMins(avgMins) : '—',
    missingOut:      records.filter(r => r.status === 'missing-out').length,
    currentlyInside: records.some(r => r.status === 'inside')
  };

  // Month-wise summary
  const monthMap = {};
  records.forEach(r => {
    if (!monthMap[r.month]) {
      monthMap[r.month] = { month: r.month, total: 0, checkedOut: 0, totalMins: 0, missingOut: 0 };
    }
    monthMap[r.month].total++;
    if (r.outAt) {
      monthMap[r.month].checkedOut++;
      const m = dayjs(r.outAt).diff(dayjs(r.inAt), 'minute');
      if (m > 0) monthMap[r.month].totalMins += m;
    }
    if (r.status === 'missing-out') monthMap[r.month].missingOut++;
  });
  const monthSummary = Object.values(monthMap).map(ms => ({
    ...ms,
    totalTimeStr: formatMins(ms.totalMins)
  }));

  const planStatus   = computePlanStatus(member.planEndDate);
  const planDaysLeft = member.planEndDate
    ? dayjs(member.planEndDate).startOf('day').diff(now.startOf('day'), 'day')
    : null;

  let rangeMode;
  if (effectiveQ.calendar_date)             rangeMode = 'calendar';
  else if (effectiveQ.from || effectiveQ.to) rangeMode = 'range';
  else if (effectiveQ.quick)                rangeMode = effectiveQ.quick;
  else                                       rangeMode = 'month';

  res.render('attendance/person', {
    title:      member.fullName + ' — Attendance',
    activePage: 'attendance',
    user:       req.user,
    isManager,
    member:     { ...member, planStatus, daysLeft: planDaysLeft },
    records,
    stats,
    monthSummary,
    range,
    rangeMode,
    filters: {
      quick:         q.quick         || '',
      from:          q.from          || '',
      to:            q.to            || '',
      calendar_date: q.calendar_date || ''
    }
  });
}));

module.exports = router;
