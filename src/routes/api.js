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

function normalizeMember(member, users) {
  const now = dayjs().startOf('day');
  const expiry = member.planExpiryDate ? dayjs(member.planExpiryDate).startOf('day') : null;
  const daysLeft = expiry && expiry.isValid() ? expiry.diff(now, 'day') : null;
  const trainee = users.find(u => u.id === member.assignedTraineeId);
  let planStatus = 'no-plan';
  if (expiry && expiry.isValid()) {
    if (daysLeft < 0) planStatus = 'expired';
    else if (daysLeft === 0) planStatus = 'expires-today';
    else if (daysLeft <= 7) planStatus = 'expiring-soon';
    else planStatus = 'active';
  }
  return {
    ...member,
    daysLeft,
    planStatus,
    assignedTraineeName: trainee ? trainee.name : ''
  };
}

function enrichAttendanceRecord(members, users, record) {
  let person = null;
  if (record.personType === 'member') person = members.find(m => m.id === record.personId);
  if (record.personType === 'trainee') person = users.find(u => u.id === record.personId);
  return {
    ...record,
    personName: person ? person.name : 'Unknown',
    code: person ? (person.memberCode || person.email || person.phone || '') : '',
    phone: person ? (person.phone || '') : '',
    outAt: record.outAt || null,
    inside: !record.outAt
  };
}

async function getAllUsers() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('app_users').select('*').order('created_at', { ascending: false });
  throwIfError(error);
  return (data || []).map(userFromRow);
}

async function getActiveUsers() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false });
  throwIfError(error);
  return (data || []).map(userFromRow);
}

async function getMembers() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('members').select('*').order('created_at', { ascending: false });
  throwIfError(error);
  return (data || []).map(memberFromRow);
}

async function getAttendance() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('attendance').select('*').order('in_at', { ascending: false });
  throwIfError(error);
  return (data || []).map(attendanceFromRow);
}

async function getSessions() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('pt_sessions').select('*').order('session_date', { ascending: false }).order('start_time', { ascending: true });
  throwIfError(error);
  return (data || []).map(sessionFromRow);
}

async function getSettings() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  throwIfError(error);
  return data || { gym_name: 'Kannai Fitness Studio', notifications_enabled: true };
}

async function findMemberByCode(code) {
  const clean = String(code || '').trim();
  const supabase = getSupabase();
  let result = await supabase
    .from('members')
    .select('*')
    .eq('member_code', clean)
    .neq('status', 'inactive')
    .maybeSingle();
  throwIfError(result.error);
  if (!result.data && clean) {
    result = await supabase
      .from('members')
      .select('*')
      .eq('phone', clean)
      .neq('status', 'inactive')
      .maybeSingle();
    throwIfError(result.error);
  }
  return memberFromRow(result.data);
}

