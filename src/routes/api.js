const express = require('express');
const dayjs = require('dayjs');
const { getSupabase, throwIfError } = require('../supabaseClient');
const { attachUser, requireLoggedIn, requireManager } = require('../middleware');
const { hashPassword } = require('../passwords');
const {
  userFromRow,
  sanitizeUser,
  memberFromRow,
  attendanceFromRow,
  sessionFromRow,
  memberInsertRow,
  memberUpdateRow,
  nullIfEmpty
} = require('../mappers');

const router = express.Router();
router.use(attachUser);

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function today() {
  return dayjs().format('YYYY-MM-DD');
}

function isSameDate(iso, dateStr = today()) {
  return iso && dayjs(iso).format('YYYY-MM-DD') === dateStr;
}

function dayRangeFilter(records, dateStr) {
  if (!dateStr) return records;
  return records.filter(r => isSameDate(r.inAt, dateStr));
}

function dateTimeFromInput(value) {
  if (!value) return dayjs().toISOString();
  return dayjs(value).isValid() ? dayjs(value).toISOString() : dayjs().toISOString();
}

function computePlanStatus(planEndDate) {
  if (!planEndDate) return 'no-plan';
  const now    = dayjs().startOf('day');
  const expiry = dayjs(planEndDate).startOf('day');
  const days   = expiry.diff(now, 'day');
  if (days < 0)  return 'expired';
  if (days === 0) return 'expires-today';
  if (days <= 7)  return 'expiring-soon';
  return 'active';
}

function normalizeMember(member, users) {
  const now    = dayjs().startOf('day');
  const expiry = member.planEndDate ? dayjs(member.planEndDate).startOf('day') : null;
  const daysLeft = expiry && expiry.isValid() ? expiry.diff(now, 'day') : null;
  const trainer  = users.find(u => u.id === member.assignedTrainerId);
  const planStatus = computePlanStatus(member.planEndDate);
  return {
    ...member,
    daysLeft,
    planStatus,
    assignedTrainerName: trainer ? trainer.name : '',
    // backward compat alias for existing SPA code
    assignedTraineeName: trainer ? trainer.name : ''
  };
}

function enrichAttendanceRecord(members, users, record) {
  let person = null;
  if (record.personType === 'member')  person = members.find(m => m.id === record.personId);
  if (record.personType === 'trainer') person = users.find(u => u.id === record.personId);
  return {
    ...record,
    personName: person ? (person.fullName || person.name || 'Unknown') : 'Unknown',
    code:  person ? (person.memberCode || person.memberNo || person.email || person.phone || '') : '',
    phone: person ? (person.phone || '') : '',
    outAt: record.outAt || null,
    inside: !record.outAt
  };
}

async function getAllUsers() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('app_users').select('*').order('created_at', { ascending: false });
  throwIfError(error);
  return (data || []).map(userFromRow);
}

async function getActiveUsers() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('app_users').select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  throwIfError(error);
  return (data || []).map(userFromRow);
}

async function getMembers() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('members').select('*').order('created_at', { ascending: false });
  throwIfError(error);
  return (data || []).map(memberFromRow);
}

async function getAttendance() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('attendance').select('*').order('in_at', { ascending: false });
  throwIfError(error);
  return (data || []).map(attendanceFromRow);
}

async function getSessions() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pt_sessions').select('*')
    .order('session_date', { ascending: false })
    .order('start_time', { ascending: true });
  throwIfError(error);
  return (data || []).map(sessionFromRow);
}

async function getSettings() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('settings').select('*').eq('id', 1).maybeSingle();
  throwIfError(error);
  return data || { gym_name: 'Kannai Fitness Studio', notifications_enabled: true };
}

async function findMemberByCode(code) {
  const clean = String(code || '').trim();
  const supabase = getSupabase();

  let result = await supabase
    .from('members').select('*')
    .eq('member_no', clean)
    .eq('is_active', true)
    .maybeSingle();
  throwIfError(result.error);

  if (!result.data && clean) {
    result = await supabase
      .from('members').select('*')
      .eq('phone', clean)
      .eq('is_active', true)
      .maybeSingle();
    throwIfError(result.error);
  }
  return memberFromRow(result.data);
}

