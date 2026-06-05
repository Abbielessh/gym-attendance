const bcrypt = require('bcrypt');

const ROUNDS = 10;

async function hashPassword(password) {
  return bcrypt.hash(String(password), ROUNDS);
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  return bcrypt.compare(String(password), String(storedHash));
}

module.exports = { hashPassword, verifyPassword };
