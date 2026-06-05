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
      .eq('is_active', true)
      .maybeSingle();
    throwIfError(error);
    if (data) req.user = userFromRow(data);
    next();
  } catch (err) {
    next(err);
  }
}

// For JSON API routes — returns 401 JSON
function requireLoggedIn(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, message: 'Login required' });
  next();
}

// For JSON API routes — returns 403 JSON
function requireManager(req, res, next) {
  if (!req.user || req.user.role !== 'manager') {
    return res.status(403).json({ ok: false, message: 'Manager only' });
  }
  next();
}

// For EJS routes — redirects to login page
function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/');
  next();
}

// For EJS routes — redirects to members list or renders 403
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/');
    if (req.user.role !== role) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.',
        user: req.user
      });
    }
    next();
  };
}

// For EJS routes — allows any of the listed roles
function requireAnyRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/');
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.',
        user: req.user
      });
    }
    next();
  };
}

module.exports = { attachUser, requireLoggedIn, requireManager, requireAuth, requireRole, requireAnyRole };