// ─── Kiosk punch (public — no auth required) ──────────────────
router.post('/kiosk/punch', asyncRoute(async (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!code) return res.status(400).json({ ok: false, message: 'Enter member number' });

  const supabase = getSupabase();
  const member = await findMemberByCode(code);
  if (!member) return res.status(404).json({ ok: false, message: 'Member not found or inactive' });

  const openResult = await supabase
    .from('attendance').select('*')
    .eq('person_type', 'member')
    .eq('person_id', member.id)
    .is('out_at', null)
    .order('in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(openResult.error);

  const now   = dayjs().toISOString();
  const users = await getActiveUsers();

  if (openResult.data) {
    const { data, error } = await supabase
      .from('attendance')
      .update({ out_at: now, updated_at: now })
      .eq('id', openResult.data.id)
      .select('*').single();
    throwIfError(error);
    const attendance = attendanceFromRow(data);
    return res.json({
      ok: true,
      action: 'checkout',
      message: `Goodbye ${member.fullName}. Out time saved.`,
      member: normalizeMember(member, users),
      attendance: enrichAttendanceRecord([member], users, attendance)
    });
  }

  const { data, error } = await supabase
    .from('attendance')
    .insert({
      person_type: 'member',
      person_id: member.id,
      role: 'public',
      in_at: now,
      source: 'kiosk'
    })
    .select('*').single();
  throwIfError(error);
  const attendance = attendanceFromRow(data);
  res.json({
    ok: true,
    action: 'checkin',
    message: `Welcome ${member.fullName}. In time saved.`,
    member: normalizeMember(member, users),
    attendance: enrichAttendanceRecord([member], users, attendance)
  });
}));

router.use(requireLoggedIn);

// ─── Dashboard ────────────────────────────────────────────────
router.get('/dashboard', asyncRoute(async (req, res) => {
  const [settings, users, rawMembers, attendance, sessions] = await Promise.all([
    getSettings(), getActiveUsers(), getMembers(), getAttendance(), getSessions()
  ]);

  const members          = rawMembers.map(m => normalizeMember(m, users));
  const activeMembers    = members.filter(m => m.isActive);
  const attendanceToday  = attendance.filter(a => isSameDate(a.inAt));
  const publicToday      = attendanceToday.filter(a => a.personType === 'member').map(a => enrichAttendanceRecord(members, users, a));
  const trainerToday     = attendanceToday.filter(a => a.personType === 'trainer').map(a => enrichAttendanceRecord(members, users, a));
  const insideNow        = attendance.filter(a => !a.outAt && a.personType === 'member').map(a => enrichAttendanceRecord(members, users, a));
  const planAlerts       = members.filter(m => m.notificationEnabled && ['expires-today', 'expired', 'expiring-soon'].includes(m.planStatus));
  const sessionsToday    = sessions.filter(s => s.sessionDate === today());
  const visibleSessions  = req.user.role === 'manager' ? sessions : sessions.filter(s => s.trainerId === req.user.id);

  res.json({
    ok: true,
    gymName: settings.gym_name || 'Kannai Fitness Studio',
    user: sanitizeUser(req.user),
    stats: {
      activeMembers: activeMembers.length,
      publicCheckinsToday: publicToday.length,
      insideNow: insideNow.length,
      trainerAttendanceToday: trainerToday.length,
      planAlerts: planAlerts.length,
      sessionsToday: sessionsToday.length
    },
    publicToday,
    trainerToday,
    insideNow,
    planAlerts,
    sessions: visibleSessions
  });
}));

// ─── Members (JSON API for SPA) ───────────────────────────────
router.get('/members', asyncRoute(async (req, res) => {
  const [users, rawMembers] = await Promise.all([getActiveUsers(), getMembers()]);
  let members = rawMembers.map(m => normalizeMember(m, users));
  if (req.user.role === 'trainer') {
    members = members.filter(m => m.assignedTrainerId === req.user.id);
  }
  res.json({ ok: true, members });
}));

