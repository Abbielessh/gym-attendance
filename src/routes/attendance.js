const express = require('express');
const dayjs   = require('dayjs');
const { getSupabase, throwIfError } = require('../supabaseClient');
const { attachUser, requireAuth, requireAnyRole } = require('../middleware');
const { memberFromRow, userFromRow, attendanceFromRow } = require('../mappers');

const router = express.Router();
router.use(attachUser);
router.use(requireAuth);
router.use(requireAnyRole(['manager', 'trainer']));

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function getDateRange(q) {
  const now = dayjs();

  if (q.calendar_date && dayjs(q.calendar_date).isValid()) {
    const d = dayjs(q.calendar_date);
    return {
      from: d.startOf('day').toISOString(),
      to:   d.endOf('day').toISOString(),
      mode: 'calendar',
      label: d.format('D MMM YYYY')
    };
  }

  if (q.quick === 'week') {
    const dow    = now.day(); // 0=Sun, 1=Mon
    const monday = now.subtract(dow === 0 ? 6 : dow - 1, 'day').startOf('day');
    const sunday = monday.add(6, 'day').endOf('day');
    return {
      from: monday.toISOString(),
      to:   sunday.toISOString(),
      mode: 'week',
      label: monday.format('D MMM') + ' – ' + sunday.format('D MMM YYYY')
    };
  }

  if (q.quick === 'month') {
    return {
      from: now.startOf('month').toISOString(),
      to:   now.endOf('month').toISOString(),
      mode: 'month',
      label: now.format('MMMM YYYY')
    };
  }

  if (q.from || q.to) {
    const f = q.from && dayjs(q.from).isValid() ? dayjs(q.from).startOf('day') : dayjs('2000-01-01');
    const t = q.to   && dayjs(q.to).isValid()   ? dayjs(q.to).endOf('day')     : now.endOf('day');
    return {
      from: f.toISOString(),
      to:   t.toISOString(),
      mode: 'range',
      label: (q.from || 'All') + ' to ' + (q.to || 'Today')
    };
  }

  // Default: today
  return {
    from: now.startOf('day').toISOString(),
    to:   now.endOf('day').toISOString(),
    mode: 'today',
    label: 'Today (' + now.format('D MMM YYYY') + ')'
  };
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

function attendanceStatus(rec) {
  if (rec.outAt) return 'checked-out';
  const inDay    = dayjs(rec.inAt).format('YYYY-MM-DD');
  const todayStr = dayjs().format('YYYY-MM-DD');
  if (rec.source === 'manual') return 'manual';
  return inDay === todayStr ? 'inside' : 'missing-out';
}

function formatMins(m) {
  if (m <= 0) return '0m';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? h + 'h ' + rem + 'm' : h + 'h';
}

router.get('/', asyncRoute(async (req, res) => {
  const supabase  = getSupabase();
  const q         = req.query;
  const range     = getDateRange(q);
  const isManager = req.user.role === 'manager';
  const personType = q.person_type || '';
  const personId   = q.person_id   || '';

  // Load members and users for enrichment
  const [membersRes, usersRes] = await Promise.all([
    supabase.from('members').select('*').order('full_name'),
    supabase.from('app_users').select('*').eq('is_active', true).order('name')
  ]);
  throwIfError(membersRes.error);
  throwIfError(usersRes.error);

  const members  = (membersRes.data || []).map(memberFromRow);
  const users    = (usersRes.data  || []).map(userFromRow);
  const trainers = users.filter(u => u.role === 'trainer');

  // Query attendance with server-side date filter
  let attQuery = supabase
    .from('attendance')
    .select('*')
    .gte('in_at', range.from)
    .lte('in_at', range.to)
    .order('in_at', { ascending: false });

  if (personType === 'public')  attQuery = attQuery.eq('person_type', 'member');
  if (personType === 'trainer') attQuery = attQuery.eq('person_type', 'trainer');
  if (personId)                 attQuery = attQuery.eq('person_id', personId);
  // Trainer role: never show trainer attendance records
  if (!isManager)               attQuery = attQuery.eq('person_type', 'member');

  const attRes = await attQuery;
  throwIfError(attRes.error);

  const rawRecords = (attRes.data || []).map(attendanceFromRow);

  // Enrich records with person details
  const enriched = rawRecords.map(rec => {
    let person   = null;
    let memberNo = '';
    let phone    = '';
    if (rec.personType === 'member') {
      person = members.find(m => m.id === rec.personId);
      if (person) { memberNo = person.memberNo || ''; phone = person.phone || ''; }
    } else {
      person = users.find(u => u.id === rec.personId);
    }
    const duration = calcDuration(rec.inAt, rec.outAt);
    const status   = attendanceStatus(rec);
    return {
      ...rec,
      personName: person ? (person.fullName || person.name || 'Unknown') : 'Unknown',
      memberNo,
      phone,
      inDisplay:  fmtDateTime(rec.inAt),
      outDisplay: rec.outAt ? fmtDateTime(rec.outAt) : '—',
      duration:   duration || (status === 'inside' ? 'Still inside' : '—'),
      status,
      date: rec.inAt ? dayjs(rec.inAt).format('D MMM YYYY') : '—'
    };
  });

  let publicRecords  = enriched.filter(r => r.personType === 'member');
  let trainerRecords = isManager ? enriched.filter(r => r.personType === 'trainer') : [];

  // Trainer role: restrict to assigned members when assignments exist
  if (!isManager && !personId) {
    const assignedIds = new Set(members.filter(m => m.assignedTrainerId === req.user.id).map(m => m.id));
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

  // Person summary when a specific person is filtered
  let personSummary = null;
  if (personId && enriched.length > 0) {
    const personRecs   = enriched.filter(r => r.personId === personId);
    const totalMins    = personRecs.reduce((acc, r) => {
      if (!r.inAt || !r.outAt) return acc;
      const m = dayjs(r.outAt).diff(dayjs(r.inAt), 'minute');
      return acc + (m > 0 ? m : 0);
    }, 0);
    const withDuration = personRecs.filter(r => r.inAt && r.outAt).length;
    const avgMins      = withDuration > 0 ? Math.round(totalMins / withDuration) : 0;
    personSummary = {
      name:          personRecs.length > 0 ? personRecs[0].personName : 'Unknown',
      totalVisits:   personRecs.length,
      totalDuration: formatMins(totalMins),
      avgDuration:   formatMins(avgMins),
      missingOut:    personRecs.filter(r => !r.outAt).length
    };
  }

  // Week summary
  let weekSummary = null;
  if (range.mode === 'week') {
    const uniqueMembers = new Set(publicRecords.map(r => r.personId));
    weekSummary = {
      totalCheckins: publicRecords.length,
      uniqueMembers: uniqueMembers.size,
      avgDaily:      Math.round(publicRecords.length / 7),
      missingOut:    publicRecords.filter(r => r.status === 'missing-out').length
    };
  }

  // Selected filter label shown above the table
  let selectedFilterLabel = 'Showing public attendance for: ' + range.label;
  if (personId) {
    const personMatch = members.find(m => m.id === personId) || trainers.find(t => t.id === personId);
    const personName  = personMatch ? (personMatch.fullName || personMatch.name || 'Unknown') : 'Unknown';
    selectedFilterLabel = 'Showing attendance for ' + personName + ' — ' + range.label;
  }

  // Determine which option should be pre-selected in the Range dropdown
  let rangeMode;
  if (q.calendar_date)     rangeMode = 'calendar';
  else if (q.from || q.to) rangeMode = 'range';
  else if (q.quick)        rangeMode = q.quick;
  else                     rangeMode = 'today';

  const flash = req.session.flash || null;
  delete req.session.flash;

  res.render('attendance', {
    title:      'Attendance',
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

module.exports = router;
