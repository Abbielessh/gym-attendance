const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const dayjs   = require('dayjs');
const { getSupabase, throwIfError } = require('../supabaseClient');
const { attachUser, requireAuth, requireRole } = require('../middleware');
const { nullIfEmpty } = require('../mappers');

const router = express.Router();
router.use(attachUser);
router.use(requireAuth);
router.use(requireRole('manager'));

// Memory storage — file never touches disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },   // 10 MB max
  fileFilter(req, file, cb) {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx, .xls, and .csv files are accepted'), ok);
  }
});

// ─── Column header normalisation map ─────────────────────────
const COL_MAP = {
  'member no':          'member_no',
  'member number':      'member_no',
  'member_no':          'member_no',
  'memberno':           'member_no',
  'id':                 'member_no',
  'no':                 'member_no',

  'name':               'full_name',
  'full name':          'full_name',
  'full_name':          'full_name',
  'fullname':           'full_name',
  'member name':        'full_name',

  'mobile':             'phone',
  'phone':              'phone',
  'contact':            'phone',
  'phone no':           'phone',
  'mobile no':          'phone',
  'contact no':         'phone',

  'email':              'email',
  'email address':      'email',

  'gender':             'gender',
  'sex':                'gender',

  'dob':                'date_of_birth',
  'date of birth':      'date_of_birth',
  'date_of_birth':      'date_of_birth',
  'birth date':         'date_of_birth',
  'birthdate':          'date_of_birth',

  'address':            'address',
  'area':               'address',

  'emergency name':     'emergency_contact_name',
  'emergency contact':  'emergency_contact_name',
  'emergency contact name': 'emergency_contact_name',

  'emergency phone':    'emergency_contact_phone',
  'emergency mobile':   'emergency_contact_phone',
  'emergency contact phone': 'emergency_contact_phone',

  'plan':               'plan_name',
  'plan name':          'plan_name',
  'plan_name':          'plan_name',
  'package':            'plan_name',
  'membership':         'plan_name',

  'duration':           'plan_duration_months',
  'months':             'plan_duration_months',
  'plan duration':      'plan_duration_months',
  'plan duration months': 'plan_duration_months',
  'plan_duration_months': 'plan_duration_months',

  'start date':         'plan_start_date',
  'start_date':         'plan_start_date',
  'plan start date':    'plan_start_date',
  'plan start':         'plan_start_date',
  'joining date':       'plan_start_date',
  'join date':          'plan_start_date',

  'end date':           'plan_end_date',
  'end_date':           'plan_end_date',
  'plan end date':      'plan_end_date',
  'plan end':           'plan_end_date',
  'expiry date':        'plan_end_date',
  'expiry':             'plan_end_date',
  'plan expiry':        'plan_end_date',

  'notification':       'notification_enabled',
  'notify':             'notification_enabled',
  'notification_enabled': 'notification_enabled',
  'sms notify':         'notification_enabled',

  'trainer email':          'assigned_trainer_email',
  'trainee email':          'assigned_trainer_email',   // backward compat
  'pt trainer':             'assigned_trainer_email',
  'assigned trainer':       'assigned_trainer_email',
  'assigned_trainer_email': 'assigned_trainer_email',
  'assigned_trainee_email': 'assigned_trainer_email',   // backward compat

  'notes':              'notes',
  'note':               'notes',
  'remarks':            'notes'
};

function normaliseHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapHeaders(rawRow) {
  const mapped = {};
  for (const [key, val] of Object.entries(rawRow)) {
    const norm   = normaliseHeader(key);
    const target = COL_MAP[norm];
    if (target) mapped[target] = val === null || val === undefined ? '' : String(val).trim();
  }
  return mapped;
}

function parseDate(val) {
  if (!val) return '';
  // XLSX may return a JS Date object when cellDates: true
  if (val instanceof Date) return dayjs(val).format('YYYY-MM-DD');
  const s = String(val).trim();
  if (!s) return '';
  const formats = ['YYYY-MM-DD', 'DD-MM-YYYY', 'MM/DD/YYYY', 'DD/MM/YYYY', 'D/M/YYYY', 'YYYY/MM/DD'];
  for (const f of formats) {
    const d = dayjs(s, f);
    if (d.isValid()) return d.format('YYYY-MM-DD');
  }
  return s;   // return raw if unparseable; will surface as a validation warning
}

function parseBool(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val || '').trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(s)) return true;
  if (['no', 'false', '0', 'n'].includes(s)) return false;
  return true;  // default enabled
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