router.post('/members', requireManager, asyncRoute(async (req, res) => {
  const memberNo = String(req.body.memberCode || req.body.memberNo || '').trim();
  const fullName = String(req.body.name || req.body.fullName || '').trim();
  if (!memberNo || !fullName) {
    return res.status(400).json({ ok: false, message: 'Member number and name are required' });
  }

  const supabase = getSupabase();
  const existingCode = await supabase.from('members').select('id').eq('member_no', memberNo).maybeSingle();
  throwIfError(existingCode.error);
  if (existingCode.data) return res.status(409).json({ ok: false, message: 'Member number already exists' });

  const phone = String(req.body.phone || '').trim();
  if (phone) {
    const existingPhone = await supabase.from('members').select('id').eq('phone', phone).maybeSingle();
    throwIfError(existingPhone.error);
    if (existingPhone.data) return res.status(409).json({ ok: false, message: 'Phone number already exists' });
  }

  const row = memberInsertRow(req.body);
  if (!row.plan_start_date) row.plan_start_date = today();
  if (!row.plan_end_date)   row.plan_end_date   = today();
  row.plan_status = computePlanStatus(row.plan_end_date);

  const { data, error } = await supabase.from('members').insert(row).select('*').single();
  throwIfError(error);
  const users = await getActiveUsers();
  res.json({ ok: true, member: normalizeMember(memberFromRow(data), users) });
}));

router.get('/members/:id', asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('members').select('*').eq('id', req.params.id).maybeSingle();
  if (!data && !error) return res.status(404).json({ ok: false, message: 'Member not found' });
  throwIfError(error);
  const users = await getActiveUsers();
  res.json({ ok: true, member: normalizeMember(memberFromRow(data), users) });
}));

router.put('/members/:id', requireManager, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const updateRow = memberUpdateRow(req.body);
  if (updateRow.plan_end_date !== undefined) {
    updateRow.plan_status = computePlanStatus(updateRow.plan_end_date);
  }
  const { data, error } = await supabase
    .from('members').update(updateRow).eq('id', req.params.id).select('*').single();
  if (error && error.code === 'PGRST116') return res.status(404).json({ ok: false, message: 'Member not found' });
  throwIfError(error);
  const users = await getActiveUsers();
  res.json({ ok: true, member: normalizeMember(memberFromRow(data), users) });
}));

// ─── Trainers (JSON API for SPA) ─────────────────────────────
router.get('/trainers', asyncRoute(async (req, res) => {
  const users    = await getActiveUsers();
  const trainers = users.filter(u => u.role === 'trainer').map(sanitizeUser);
  res.json({ ok: true, trainers });
}));

router.post('/trainers', requireManager, asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email || !req.body.name) {
    return res.status(400).json({ ok: false, message: 'Name and email are required' });
  }

  const supabase  = getSupabase();
  const existing  = await supabase.from('app_users').select('id').eq('email', email).maybeSingle();
  throwIfError(existing.error);
  if (existing.data) return res.status(409).json({ ok: false, message: 'Email already exists' });

  const passwordHash = await hashPassword(String(req.body.password || '123456'));
  const { data, error } = await supabase
    .from('app_users')
    .insert({
      name: String(req.body.name || '').trim(),
      email,
      phone: nullIfEmpty(req.body.phone),
      role: 'trainer',
      password_hash: passwordHash,
      is_active: true
    })
    .select('*').single();
  throwIfError(error);
  res.json({ ok: true, trainer: sanitizeUser(userFromRow(data)) });
}));