router.post('/kiosk/punch', asyncRoute(async (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!code) return res.status(400).json({ ok: false, message: 'Enter member number' });

  const supabase = getSupabase();
  const member = await findMemberByCode(code);
  if (!member) return res.status(404).json({ ok: false, message: 'Member not found or inactive' });

  const openResult = await supabase
    .from('attendance')
    .select('*')
    .eq('person_type', 'member')
    .eq('person_id', member.id)
    .is('out_at', null)
    .order('in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(openResult.error);

  const now = dayjs().toISOString();
  const users = await getActiveUsers();

  if (openResult.data) {
    const { data, error } = await supabase
      .from('attendance')
      .update({ out_at: now, updated_at: now })
      .eq('id', openResult.data.id)
      .select('*')
      .single();
    throwIfError(error);
    const attendance = attendanceFromRow(data);
    return res.json({
      ok: true,
      action: 'checkout',
      message: `Goodbye ${member.name}. Out time saved.`,
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
    .select('*')
    .single();
  throwIfError(error);
  const attendance = attendanceFromRow(data);
  res.json({
    ok: true,
    action: 'checkin',
    message: `Welcome ${member.name}. In time saved.`,
    member: normalizeMember(member, users),
    attendance: enrichAttendanceRecord([member], users, attendance)
  });
}));

router.use(requireLoggedIn);

router.get('/dashboard', asyncRoute(async (req, res) => {
  const [settings, users, rawMembers, attendance, sessions] = await Promise.all([
    getSettings(),
    getActiveUsers(),
    getMembers(),
    getAttendance(),
    getSessions()
  ]);

  const members = rawMembers.map(m => normalizeMember(m, users));
  const activeMembers = members.filter(m => m.status !== 'inactive');
  const attendanceToday = attendance.filter(a => isSameDate(a.inAt));
  const publicToday = attendanceToday.filter(a => a.personType === 'member').map(a => enrichAttendanceRecord(members, users, a));
  const traineeToday = attendanceToday.filter(a => a.personType === 'trainee').map(a => enrichAttendanceRecord(members, users, a));
  const insideNow = attendance.filter(a => !a.outAt && a.personType === 'member').map(a => enrichAttendanceRecord(members, users, a));
  const planAlerts = members.filter(m => m.planNotify && ['expires-today', 'expired', 'expiring-soon'].includes(m.planStatus));
  const sessionsToday = sessions.filter(s => s.sessionDate === today());
  const visibleSessions = req.user.role === 'manager' ? sessions : sessions.filter(s => s.traineeId === req.user.id);

  res.json({
    ok: true,
    gymName: settings.gym_name || 'Kannai Fitness Studio',
    user: sanitizeUser(req.user),
    stats: {
      activeMembers: activeMembers.length,
      publicCheckinsToday: publicToday.length,
      insideNow: insideNow.length,
      traineeAttendanceToday: traineeToday.length,
      planAlerts: planAlerts.length,
      sessionsToday: sessionsToday.length
    },
    publicToday,
    traineeToday,
    insideNow,
    planAlerts,
    sessions: visibleSessions
  });
}));

router.get('/members', asyncRoute(async (req, res) => {
  const [users, rawMembers] = await Promise.all([getActiveUsers(), getMembers()]);
  let members = rawMembers.map(m => normalizeMember(m, users));
  if (req.user.role === 'trainee') members = members.filter(m => m.assignedTraineeId === req.user.id);
  res.json({ ok: true, members });
}));

router.post('/members', requireManager, asyncRoute(async (req, res) => {
  const memberCode = String(req.body.memberCode || '').trim();
  if (!memberCode || !req.body.name) return res.status(400).json({ ok: false, message: 'Member number and name are required' });

  const supabase = getSupabase();
  const existingCode = await supabase.from('members').select('id').eq('member_code', memberCode).maybeSingle();
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
  if (!row.plan_expiry_date) row.plan_expiry_date = today();

  const { data, error } = await supabase.from('members').insert(row).select('*').single();
  throwIfError(error);
  const users = await getActiveUsers();
  res.json({ ok: true, member: normalizeMember(memberFromRow(data), users) });
}));

router.put('/members/:id', requireManager, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('members')
    .update(memberUpdateRow(req.body))
    .eq('id', req.params.id)
    .select('*')
    .single();
  if (error && error.code === 'PGRST116') return res.status(404).json({ ok: false, message: 'Member not found' });
  throwIfError(error);
  const users = await getActiveUsers();
  res.json({ ok: true, member: normalizeMember(memberFromRow(data), users) });
}));

router.get('/trainees', asyncRoute(async (req, res) => {
  const users = await getActiveUsers();
  const trainees = users.filter(u => u.role === 'trainee').map(sanitizeUser);
  res.json({ ok: true, trainees });
}));

router.post('/trainees', requireManager, asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email || !req.body.name) return res.status(400).json({ ok: false, message: 'Name and email are required' });

  const supabase = getSupabase();
  const existing = await supabase.from('app_users').select('id').eq('email', email).maybeSingle();
  throwIfError(existing.error);
  if (existing.data) return res.status(409).json({ ok: false, message: 'Email already exists' });

  const { data, error } = await supabase
    .from('app_users')
    .insert({
      name: String(req.body.name || '').trim(),
      email,
      phone: nullIfEmpty(req.body.phone),
      role: 'trainee',
      password_hash: hashPassword(String(req.body.password || '123456')),
      active: true
    })
    .select('*')
    .single();
  throwIfError(error);
  res.json({ ok: true, trainee: sanitizeUser(userFromRow(data)) });
}));

router.get('/attendance', asyncRoute(async (req, res) => {
  const [users, members, attendance] = await Promise.all([getActiveUsers(), getMembers(), getAttendance()]);
  const type = req.query.type;
  const date = req.query.date;
  let records = attendance;
  if (type === 'public') records = records.filter(a => a.personType === 'member');
  if (type === 'trainee') records = records.filter(a => a.personType === 'trainee');
  records = dayRangeFilter(records, date).map(a => enrichAttendanceRecord(members, users, a));
  if (req.user.role === 'trainee' && type !== 'trainee') {
    const assignedIds = new Set(members.filter(m => m.assignedTraineeId === req.user.id).map(m => m.id));
    records = records.filter(r => assignedIds.has(r.personId));
  }
  res.json({ ok: true, records });
}));

