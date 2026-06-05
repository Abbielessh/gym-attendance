const express = require('express');
const { getSupabase, throwIfError } = require('../supabaseClient');
const { userFromRow, sanitizeUser } = require('../mappers');
const { verifyPassword } = require('../passwords');

const router = express.Router();

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.post('/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', email)
    .eq('active', true)
    .maybeSingle();
  throwIfError(error);
  const user = userFromRow(data);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ ok: false, message: 'Invalid email or password' });
  }
  req.session.userId = user.id;
  res.json({ ok: true, user: sanitizeUser(user) });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', asyncRoute(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, message: 'Not logged in' });
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', req.session.userId)
    .eq('active', true)
    .maybeSingle();
  throwIfError(error);
  const user = userFromRow(data);
  if (!user) return res.status(401).json({ ok: false, message: 'Session expired' });
  res.json({ ok: true, user: sanitizeUser(user) });
}));

module.exports = router;
