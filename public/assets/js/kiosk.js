const input = document.getElementById('kioskInput');
const msg = document.getElementById('kioskMessage');
const numpad = document.getElementById('numpad');
const clearBtn = document.getElementById('clearBtn');
let busy = false;

function showMessage(text, type = 'idle') {
  msg.textContent = text;
  msg.className = `kiosk-message ${type}`;
}

function appendKey(key) {
  if (busy) return;
  if (/^\d$/.test(key)) input.value += key;
  if (key === 'back') input.value = input.value.slice(0, -1);
  if (key === 'enter') punch();
  input.focus();
}

async function punch() {
  if (busy) return;
  const code = input.value.trim();
  if (!code) return showMessage('Enter member number first', 'error');
  busy = true;
  showMessage('Saving attendance...', 'idle');
  try {
    const data = await api('/api/kiosk/punch', { method: 'POST', body: JSON.stringify({ code }) });
    const warn = data.member?.planStatus === 'expires-today' ? ' Plan expires today.' : data.member?.planStatus === 'expired' ? ' Plan expired.' : '';
    showMessage(`${data.action === 'checkin' ? 'IN' : 'OUT'}: ${data.message}${warn}`, data.action === 'checkin' ? 'success' : 'info');
    input.value = '';
  } catch (err) {
    showMessage(`Error: ${err.message}`, 'error');
  } finally {
    busy = false;
    input.focus();
  }
}

numpad.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-key]');
  if (!btn) return;
  appendKey(btn.dataset.key);
});

clearBtn.addEventListener('click', () => {
  input.value = '';
  showMessage('Ready for attendance', 'idle');
  input.focus();
});

window.addEventListener('keydown', (e) => {
  if (document.activeElement !== input && /^\d$/.test(e.key)) input.focus();
  if (e.key === 'Enter') punch();
});

input.focus();