router.post('/attendance/manual', requireManager, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const personType = req.body.personType === 'trainee' ? 'trainee' : 'member';
  const personId = String(req.body.personId || '');
  const table = personType === 'member' ? 'members' : 'app_users';
  let query = supabase.from(table).select('*').eq('id', personId);
  if (personType === 'trainee') query = query.eq('role', 'trainee');
  const { data: person, error: personError } = await query.maybeSingle();
  throwIfError(personError);
  if (!person) return res.status(404).json({ ok: false, message: 'Person not found' });

  const inAt = dateTimeFromInput(req.body.inAt);
  const outAt = req.body.outAt ? dateTimeFromInput(req.body.outAt) : null;
  const { data, error } = await supabase
    .from('attendance')
    .insert({
      person_type: personType,
      person_id: personId,
      role: personType === 'member' ? 'public' : 'trainee',
      in_at: inAt,
      out_at: outAt,
      source: 'manual',
      created_by: req.user.id
    })
    .select('*')
    .single();
  throwIfError(error);
  const [users, members] = await Promise.all([getActiveUsers(), getMembers()]);
  res.json({ ok: true, attendance: enrichAttendanceRecord(members, users, attendanceFromRow(data)) });
}));

router.post('/attendance/trainee-punch', asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const traineeId = req.user.role === 'manager' && req.body.traineeId ? String(req.body.traineeId) : req.user.id;
  const traineeResult = await supabase
    .from('app_users')
    .select('*')
    .eq('id', traineeId)
    .eq('role', 'trainee')
    .eq('active', true)
    .maybeSingle();
  throwIfError(traineeResult.error);
  if (!traineeResult.data) return res.status(404).json({ ok: false, message: 'Trainee not found' });

  const openResult = await supabase
    .from('attendance')
    .select('*')
    .eq('person_type', 'trainee')
    .eq('person_id', traineeId)
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
      .select('*')
      .single();
    throwIfError(error);
    const [users, members] = await Promise.all([getActiveUsers(), getMembers()]);
    return res.json({ ok: true, action: 'checkout', attendance: enrichAttendanceRecord(members, users, attendanceFromRow(data)) });
  }

  const { data, error } = await supabase
    .from('attendance')
    .insert({
      person_type: 'trainee',
      person_id: traineeId,
      role: 'trainee',
      in_at: now,
      source: req.user.role === 'manager' ? 'manager' : 'self',
      created_by: req.user.id
    })
    .select('*')
    .single();
  throwIfError(error);
  const [users, members] = await Promise.all([getActiveUsers(), getMembers()]);
  res.json({ ok: true, action: 'checkin', attendance: enrichAttendanceRecord(members, users, attendanceFromRow(data)) });
}));

router.get('/sessions', asyncRoute(async (req, res) => {
  const [users, members, allSessions] = await Promise.all([getActiveUsers(), getMembers(), getSessions()]);
  let sessions = allSessions;
  if (req.user.role === 'trainee') sessions = sessions.filter(s => s.traineeId === req.user.id);
  const enriched = sessions.map(s => ({
    ...s,
    memberName: (members.find(m => m.id === s.memberId) || {}).name || 'Unknown',
    traineeName: (users.find(u => u.id === s.traineeId) || {}).name || 'Unknown'
  }));
  res.json({ ok: true, sessions: enriched });
}));

router.post('/sessions', requireManager, asyncRoute(async (req, res) => {
  if (!req.body.memberId || !req.body.traineeId || !req.body.sessionDate) {
    return res.status(400).json({ ok: false, message: 'Member, trainee, and date are required' });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pt_sessions')
    .insert({
      member_id: String(req.body.memberId),
      trainee_id: String(req.body.traineeId),
      session_date: String(req.body.sessionDate),
      start_time: nullIfEmpty(req.body.startTime),
      status: String(req.body.status || 'scheduled'),
      notes: nullIfEmpty(req.body.notes)
    })
    .select('*')
    .single();
  throwIfError(error);
  res.json({ ok: true, session: sessionFromRow(data) });
}));

router.patch('/sessions/:id', asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const current = await supabase.from('pt_sessions').select('*').eq('id', req.params.id).maybeSingle();
  throwIfError(current.error);
  if (!current.data) return res.status(404).json({ ok: false, message: 'Session not found' });
  const session = sessionFromRow(current.data);
  if (req.user.role !== 'manager' && session.traineeId !== req.user.id) {
    return res.status(403).json({ ok: false, message: 'Not allowed' });
  }
  const allowed = ['sessionDate', 'startTime', 'status', 'notes'];
  const update = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
    if (key === 'sessionDate') update.session_date = req.body[key];
    if (key === 'startTime') update.start_time = nullIfEmpty(req.body[key]);
    if (key === 'status') update.status = req.body[key];
    if (key === 'notes') update.notes = nullIfEmpty(req.body[key]);
  }
  const { data, error } = await supabase.from('pt_sessions').update(update).eq('id', req.params.id).select('*').single();
  throwIfError(error);
  res.json({ ok: true, session: sessionFromRow(data) });
}));

module.exports = router;
