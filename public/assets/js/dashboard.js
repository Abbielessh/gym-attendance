const page = document.getElementById('pageContent');
const navList = document.getElementById('navList');
const welcomeText = document.getElementById('welcomeText');
const roleText = document.getElementById('roleText');
const gymName = document.getElementById('gymName');
const toast = document.getElementById('toast');

const state = {
  activeTab: 'overview',
  user: null,
  dashboard: null,
  members: [],
  trainees: [],
  sessions: [],
  publicAttendance: [],
  traineeAttendance: []
};

const allTabs = [
  { id: 'overview', label: 'Overview', icon: 'OV' },
  { id: 'members', label: 'Members', icon: 'MB' },
  { id: 'attendance', label: 'Attendance', icon: 'AT' },
  { id: 'trainees', label: 'Trainees', icon: 'TR' },
  { id: 'sessions', label: 'PT Sessions', icon: 'PT' }
];

function notify(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.className = 'toast hidden', 2800);
}

function navTabs() {
  const tabs = state.user?.role === 'manager' ? allTabs : allTabs.filter(t => t.id !== 'trainees');
  navList.innerHTML = tabs.map(tab => `
    <button class="nav-item ${state.activeTab === tab.id ? 'active' : ''}" data-tab="${tab.id}">
      <span>${tab.icon}</span>${tab.label}
    </button>`).join('');
}

async function loadData() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
  } catch {
    window.location.href = '/login';
    return;
  }
  const [dashboard, members, trainees, sessions, publicAttendance, traineeAttendance] = await Promise.all([
    api('/api/dashboard'),
    api('/api/members'),
    api('/api/trainees'),
    api('/api/sessions'),
    api('/api/attendance?type=public'),
    api('/api/attendance?type=trainee')
  ]);
  state.dashboard = dashboard;
  state.members = members.members;
  state.trainees = trainees.trainees;
  state.sessions = sessions.sessions;
  state.publicAttendance = publicAttendance.records;
  state.traineeAttendance = traineeAttendance.records;
  welcomeText.textContent = `Welcome, ${state.user.name}`;
  roleText.textContent = state.user.role === 'manager' ? 'Manager dashboard' : 'Trainee dashboard';
  gymName.textContent = dashboard.gymName || 'Dashboard';
  navTabs();
  render();
}

function render() {
  if (state.activeTab === 'overview') return renderOverview();
  if (state.activeTab === 'members') return renderMembers();
  if (state.activeTab === 'attendance') return renderAttendance();
  if (state.activeTab === 'trainees') return renderTrainees();
  if (state.activeTab === 'sessions') return renderSessions();
}

function statCard(label, value, hint, icon) {
  return `<article class="stat-card"><span class="stat-icon stat-code">${icon}</span><p>${label}</p><h3>${value}</h3><small>${hint}</small></article>`;
}

function renderOverview() {
  const s = state.dashboard.stats;
  page.innerHTML = `
    <section class="stats-grid">
      ${statCard('Active Members', s.activeMembers, 'Current public members', 'MB')}
      ${statCard('Inside Now', s.insideNow, 'Members not checked out', 'IN')}
      ${statCard('Public Check-ins Today', s.publicCheckinsToday, 'Desk kiosk and manual', 'AT')}
      ${statCard('Plan Alerts', s.planAlerts, 'Expired or expiring soon', 'PL')}
      ${statCard('Trainee Attendance', s.traineeAttendanceToday, 'Today records', 'TR')}
      ${statCard('PT Sessions Today', s.sessionsToday, 'Scheduled sessions', 'PT')}
    </section>
    <section class="two-col">
      <div class="panel">
        <div class="panel-head"><h3>Plan expiry notifications</h3><span class="badge warning">${state.dashboard.planAlerts.length}</span></div>
        ${state.dashboard.planAlerts.length ? `
          <div class="list-stack">${state.dashboard.planAlerts.map(alertMemberCard).join('')}</div>
        ` : `<p class="empty">No plan expiry alerts.</p>`}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Currently inside</h3><span class="badge success">${state.dashboard.insideNow.length}</span></div>
        ${state.dashboard.insideNow.length ? attendanceMiniList(state.dashboard.insideNow) : `<p class="empty">No one is currently inside.</p>`}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Today public attendance</h3><a class="small-link" data-open-tab="attendance">View all</a></div>
      ${attendanceTable(state.dashboard.publicToday.slice(0, 8))}
    </section>
  `;
}

