const express = require('express');
const dayjs   = require('dayjs');
const { getSupabase, throwIfError } = require('../supabaseClient');
const { attachUser, requireAuth, requireRole, requireAnyRole } = require('../middleware');
const { memberFromRow, memberInsertRow, memberUpdateRow, nullIfEmpty } = require('../mappers');

const router = express.Router();
router.use(attachUser);
router.use(requireAuth);

const requireManager      = requireRole('manager');
const requireManagerOrTrainer = requireAnyRole(['manager', 'trainer']);

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function popFlash(req) {
  const f = req.session.flash || null;
  delete req.session.flash;
  return f;
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

function enrichMember(member, trainers) {
  const now    = dayjs().startOf('day');
  const expiry = member.planEndDate ? dayjs(member.planEndDate).startOf('day') : null;
  const daysLeft   = expiry && expiry.isValid() ? expiry.diff(now, 'day') : null;
  const planStatus = computePlanStatus(member.planEndDate);
  const trainer    = trainers.find(t => t.id === member.assignedTrainerId);
  return { ...member, daysLeft, planStatus, assignedTrainerName: trainer ? trainer.name : null };
}

async function getTrainers() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('app_users')
    .select('id, name, email')
    .eq('role', 'trainer')
    .eq('is_active', true)
    .order('name');
  throwIfError(error);
  return data || [];
}

// ─── GET /members ─────────────────────────────────────────────
router.get('/', asyncRoute(async (req, res) => {
  const supabase  = getSupabase();
  const { q, filter } = req.query;
  const showInactive  = filter === 'inactive';

  let query = supabase.from('members').select('*').eq('is_active', !showInactive);
  query = query.order('full_name', { ascending: true });

  const { data, error } = await query;
  throwIfError(error);

  const trainers = await getTrainers();
  let members    = (data || []).map(row => enrichMember(memberFromRow(row), trainers));

  if (q && q.trim()) {
    const s = q.trim().toLowerCase();
    members = members.filter(m =>
      m.fullName.toLowerCase().includes(s) ||
      m.memberNo.toLowerCase().includes(s)  ||
      (m.phone && m.phone.includes(s))       ||
      (m.email && m.email.toLowerCase().includes(s))
    );
  }

  // Trainers can only see their assigned members
  if (req.user.role === 'trainer') {
    members = members.filter(m => m.assignedTrainerId === req.user.id);
  }

  res.render('members/index', {
    title:      'Members',
    members,
    q:          q || '',
    filter:     showInactive ? 'inactive' : 'active',
    flash:      popFlash(req),
    user:       req.user,
    activePage: 'members'
  });
}));

// ─── GET /members/new ─────────────────────────────────────────
router.get('/new', requireManagerOrTrainer, asyncRoute(async (req, res) => {
  const trainers = await getTrainers();
  res.render('members/new', {
    title:      'Add Public Member',
    trainers,
    flash:      popFlash(req),
    errors:     [],
    values:     {},
    user:       req.user,
    activePage: 'members'
  });
}));

// ─── POST /members ────────────────────────────────────────────
router.post('/', requireManagerOrTrainer, asyncRoute(async (req, res) => {
  const errors  = [];
  const body    = req.body;
  const memberNo = String(body.memberNo || '').trim();
  const fullName = String(body.fullName || '').trim();

  if (!memberNo) errors.push('Member number is required');
  if (!fullName) errors.push('Full name is required');

  const supabase = getSupabase();

  if (memberNo) {
    const dup = await supabase.from('members').select('id').eq('member_no', memberNo).maybeSingle();
    throwIfError(dup.error);
    if (dup.data) errors.push(`Member number "${memberNo}" is already in use`);
  }

  if (errors.length) {
    const trainers = await getTrainers();
    return res.status(422).render('members/new', {
      title: 'Add Public Member', trainers, flash: null, errors, values: body, user: req.user, activePage: 'members'
    });
  }

  // Auto-calculate plan_end_date if not provided
  if (!body.planEndDate && body.planStartDate && body.planDurationMonths) {
    body.planEndDate = dayjs(body.planStartDate)
      .add(Number(body.planDurationMonths), 'month')
      .format('YYYY-MM-DD');
  }

  const row = memberInsertRow(body);
  row.plan_status = computePlanStatus(row.plan_end_date);

  const { error: insErr } = await supabase.from('members').insert(row);
  throwIfError(insErr);

  setFlash(req, 'success', `Member "${fullName}" added successfully.`);
  res.redirect('/members');
}));

