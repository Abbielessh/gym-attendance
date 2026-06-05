const form = document.getElementById('loginForm');
const msg = document.getElementById('loginMessage');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = 'Checking...';
  msg.className = 'form-message';
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(formDataToObject(form))
    });
    window.location.href = '/dashboard';
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-message error';
  }
});
