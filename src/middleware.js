const { getSupabase, throwIfError } = require('./supabaseClient');
const { userFromRow } = require('./mappers');

async function attachUser(req, res, next) {
  try {
    if (!req.session.userId) return next();
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', req.session.userId)
      .eq('active', true)
      .maybeSingle();
    throwIfError(error);
    if (data) req.user = userFromRow(data);
    next();
  } catch (err) {
    next(err);
  }
}

function requireLoggedIn(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, message: 'Login required' });
  next();
}

function requireManager(req, res, next) {
  if (!req.user || req.user.role !== 'manager') return res.status(403).json({ ok: false, message: 'Manager only' });
  next();
}

module.exports = { attachUser, requireLoggedIn, requireManager };