function alertMemberCard(m) {
  const statusText = m.planStatus === 'expired' ? 'Expired' : m.planStatus === 'expires-today' ? 'Expires today' : `${m.daysLeft} days left`;
  return `<div class="alert-row">
    <div><strong>${escapeHtml(m.name)}</strong><p>${escapeHtml(m.memberCode)} | ${escapeHtml(m.phone)} | ${escapeHtml(m.planType)}</p></div>
    <span class="badge ${m.planStatus === 'expired' ? 'danger' : 'warning'}">${statusText}</span>
  </div>`;
}

function attendanceMiniList(records) {
  return `<div class="list-stack">${records.map(r => `<div class="alert-row"><div><strong>${escapeHtml(r.personName)}</strong><p>IN: ${fmtDateTime(r.inAt)}</p></div><span class="badge success">Inside</span></div>`).join('')}</div>`;
}

function renderMembers() {
  const manager = state.user.role === 'manager';
  page.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h3>Public member details and plans</h3><span class="badge">${state.members.length} members</span></div>
      ${manager ? memberForm() : ''}
      <div class="table-wrap">${memberTable()}</div>
    </section>
  `;
  attachMemberEvents();
}

function memberForm() {
  return `<form id="memberForm" class="grid-form">
    <label>Member Number<input name="memberCode" placeholder="1004" required /></label>
    <label>Name<input name="name" placeholder="Member name" required /></label>
    <label>Phone<input name="phone" placeholder="98765xxxxx" /></label>
    <label>Age<input name="age" type="number" min="1" placeholder="25" /></label>
    <label>Gender<select name="gender"><option>Male</option><option>Female</option><option>Other</option></select></label>
    <label>Plan<select name="planType" id="planType"><option>Monthly</option><option>6 Months</option><option>1 Year</option><option>Custom</option></select></label>
    <label>Plan Start<input name="planStartDate" id="planStartDate" type="date" value="${todayISO()}" /></label>
    <label>Plan Expiry<input name="planExpiryDate" id="planExpiryDate" type="date" value="${addMonths(todayISO(), 1)}" /></label>
    <label>Assigned Trainee<select name="assignedTraineeId"><option value="">No trainee</option>${state.trainees.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}</select></label>
    <label>Emergency Contact<input name="emergencyContact" placeholder="Optional" /></label>
    <label class="wide">Address<input name="address" placeholder="Area / address" /></label>
    <label class="wide">Notes<input name="notes" placeholder="Fitness goal, health note, etc." /></label>
    <label class="check-row"><input name="planNotify" type="checkbox" checked /> Show plan expiry notification</label>
    <button class="btn primary" type="submit">Add member</button>
  </form>`;
}

function memberTable() {
  if (!state.members.length) return `<p class="empty">No members added.</p>`;
  return `<table><thead><tr><th>Member</th><th>Phone</th><th>Plan</th><th>Expiry</th><th>Trainee</th><th>Notify</th><th>Status</th></tr></thead><tbody>
    ${state.members.map(m => `<tr>
      <td><strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.memberCode)} | ${escapeHtml(m.gender || '-')} | ${m.age || '-'}</small></td>
      <td>${escapeHtml(m.phone || '-')}</td>
      <td>${escapeHtml(m.planType || '-')}</td>
      <td>${fmtDate(m.planExpiryDate)}<br><span class="badge ${badgeClass(m.planStatus)}">${planLabel(m)}</span></td>
      <td>${escapeHtml(m.assignedTraineeName || '-')}</td>
      <td><input type="checkbox" class="notify-toggle" data-id="${m.id}" ${m.planNotify ? 'checked' : ''} ${state.user.role !== 'manager' ? 'disabled' : ''}></td>
      <td><span class="badge ${m.status === 'active' ? 'success' : 'danger'}">${escapeHtml(m.status)}</span></td>
    </tr>`).join('')}
  </tbody></table>`;
}

function badgeClass(status) {
  if (status === 'expired') return 'danger';
  if (status === 'expires-today' || status === 'expiring-soon') return 'warning';
  if (status === 'active') return 'success';
  return '';
}

function planLabel(m) {
  if (m.planStatus === 'expired') return 'Expired';
  if (m.planStatus === 'expires-today') return 'Ends today';
  if (m.planStatus === 'expiring-soon') return `${m.daysLeft} days left`;
  if (m.planStatus === 'active') return `${m.daysLeft} days left`;
  return 'No plan';
}

function attachMemberEvents() {
  const form = document.getElementById('memberForm');
  if (form) {
    const planType = document.getElementById('planType');
    const start = document.getElementById('planStartDate');
    const expiry = document.getElementById('planExpiryDate');
    function syncExpiry() {
      if (planType.value === 'Monthly') expiry.value = addMonths(start.value, 1);
      if (planType.value === '6 Months') expiry.value = addMonths(start.value, 6);
      if (planType.value === '1 Year') expiry.value = addMonths(start.value, 12);
    }
    planType.addEventListener('change', syncExpiry);
    start.addEventListener('change', syncExpiry);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/members', { method: 'POST', body: JSON.stringify(formDataToObject(form)) });
        notify('Member added successfully');
        form.reset();
        await loadData();
      } catch (err) { notify(err.message, 'error'); }
    });
  }
  document.querySelectorAll('.notify-toggle').forEach(input => {
    input.addEventListener('change', async () => {
      try {
        await api(`/api/members/${input.dataset.id}`, { method: 'PUT', body: JSON.stringify({ planNotify: input.checked }) });
        notify('Notification toggle updated');
        await loadData();
      } catch (err) { notify(err.message, 'error'); }
    });
  });
}

function renderAttendance() {
  const manager = state.user.role === 'manager';
  page.innerHTML = `
    <section class="two-col">
      <div class="panel">
        <div class="panel-head"><h3>Public attendance</h3><span class="badge">${state.publicAttendance.length}</span></div>
        ${manager ? manualAttendanceForm() : '<p class="muted">Trainees can view public attendance. Manual add is manager only.</p>'}
        ${attendanceTable(state.publicAttendance)}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Trainee attendance</h3><button id="myTraineePunch" class="btn primary">${state.user.role === 'trainee' ? 'My IN/OUT' : 'Selected trainee IN/OUT'}</button></div>
        ${manager ? `<label class="field-mini">Choose trainee<select id="traineePunchSelect">${state.trainees.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}</select></label>` : ''}
        ${attendanceTable(state.traineeAttendance)}
      </div>
    </section>
  `;
  attachAttendanceEvents();
}

function manualAttendanceForm() {
  return `<form id="manualAttendanceForm" class="grid-form compact-form">
    <label>Type<select name="personType" id="manualPersonType"><option value="member">Public Member</option><option value="trainee">Trainee</option></select></label>
    <label>Person<select name="personId" id="manualPersonId"></select></label>
    <label>IN Time<input name="inAt" type="datetime-local" required /></label>
    <label>OUT Time<input name="outAt" type="datetime-local" /></label>
    <button class="btn primary" type="submit">Add manual attendance</button>
  </form>`;
}

function setManualPersonOptions() {
  const type = document.getElementById('manualPersonType')?.value;
  const person = document.getElementById('manualPersonId');
  if (!person) return;
  const options = type === 'trainee' ? state.trainees : state.members;
  person.innerHTML = options.map(p => `<option value="${p.id}">${escapeHtml(p.name)} ${p.memberCode ? `(${escapeHtml(p.memberCode)})` : ''}</option>`).join('');
}

function attachAttendanceEvents() {
  setManualPersonOptions();
  document.getElementById('manualPersonType')?.addEventListener('change', setManualPersonOptions);
  document.getElementById('manualAttendanceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/attendance/manual', { method: 'POST', body: JSON.stringify(formDataToObject(e.target)) });
      notify('Manual attendance added');
      await loadData();
    } catch (err) { notify(err.message, 'error'); }
  });
  document.getElementById('myTraineePunch')?.addEventListener('click', async () => {
    const traineeId = document.getElementById('traineePunchSelect')?.value;
    try {
      const payload = traineeId ? { traineeId } : {};
      const data = await api('/api/attendance/trainee-punch', { method: 'POST', body: JSON.stringify(payload) });
      notify(data.action === 'checkin' ? 'Trainee IN saved' : 'Trainee OUT saved');
      await loadData();
    } catch (err) { notify(err.message, 'error'); }
  });
}

function attendanceTable(records) {
  if (!records.length) return `<p class="empty">No attendance records.</p>`;
  return `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>IN</th><th>OUT</th><th>Source</th><th>Status</th></tr></thead><tbody>
    ${records.map(r => `<tr><td><strong>${escapeHtml(r.personName)}</strong><small>${escapeHtml(r.code || '')}</small></td><td>${escapeHtml(r.role)}</td><td>${fmtDateTime(r.inAt)}</td><td>${fmtDateTime(r.outAt)}</td><td>${escapeHtml(r.source || '-')}</td><td><span class="badge ${r.inside ? 'success' : ''}">${r.inside ? 'Inside' : 'Closed'}</span></td></tr>`).join('')}
  </tbody></table></div>`;
}

function renderTrainees() {
  if (state.user.role !== 'manager') {
    state.activeTab = 'overview';
    navTabs();
    return renderOverview();
  }
  page.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h3>Trainee staff</h3><span class="badge">${state.trainees.length}</span></div>
      <form id="traineeForm" class="grid-form compact-form">
        <label>Name<input name="name" placeholder="Trainee name" required /></label>
        <label>Email<input name="email" type="email" placeholder="trainer@gym.com" required /></label>
        <label>Phone<input name="phone" placeholder="Optional" /></label>
        <label>Password<input name="password" value="123456" /></label>
        <button class="btn primary" type="submit">Add trainee</button>
      </form>
      <div class="cards-grid">${state.trainees.map(t => `<article class="mini-card"><span>TR</span><h3>${escapeHtml(t.name)}</h3><p>${escapeHtml(t.email)}</p><small>${escapeHtml(t.phone || 'No phone')}</small></article>`).join('')}</div>
    </section>`;
  document.getElementById('traineeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/trainees', { method: 'POST', body: JSON.stringify(formDataToObject(e.target)) });
      notify('Trainee added');
      await loadData();
    } catch (err) { notify(err.message, 'error'); }
  });
}