function validateRow(row, existingNos) {
  const errors = [];
  if (!row.member_no) errors.push('Member number is required');
  if (!row.full_name) errors.push('Full name is required');

  if (row.plan_start_date && row.plan_start_date && !dayjs(row.plan_start_date).isValid()) {
    errors.push('Plan start date format is invalid');
  }
  if (row.plan_end_date && !dayjs(row.plan_end_date).isValid()) {
    errors.push('Plan end date format is invalid');
  }
  if (row.date_of_birth && !dayjs(row.date_of_birth).isValid()) {
    errors.push('Date of birth format is invalid');
  }
  if (row.plan_duration_months && isNaN(Number(row.plan_duration_months))) {
    errors.push('Plan duration must be a number');
  }
  return errors;
}

// ─── GET /members/import ──────────────────────────────────────
// Mounted at /members/import so path here is just '/'
router.get('/', (req, res) => {
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('members/import', { title: 'Import Members', flash, user: req.user });
});

// ─── POST /members/import/preview ────────────────────────────
router.post('/preview', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) {
    req.session.flash = { type: 'error', message: 'Please select an Excel or CSV file to upload.' };
    return res.redirect('/members/import');    // absolute URL redirect
  }

  // Parse workbook from buffer (never written to disk)
  const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json(ws, { defval: '' });

  if (!raw.length) {
    req.session.flash = { type: 'error', message: 'The file is empty or has no data rows.' };
    return res.redirect('/members/import');    // absolute URL redirect
  }

  // Fetch existing member numbers and trainee emails for validation
  const supabase = getSupabase();
  const [{ data: existingMembers }, { data: trainees }] = await Promise.all([
    supabase.from('members').select('member_no'),
    supabase.from('app_users').select('id, email, name').eq('role', 'trainer').eq('is_active', true)
  ]);

  const existingNoSet   = new Set((existingMembers || []).map(r => r.member_no));
  const trainerByEmail  = {};
  (trainees || []).forEach(t => { trainerByEmail[t.email.toLowerCase()] = t; });

  // Track member_nos seen in this import to catch duplicates within the file
  const seenInFile = new Set();

  const rows = raw.map((rawRow, i) => {
    const r = mapHeaders(rawRow);

    // Parse/normalise dates and booleans
    r.plan_start_date    = parseDate(r.plan_start_date);
    r.plan_end_date      = parseDate(r.plan_end_date);
    r.date_of_birth      = parseDate(r.date_of_birth);
    r.notification_enabled = r.notification_enabled !== undefined
      ? parseBool(r.notification_enabled)
      : true;

    // Auto-calculate end date
    if (!r.plan_end_date && r.plan_start_date && r.plan_duration_months) {
      r.plan_end_date = dayjs(r.plan_start_date)
        .add(Number(r.plan_duration_months), 'month')
        .format('YYYY-MM-DD');
    }

    // Resolve trainer
    let assignedTrainerId    = '';
    let trainerEmailWarning  = '';
    if (r.assigned_trainer_email) {
      const te = r.assigned_trainer_email.trim().toLowerCase();
      if (trainerByEmail[te]) {
        assignedTrainerId = trainerByEmail[te].id;
      } else {
        trainerEmailWarning = `Trainer email "${r.assigned_trainer_email}" not found`;
      }
    }

    const errors = validateRow(r, existingNoSet);
    if (trainerEmailWarning) errors.push(trainerEmailWarning);

    // Duplicate within this file
    const noKey = (r.member_no || '').trim();
    if (noKey && seenInFile.has(noKey)) {
      errors.push(`Member number "${noKey}" appears more than once in the file`);
    }
    if (noKey) seenInFile.add(noKey);

    const action = noKey
      ? (existingNoSet.has(noKey) ? 'update' : 'insert')
      : 'invalid';

    return {
      rowIndex:             i,
      member_no:            r.member_no || '',
      full_name:            r.full_name || '',
      phone:                r.phone || '',
      email:                r.email || '',
      gender:               r.gender || '',
      date_of_birth:        r.date_of_birth || '',
      address:              r.address || '',
      emergency_contact_name:  r.emergency_contact_name || '',
      emergency_contact_phone: r.emergency_contact_phone || '',
      plan_name:            r.plan_name || '',
      plan_duration_months: r.plan_duration_months || '',
      plan_start_date:      r.plan_start_date || '',
      plan_end_date:        r.plan_end_date || '',
      notification_enabled: r.notification_enabled,
      assigned_trainer_email: r.assigned_trainer_email || '',
      assigned_trainer_id:  assignedTrainerId,
      notes:                r.notes || '',
      action,
      errors,
      valid: errors.length === 0
    };
  });

  // Store in session so confirm endpoint can cross-check
  req.session.importRowCount = rows.length;

  res.render('members/preview', {
    title:   'Import Preview',
    rows,
    flash:   null,
    user:    req.user,
    trainers: trainees || []
  });
}));