// ─── Attendance ───────────────────────────────────────────────
router.get('/attendance', asyncRoute(async (req, res) => {
  const q          = req.query;
  const supabase   = getSupabase();
  const isTrainer  = req.user.role === 'trainer';

  // Build date range — supports legacy ?date= and new ?quick=, ?from=, ?to=, ?calendar_date=
  let fromISO = null;
  let toISO   = null;

  if (q.calendar_date && dayjs(q.calendar_date).isValid()) {
    fromISO = dayjs(q.calendar_date).startOf('day').toISOString();
    toISO   = dayjs(q.calendar_date).endOf('day').toISOString();
  } else if (q.quick === 'today') {
    fromISO = dayjs().startOf('day').toISOString();
    toISO   = dayjs().endOf('day').toISOString();
  } else if (q.quick === 'week') {
    const dow    = dayjs().day();
    const monday = dayjs().subtract(dow === 0 ? 6 : dow - 1, 'day').startOf('day');
    fromISO = monday.toISOString();
    toISO   = monday.add(6, 'day').endOf('day').toISOString();
  } else if (q.quick === 'month') {
    fromISO = dayjs().startOf('month').toISOString();
    toISO   = dayjs().endOf('month').toISOString();
  } else if (q.from || q.to) {
    if (q.from && dayjs(q.from).isValid()) fromISO = dayjs(q.from).startOf('day').toISOString();
    if (q.to   && dayjs(q.to).isValid())   toISO   = dayjs(q.to).endOf('day').toISOString();
  } else if (q.date) {
    fromISO = dayjs(q.date).startOf('day').toISOString();
    toISO   = dayjs(q.date).endOf('day').toISOString();
  }

  let attQuery = supabase.from('attendance').select('*').order('in_at', { ascending: false });
  if (fromISO) attQuery = attQuery.gte('in_at', fromISO);
  if (toISO)   attQuery = attQuery.lte('in_at', toISO);

  // person_type filter: supports both ?type= (legacy) and ?person_type= (new)
  const personType = q.person_type || q.type;
  if (personType === 'public'  || personType === 'member')  attQuery = attQuery.eq('person_type', 'member');
  if (personType === 'trainer')                             attQuery = attQuery.eq('person_type', 'trainer');
  if (q.person_id)                                          attQuery = attQuery.eq('person_id', q.person_id);

  // Trainer role: never return trainer attendance records
  if (isTrainer) attQuery = attQuery.eq('person_type', 'member');

  const attRes = await attQuery;
  throwIfError(attRes.error);

  const [users, members] = await Promise.all([getActiveUsers(), getMembers()]);
  let records = (attRes.data || []).map(attendanceFromRow).map(a => enrichAttendanceRecord(members, users, a));

  // Trainer role: restrict to assigned members when assignments exist
  if (isTrainer && !q.person_id) {
    const assignedIds = new Set(members.filter(m => m.assignedTrainerId === req.user.id).map(m => m.id));
    if (assignedIds.size > 0) {
      records = records.filter(r => assignedIds.has(r.personId));
    }
  }

  res.json({ ok: true, records });
}));

router.post('/attendance/manual', requireManager, asyncRoute(async (req, res) => {
  const supabase   = getSupabase();
  const personType = req.body.personType === 'trainer' ? 'trainer' : 'member';
  const personId   = String(req.body.personId || '');
  const table      = personType === 'member' ? 'members' : 'app_users';

  let query = supabase.from(table).select('*').eq('id', personId);
  if (personType === 'trainer') query = query.eq('role', 'trainer');
  const { data: person, error: personError } = await query.maybeSingle();
  throwIfError(personError);
  if (!person) return res.status(404).json({ ok: false, message: 'Person not found' });

  const inAt  = dateTimeFromInput(req.body.inAt);
  const outAt = req.body.outAt ? dateTimeFromInput(req.body.outAt) : null;
  const { data, error } = await supabase.from('attendance').insert({
    person_type: personType,
    person_id:   personId,
    role:        personType === 'member' ? 'public' : 'trainer',
    in_at:       inAt,
    out_at:      outAt,
    source:      'manual',
    created_by:  req.user.id
  }).select('*').single();
  throwIfError(error);
  const [users, members] = await Promise.all([getActiveUsers(), getMembers()]);
  res.json({ ok: true, attendance: enrichAttendanceRecord(members, users, attendanceFromRow(data)) });
}));

