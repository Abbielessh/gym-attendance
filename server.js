require('dotenv').config();

const express       = require('express');
const cookieSession = require('cookie-session');
const path          = require('path');
const { assertSupabaseEnv } = require('./src/supabaseClient');
const authRoutes          = require('./src/routes/auth');
const apiRoutes           = require('./src/routes/api');
const membersRoutes       = require('./src/routes/members');
const membersImportRoutes = require('./src/routes/membersImport');
const trainersRoutes      = require('./src/routes/trainers');
const attendanceRoutes    = require('./src/routes/attendance');

assertSupabaseEnv();

const app  = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

// Body parsers
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Session — cookie-based so it survives serverless cold starts
app.use(cookieSession({
  name:     'session',
  secret:   process.env.SESSION_SECRET || 'change-this-secret-before-production',
  maxAge:   1000 * 60 * 60 * 8,
  httpOnly: true,
  sameSite: 'lax',
  secure:   process.env.NODE_ENV === 'production'
}));

// Static assets
app.use('/assets', express.static(path.join(process.cwd(), 'public', 'assets')));

// API routes (JSON)
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// EJS server-rendered pages
// Import router is mounted first at /members/import so it doesn't conflict with /:id
app.use('/members/import', membersImportRoutes);
app.use('/members', membersRoutes);
app.use('/trainers', trainersRoutes);
app.use('/attendance', attendanceRoutes);

// Redirect old deep-link to standalone attendance page
app.get('/dashboard/attendance', (req, res) => res.redirect('/attendance'));

// Static HTML pages (existing SPA)
app.get('/',          (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'index.html')));
app.get('/login',     (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'index.html')));
app.get('/kiosk',     (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'kiosk.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html')));

// 404
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).render('error', {
      title:   'Page Not Found',
      message: 'The page you are looking for does not exist.',
      user:    req.user || null
    });
  }
  res.status(404).json({ ok: false, message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (req.accepts('html')) {
    return res.status(err.status || 500).render('error', {
      title:   'Server Error',
      message: err.message || 'An unexpected error occurred.',
      user:    req.user || null
    });
  }
  res.status(err.status || 500).json({ ok: false, message: err.message || 'Server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Kannai Fitness Studio running at http://localhost:${PORT}`);
    console.log(`Kiosk page:     http://localhost:${PORT}/kiosk`);
    console.log(`Members (EJS):  http://localhost:${PORT}/members`);
    console.log('Demo manager:   manager@gym.com / 123456');
    console.log('Demo trainer:   trainer@gym.com / 123456');
  });
}

module.exports = app;
