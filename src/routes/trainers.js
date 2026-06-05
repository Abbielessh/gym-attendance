const express = require('express');
const { getSupabase, throwIfError } = require('../supabaseClient');
const { attachUser, requireAuth, requireRole } = require('../middleware');
const { hashPassword } = require('../passwords');
const { userFromRow, sanitizeUser, nullIfEmpty } = require('../mappers');

const router = express.Router();
router.use(attachUser);
router.use(requireAuth);
router.use(requireRole('manager'));

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

// ─── GET /trainers ────────────────────────────────────────────
router.get('/', asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const { q } = req.query;

  const { data, error } = await supabase
    .from('app_users').select('*').eq('role', 'trainer').order('name');
  throwIfError(error);

  let trainers = (data || []).map(userFromRow).map(sanitizeUser);

  if (q && q.trim()) {
    const s = q.trim().toLowerCase();
    trainers = trainers.filter(t =>
      t.name.toLowerCase().includes(s) ||
      t.email.toLowerCase().includes(s) ||
      (t.phone && t.phone.includes(s))
    );
  }

  res.render('trainers/index', {
    title:    'Trainers',
    trainers,
    q:        q || '',
    flash:    popFlash(req),
    user:     req.user
  });
}));

// ─── GET /trainers/new ────────────────────────────────────────
router.get('/new', asyncRoute(async (req, res) => {
  res.render('trainers/new', {
    title:  'Add Trainer',
    flash:  popFlash(req),
    errors: [],
    values: {},
    user:   req.user
  });
}));

// ─── POST /trainers ───────────────────────────────────────────
router.post('/', asyncRoute(async (req, res) => {
  const errors   = [];
  const body     = req.body;
  const name     = String(body.name     || '').trim();
  const email    = String(body.email    || '').trim().toLowerCase();
  const password = String(body.password || '').trim();

  if (!name)     errors.push('Full name is required');
  if (!email)    errors.push('Email is required');
  if (!password) errors.push('Password is required');
  if (password && password.length < 6) errors.push('Password must be at least 6 characters');

  if (!errors.length) {
    const supabase = getSupabase();
    const dup = await supabase.from('app_users').select('id').eq('email', email).maybeSingle();
    throwIfError(dup.error);
    if (dup.data) errors.push(`Email "${email}" is already in use`);
  }

  if (errors.length) {
    return res.status(422).render('trainers/new', {
      title: 'Add Trainer', flash: null, errors, values: body, user: req.user
    });
  }

  const supabase      = getSupabase();
  const passwordHash  = await hashPassword(password);
  const { error } = await supabase.from('app_users').insert({
    name,
    email,
    phone:         nullIfEmpty(body.phone),
    role:          'trainer',
    password_hash: passwordHash,
    is_active:     true
  });
  throwIfError(error);

  setFlash(req, 'success', `Trainer "${name}" added successfully.`);
  res.redirect('/trainers');
}));

// ─── GET /trainers/:id/edit ───────────────────────────────────
router.get('/:id/edit', asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('app_users').select('*').eq('id', req.params.id).eq('role', 'trainer').maybeSingle();
  throwIfError(error);
  if (!data) {
    setFlash(req, 'error', 'Trainer not found.');
    return res.redirect('/trainers');
  }
  res.render('trainers/edit', {
    title:   `Edit: ${data.name}`,
    trainer: sanitizeUser(userFromRow(data)),
    flash:   popFlash(req),
    errors:  [],
    user:    req.user
  });
}));

// ─── POST /trainers/:id (update) ─────────────────────────────
router.post('/:id', asyncRoute(async (req, res) => {
  const errors = [];
  const body   = req.body;
  const name   = String(body.name  || '').trim();
  const email  = String(body.email || '').trim().toLowerCase();

  if (!name)  errors.push('Full name is required');
  if (!email) errors.push('Email is required');

  if (!errors.length) {
    const supabase = getSupabase();
    const dup = await supabase.from('app_users').select('id')
      .eq('email', email).neq('id', req.params.id).maybeSingle();
    throwIfError(dup.error);
    if (dup.data) errors.push(`Email "${email}" is already in use by another user`);
  }

  if (body.password && body.password.trim() && body.password.trim().length < 6) {
    errors.push('Password must be at least 6 characters');
  }

  if (errors.length) {
    const supabase = getSupabase();
    const { data } = await supabase.from('app_users').select('*').eq('id', req.params.id).maybeSingle();
    return res.status(422).render('trainers/edit', {
      title:   'Edit Trainer',
      trainer: data ? sanitizeUser(userFromRow(data)) : { id: req.params.id },
      flash: null, errors, user: req.user
    });
  }

  const updateData = {
    name,
    email,
    phone:      nullIfEmpty(body.phone),
    updated_at: new Date().toISOString()
  };

  if (body.isActive !== undefined) {
    updateData.is_active = body.isActive !== 'false' && body.isActive !== false;
  }

  if (body.password && body.password.trim()) {
    updateData.password_hash = await hashPassword(body.password.trim());
  }

  const supabase = getSupabase();
  const { error } = await supabase.from('app_users').update(updateData).eq('id', req.params.id);
  throwIfError(error);

  setFlash(req, 'success', 'Trainer updated successfully.');
  res.redirect('/trainers');
}));

// ─── POST /trainers/:id/deactivate ───────────────────────────
router.post('/:id/deactivate', asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const { error } = await supabase.from('app_users')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('role', 'trainer');
  throwIfError(error);
  setFlash(req, 'success', 'Trainer deactivated.');
  res.redirect('/trainers');
}));

module.exports = router;