// ─── POST /members/import/confirm ────────────────────────────
router.post('/confirm', asyncRoute(async (req, res) => {
  let rows;
  try {
    rows = JSON.parse(req.body.rows || '[]');
  } catch {
    req.session.flash = { type: 'error', message: 'Invalid submission data. Please re-upload the file.' };
    return res.redirect('/members/import');    // absolute URL redirect
  }

  if (!Array.isArray(rows) || !rows.length) {
    req.session.flash = { type: 'error', message: 'No rows to import.' };
    return res.redirect('/members/import');    // absolute URL redirect
  }

  const supabase = getSupabase();

  // Fetch existing member numbers and trainee map fresh
  const [{ data: existingMembers }, { data: trainees }] = await Promise.all([
    supabase.from('members').select('id, member_no'),
    supabase.from('app_users').select('id, email, name').eq('role', 'trainer').eq('is_active', true)
  ]);

  const existingMap    = {};
  (existingMembers || []).forEach(r => { existingMap[r.member_no] = r.id; });

  const trainerByEmail = {};
  (trainees || []).forEach(t => { trainerByEmail[t.email.toLowerCase()] = t; });

  let inserted = 0, updated = 0, skipped = 0;
  const importErrors = [];

  for (const row of rows) {
    const memberNo = String(row.member_no || '').trim();
    const fullName = String(row.full_name || '').trim();

    if (!memberNo || !fullName) { skipped++; continue; }

    // Re-resolve trainer email in case user edited the email cell
    let assignedTrainerId = nullIfEmpty(row.assigned_trainer_id) || null;
    if (row.assigned_trainer_email) {
      const te = row.assigned_trainer_email.trim().toLowerCase();
      if (trainerByEmail[te]) assignedTrainerId = trainerByEmail[te].id;
    }

    // Auto-calculate end date
    let planEndDate = String(row.plan_end_date || '').slice(0, 10) || null;
    if (!planEndDate && row.plan_start_date && row.plan_duration_months) {
      planEndDate = dayjs(row.plan_start_date)
        .add(Number(row.plan_duration_months), 'month')
        .format('YYYY-MM-DD');
    }

    const notifEnabled = typeof row.notification_enabled === 'boolean'
      ? row.notification_enabled
      : parseBool(row.notification_enabled);

    const dbRow = {
      member_no:               memberNo,
      full_name:               fullName,
      phone:                   nullIfEmpty(row.phone),
      email:                   nullIfEmpty(row.email),
      gender:                  nullIfEmpty(row.gender),
      date_of_birth:           nullIfEmpty(row.date_of_birth),
      address:                 nullIfEmpty(row.address),
      emergency_contact_name:  nullIfEmpty(row.emergency_contact_name),
      emergency_contact_phone: nullIfEmpty(row.emergency_contact_phone),
      plan_name:               nullIfEmpty(row.plan_name),
      plan_duration_months:    row.plan_duration_months ? (Number(row.plan_duration_months) || null) : null,
      plan_start_date:         nullIfEmpty(row.plan_start_date),
      plan_end_date:           planEndDate,
      plan_status:             computePlanStatus(planEndDate),
      notification_enabled:    notifEnabled,
      assigned_trainer_id:     assignedTrainerId,
      notes:                   nullIfEmpty(row.notes),
      is_active:               true
    };

    try {
      if (existingMap[memberNo]) {
        const { error } = await supabase.from('members')
          .update({ ...dbRow, updated_at: new Date().toISOString() })
          .eq('id', existingMap[memberNo]);
        if (error) throw error;
        updated++;
      } else {
        const { error } = await supabase.from('members').insert(dbRow);
        if (error) throw error;
        inserted++;
        existingMap[memberNo] = 'new';  // prevent duplicate insert within same batch
      }
    } catch (err) {
      importErrors.push({ memberNo, fullName, message: err.message });
    }
  }

  // Clear preview session key
  delete req.session.importRowCount;

  res.render('members/result', {
    title:    'Import Complete',
    inserted,
    updated,
    skipped,
    errors:   importErrors,
    total:    rows.length,
    flash:    null,
    user:     req.user
  });
}));

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = router;