function renderSessions() {
  const manager = state.user.role === 'manager';
  page.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h3>PT session clients</h3><span class="badge">${state.sessions.length}</span></div>
      ${manager ? sessionForm() : '<p class="muted">Your assigned PT sessions are shown below.</p>'}
      <div class="session-list">${sessionCards()}</div>
    </section>`;
  attachSessionEvents();
}

function sessionForm() {
  return `<form id="sessionForm" class="grid-form compact-form">
    <label>Client<select name="memberId">${state.members.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.memberCode)})</option>`).join('')}</select></label>
    <label>Trainee<select name="traineeId">${state.trainees.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}</select></label>
    <label>Date<input name="sessionDate" type="date" value="${todayISO()}" required /></label>
    <label>Time<input name="startTime" type="time" /></label>
    <label class="wide">Notes<input name="notes" placeholder="Session plan" /></label>
    <button class="btn primary" type="submit">Create PT session</button>
  </form>`;
}

function sessionCards() {
  if (!state.sessions.length) return `<p class="empty">No PT sessions.</p>`;
  return state.sessions.map(s => `<article class="session-card">
    <div><h3>${escapeHtml(s.memberName || 'Client')}</h3><p>${fmtDate(s.sessionDate)} ${escapeHtml(s.startTime || '')} | Trainer: ${escapeHtml(s.traineeName || '-')}</p><small>${escapeHtml(s.notes || 'No notes')}</small></div>
    <div class="session-actions"><span class="badge ${s.status === 'completed' ? 'success' : s.status === 'missed' ? 'danger' : 'warning'}">${escapeHtml(s.status)}</span>
    ${s.status !== 'completed' ? `<button class="btn success soft session-status" data-id="${s.id}" data-status="completed">Complete</button>` : ''}
    ${s.status !== 'missed' ? `<button class="btn danger soft session-status" data-id="${s.id}" data-status="missed">Missed</button>` : ''}</div>
  </article>`).join('');
}

function attachSessionEvents() {
  document.getElementById('sessionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/sessions', { method: 'POST', body: JSON.stringify(formDataToObject(e.target)) });
      notify('PT session created');
      await loadData();
    } catch (err) { notify(err.message, 'error'); }
  });
  document.querySelectorAll('.session-status').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/sessions/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
        notify('Session updated');
        await loadData();
      } catch (err) { notify(err.message, 'error'); }
    });
  });
}

navList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  state.activeTab = btn.dataset.tab;
  navTabs();
  render();
});

page.addEventListener('click', (e) => {
  const link = e.target.closest('[data-open-tab]');
  if (!link) return;
  state.activeTab = link.dataset.openTab;
  navTabs();
  render();
});

document.getElementById('refreshBtn').addEventListener('click', loadData);
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  window.location.href = '/login';
});

loadData();