// ─── GET /members/:id ─────────────────────────────────────────
router.get('/:id', asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('members').select('*').eq('id', req.params.id).maybeSingle();
  throwIfError(error);
  if (!data) {
    setFlash(req, 'error', 'Member not found.');
    return res.redirect('/members');
  }

  const trainers = await getTrainers();
  const member   = enrichMember(memberFromRow(data), trainers);

  // Trainers can only see their assigned members
  if (req.user.role === 'trainer' && member.assignedTrainerId !== req.user.id) {
    setFlash(req, 'error', 'Access denied.');
    return res.redirect('/members');
  }

  res.render('members/show', {
    title:      member.fullName,
    member,
    flash:      popFlash(req),
    user:       req.user,
    activePage: 'members'
  });
}));

// ─── GET /members/:id/edit ────────────────────────────────────
router.get('/:id/edit', requireManager, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('members').select('*').eq('id', req.params.id).maybeSingle();
  throwIfError(error);
  if (!data) {
    setFlash(req, 'error', 'Member not found.');
    return res.redirect('/members');
  }
  const trainers = await getTrainers();
  res.render('members/edit', {
    title:      `Edit: ${data.full_name}`,
    member:     memberFromRow(data),
    trainers,
    flash:      popFlash(req),
    errors:     [],
    user:       req.user,
    activePage: 'members'
  });
}));

// ─── POST /members/:id (update) ───────────────────────────────
router.post('/:id', requireManager, asyncRoute(async (req, res) => {
  const errors   = [];
  const body     = req.body;
  const fullName = String(body.fullName || '').trim();

  if (!fullName) errors.push('Full name is required');

  if (errors.length) {
    const supabase  = getSupabase();
    const { data }  = await supabase.from('members').select('*').eq('id', req.params.id).maybeSingle();
    const trainers  = await getTrainers();
    return res.status(422).render('members/edit', {
      title:  'Edit Member',
      member: data ? memberFromRow(data) : { id: req.params.id },
      trainers, flash: null, errors, user: req.user, activePage: 'members'
    });
  }

  // Auto-calculate plan_end_date if not provided
  if (!body.planEndDate && body.planStartDate && body.planDurationMonths) {
    body.planEndDate = dayjs(body.planStartDate)
      .add(Number(body.planDurationMonths), 'month')
      .format('YYYY-MM-DD');
  }

  const row = memberUpdateRow(body);
  if (row.plan_end_date !== undefined) {
    row.plan_status = computePlanStatus(row.plan_end_date);
  }

  const supabase = getSupabase();
  const { error } = await supabase.from('members').update(row).eq('id', req.params.id);
  throwIfError(error);

  setFlash(req, 'success', 'Member updated successfully.');
  res.redirect(`/members/${req.params.id}`);
}));

// ─── POST /members/:id/delete ─────────────────────────────────
router.post('/:id/delete', requireManager, asyncRoute(async (req, res) => {
  const supabase = getSupabase();

  // Hard delete only if explicitly requested; default is soft deactivate
  if (req.body.hardDelete === 'true') {
    const { error } = await supabase.from('members').delete().eq('id', req.params.id);
    throwIfError(error);
    setFlash(req, 'success', 'Member permanently deleted.');
  } else {
    const { error } = await supabase.from('members')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    throwIfError(error);
    setFlash(req, 'success', 'Member deactivated. You can reactivate from the Inactive tab.');
  }
  res.redirect('/members');
}));

module.exports = router;
