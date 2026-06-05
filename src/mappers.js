// Null if empty string
function nullIfEmpty(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  return text ? text : null;
}

// ─── app_users ────────────────────────────────────────────────
function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    role: row.role,
    isActive: row.is_active !== false,
    active: row.is_active !== false,   // backward compat alias
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

// ─── members ─────────────────────────────────────────────────
function memberFromRow(row) {
  if (!row) return null;
  const isActive = row.is_active !== false;
  return {
    // New canonical fields
    id: row.id,
    memberNo: row.member_no,
    fullName: row.full_name,
    phone: row.phone || '',
    email: row.email || '',
    gender: row.gender || '',
    dateOfBirth: row.date_of_birth || '',
    address: row.address || '',
    emergencyContactName: row.emergency_contact_name || '',
    emergencyContactPhone: row.emergency_contact_phone || '',
    planName: row.plan_name || '',
    planDurationMonths: row.plan_duration_months || null,
    planStartDate: row.plan_start_date || '',
    planEndDate: row.plan_end_date || '',
    planStatus: row.plan_status || '',
    notificationEnabled: row.notification_enabled !== false,
    assignedTrainerId: row.assigned_trainer_id || '',
    notes: row.notes || '',
    isActive,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    // Backward compat aliases for existing SPA dashboard code
    name: row.full_name,
    memberCode: row.member_no,
    planType: row.plan_name || '',
    planExpiryDate: row.plan_end_date || '',
    planNotify: row.notification_enabled !== false,
    status: isActive ? 'active' : 'inactive',
    emergencyContact: row.emergency_contact_name || '',
    age: null
  };
}

// Build INSERT row from form body (handles both SPA old names and EJS new names)
function memberInsertRow(body) {
  const memberNo  = String(body.memberNo  || body.memberCode || '').trim();
  const fullName  = String(body.fullName  || body.name       || '').trim();
  const planName  = String(body.planName  || body.planType   || '').trim();

  // Accept both old (planExpiryDate) and new (planEndDate) names
  const planEndDate = String(
    body.planEndDate || body.planExpiryDate || ''
  ).slice(0, 10);

  const notifEnabled =
    body.notificationEnabled !== undefined
      ? body.notificationEnabled !== 'false' && body.notificationEnabled !== false
      : body.planNotify !== undefined
        ? body.planNotify !== false && body.planNotify !== 'false'
        : true;

  return {
    member_no:               memberNo,
    full_name:               fullName,
    phone:                   nullIfEmpty(body.phone),
    email:                   nullIfEmpty(body.email),
    gender:                  nullIfEmpty(body.gender),
    date_of_birth:           nullIfEmpty(body.dateOfBirth),
    address:                 nullIfEmpty(body.address),
    emergency_contact_name:  nullIfEmpty(body.emergencyContactName || body.emergencyContact),
    emergency_contact_phone: nullIfEmpty(body.emergencyContactPhone),
    plan_name:               planName || 'Monthly',
    plan_duration_months:    body.planDurationMonths ? (Number(body.planDurationMonths) || null) : null,
    plan_start_date:         String(body.planStartDate || '').slice(0, 10) || null,
    plan_end_date:           planEndDate || null,
    plan_status:             null,   // computed by caller
    notification_enabled:    notifEnabled,
    assigned_trainer_id:     nullIfEmpty(body.assignedTrainerId || body.assignedTraineeId),
    notes:                   nullIfEmpty(body.notes),
    is_active:               body.isActive !== undefined ? body.isActive !== false && body.isActive !== 'false' : true
  };
}

// Build UPDATE row from form body
function memberUpdateRow(body) {
  const out = { updated_at: new Date().toISOString() };

  if (body.fullName  !== undefined) out.full_name  = String(body.fullName  || body.name  || '').trim();
  if (body.name      !== undefined && !body.fullName) out.full_name = String(body.name || '').trim();
  if (body.phone     !== undefined) out.phone    = nullIfEmpty(body.phone);
  if (body.email     !== undefined) out.email    = nullIfEmpty(body.email);
  if (body.gender    !== undefined) out.gender   = nullIfEmpty(body.gender);
  if (body.dateOfBirth !== undefined) out.date_of_birth = nullIfEmpty(body.dateOfBirth);
  if (body.address   !== undefined) out.address  = nullIfEmpty(body.address);

  if (body.emergencyContactName  !== undefined) out.emergency_contact_name  = nullIfEmpty(body.emergencyContactName);
  if (body.emergencyContact      !== undefined && !body.emergencyContactName) out.emergency_contact_name = nullIfEmpty(body.emergencyContact);
  if (body.emergencyContactPhone !== undefined) out.emergency_contact_phone = nullIfEmpty(body.emergencyContactPhone);

  if (body.planName !== undefined) out.plan_name = String(body.planName || body.planType || '').trim() || null;
  if (body.planType !== undefined && !body.planName) out.plan_name = String(body.planType || '').trim() || null;
  if (body.planDurationMonths !== undefined) out.plan_duration_months = body.planDurationMonths ? (Number(body.planDurationMonths) || null) : null;
  if (body.planStartDate !== undefined) out.plan_start_date = String(body.planStartDate || '').slice(0, 10) || null;

  const planEndDate = body.planEndDate || body.planExpiryDate;
  if (planEndDate !== undefined) out.plan_end_date = String(planEndDate || '').slice(0, 10) || null;

  if (body.notificationEnabled !== undefined) {
    out.notification_enabled = body.notificationEnabled !== false && body.notificationEnabled !== 'false';
  } else if (body.planNotify !== undefined) {
    out.notification_enabled = body.planNotify !== false && body.planNotify !== 'false';
  }

  if (body.assignedTrainerId !== undefined) out.assigned_trainer_id = nullIfEmpty(body.assignedTrainerId);
  else if (body.assignedTraineeId !== undefined) out.assigned_trainer_id = nullIfEmpty(body.assignedTraineeId);
  if (body.notes !== undefined) out.notes = nullIfEmpty(body.notes);
  if (body.isActive !== undefined) out.is_active = body.isActive !== false && body.isActive !== 'false';
  if (body.status !== undefined && body.isActive === undefined) {
    out.is_active = body.status !== 'inactive';
  }

  return out;
}

// ─── attendance ───────────────────────────────────────────────
function attendanceFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    personType: row.person_type,
    personId: row.person_id,
    role: row.role,
    inAt: row.in_at,
    outAt: row.out_at || null,
    source: row.source || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ─── pt_sessions ──────────────────────────────────────────────
function sessionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.member_id,
    trainerId: row.trainer_id,
    sessionDate: row.session_date,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : '',
    status: row.status || 'scheduled',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  userFromRow,
  sanitizeUser,
  memberFromRow,
  attendanceFromRow,
  sessionFromRow,
  memberInsertRow,
  memberUpdateRow,
  nullIfEmpty
};
