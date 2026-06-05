function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    role: row.role,
    active: row.active !== false,
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

function memberFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberCode: row.member_code,
    name: row.name,
    phone: row.phone || '',
    age: row.age || 0,
    gender: row.gender || '',
    address: row.address || '',
    emergencyContact: row.emergency_contact || '',
    planType: row.plan_type || '',
    planStartDate: row.plan_start_date || '',
    planExpiryDate: row.plan_expiry_date || '',
    planNotify: row.plan_notify !== false,
    assignedTraineeId: row.assigned_trainee_id || '',
    status: row.status || 'active',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

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

function sessionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.member_id,
    traineeId: row.trainee_id,
    sessionDate: row.session_date,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : '',
    status: row.status || 'scheduled',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function nullIfEmpty(value) {
  const text = String(value || '').trim();
  return text ? text : null;
}

function memberInsertRow(body) {
  return {
    member_code: String(body.memberCode || '').trim(),
    name: String(body.name || '').trim(),
    phone: nullIfEmpty(body.phone),
    age: Number(body.age || 0) || null,
    gender: nullIfEmpty(body.gender),
    address: nullIfEmpty(body.address),
    emergency_contact: nullIfEmpty(body.emergencyContact),
    plan_type: String(body.planType || 'Monthly'),
    plan_start_date: String(body.planStartDate || '').slice(0, 10),
    plan_expiry_date: String(body.planExpiryDate || '').slice(0, 10),
    plan_notify: body.planNotify !== false,
    assigned_trainee_id: nullIfEmpty(body.assignedTraineeId),
    status: String(body.status || 'active'),
    notes: nullIfEmpty(body.notes)
  };
}

function memberUpdateRow(body) {
  const mapping = {
    name: 'name',
    phone: 'phone',
    age: 'age',
    gender: 'gender',
    address: 'address',
    emergencyContact: 'emergency_contact',
    planType: 'plan_type',
    planStartDate: 'plan_start_date',
    planExpiryDate: 'plan_expiry_date',
    planNotify: 'plan_notify',
    assignedTraineeId: 'assigned_trainee_id',
    status: 'status',
    notes: 'notes'
  };
  const out = { updated_at: new Date().toISOString() };
  for (const [from, to] of Object.entries(mapping)) {
    if (!Object.prototype.hasOwnProperty.call(body, from)) continue;
    if (['phone', 'gender', 'address', 'emergency_contact', 'assigned_trainee_id', 'notes'].includes(to)) out[to] = nullIfEmpty(body[from]);
    else if (to === 'age') out[to] = Number(body[from] || 0) || null;
    else out[to] = body[from];
  }
  return out;
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
