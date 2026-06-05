require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { assertSupabaseEnv } = require('./src/supabaseClient');
const authRoutes = require('./src/routes/auth');
const apiRoutes = require('./src/routes/api');

assertSupabaseEnv();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-before-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/kiosk', (req, res) => res.sendFile(path.join(__dirname, 'public', 'kiosk.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.use((req, res) => {
  res.status(404).json({ ok: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ ok: false, message: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Kannai Fitness Studio running at http://localhost:${PORT}`);
  console.log(`Kiosk page: http://localhost:${PORT}/kiosk`);
  console.log('Demo manager: manager@gym.com / 123456');
  console.log('Demo trainee: trainee@gym.com / 123456');
});