router.post('/attendance/trainer-punch', asyncRoute(async (req, res) => {
  const supabase  = getSupabase();
  const trainerId = req.user.role === 'manager' && req.body.trainerId ? String(req.body.trainerId) : req.user.id;
  const trainerResult = await supabase
    .from('app_users').select('*')
    .eq('id', trainerId).eq('role', 'trainer').eq('is_active', true).maybeSingle();
  throwIfError(trainerResult.error);
  if (!trainerResult.data) return res.status(404).json({ ok: false, message: 'Trainer not found' });

  const openResult = await supabase
    .from('attendance').select('*')
    .eq('person_type', 'trainer')
    .eq('person_id', trainerId)
    .is('out_at', null)
    .order('in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(openResult.error);

  const now = dayjs().toISOString();
  if (openResult.data) {
    const { data, error } = await supabase
      .from('attendance')
      .update({ out_at: now, updated_at: now })
      .eq('id', openResult.data.id)
      .select('*').single();
    throwIfError(error);
    const [users, members] = await Promise.all([getActiveUsers(), getMembers()]);
    return res.json({ ok: true, action: 'checkout', attendance: enrichAttendanceRecord(members, users, attendanceFromRow(data)) });
  }

  const { data, error } = await supabase.from('attendance').insert({
    person_type: 'trainer',
    person_id:   trainerId,
    role:        'trainer',
    in_at:       now,
    source:      req.user.role === 'manager' ? 'manager' : 'self',
    created_by:  req.user.id
  }).select('*').single();
  throwIfError(error);
  const [users, members] = await Promise.all([getActiveUsers(), getMembers()]);
  res.json({ ok: true, action: 'checkin', attendance: enrichAttendanceRecord(members, users, attendanceFromRow(data)) });
}));

// ─── PT Sessions ──────────────────────────────────────────────
router.get('/sessions', asyncRoute(async (req, res) => {
  const [users, members, allSessions] = await Promise.all([getActiveUsers(), getMembers(), getSessions()]);
  let sessions = allSessions;
  if (req.user.role === 'trainer') sessions = sessions.filter(s => s.trainerId === req.user.id);
  const enriched = sessions.map(s => ({
    ...s,
    memberName:  (members.find(m => m.id === s.memberId) || {}).fullName || (members.find(m => m.id === s.memberId) || {}).name || 'Unknown',
    trainerName: (users.find(u => u.id === s.trainerId)  || {}).name    || 'Unknown',
    // backward compat alias
    traineeName: (users.find(u => u.id === s.trainerId)  || {}).name    || 'Unknown'
  }));
  res.json({ ok: true, sessions: enriched });
}));

router.post('/sessions', requireManager, asyncRoute(async (req, res) => {
  const trainerId = req.body.trainerId || req.body.traineeId;
  if (!req.body.memberId || !trainerId || !req.body.sessionDate) {
    return res.status(400).json({ ok: false, message: 'Member, trainer, and date are required' });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.from('pt_sessions').insert({
    member_id:    String(req.body.memberId),
    trainer_id:   String(trainerId),
    session_date: String(req.body.sessionDate),
    start_time:   nullIfEmpty(req.body.startTime),
    status:       String(req.body.status || 'scheduled'),
    notes:        nullIfEmpty(req.body.notes)
  }).select('*').single();
  throwIfError(error);
  res.json({ ok: true, session: sessionFromRow(data) });
}));

router.patch('/sessions/:id', asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const current  = await supabase.from('pt_sessions').select('*').eq('id', req.params.id).maybeSingle();
  throwIfError(current.error);
  if (!current.data) return res.status(404).json({ ok: false, message: 'Session not found' });
  const session = sessionFromRow(current.data);
  if (req.user.role !== 'manager' && session.trainerId !== req.user.id) {
    return res.status(403).json({ ok: false, message: 'Not allowed' });
  }
  const allowed = ['sessionDate', 'startTime', 'status', 'notes'];
  const update  = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
    if (key === 'sessionDate') update.session_date = req.body[key];
    if (key === 'startTime')   update.start_time   = nullIfEmpty(req.body[key]);
    if (key === 'status')      update.status       = req.body[key];
    if (key === 'notes')       update.notes        = nullIfEmpty(req.body[key]);
  }
  const { data, error } = await supabase
    .from('pt_sessions').update(update).eq('id', req.params.id).select('*').single();
  throwIfError(error);
  res.json({ ok: true, session: sessionFromRow(data) });
}));

module.exports = router;
