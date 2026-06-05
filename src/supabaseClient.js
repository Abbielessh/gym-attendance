const { createClient } = require('@supabase/supabase-js');

let supabase;

function assertSupabaseEnv() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    console.error(`Missing environment variable(s): ${missing.join(', ')}`);
    console.error('Create a .env file from .env.example, then paste your Supabase Project URL and service_role key.');
    process.exit(1);
  }
}

function getSupabase() {
  if (!supabase) {
    assertSupabaseEnv();
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return supabase;
}

function throwIfError(error, message = 'Database request failed') {
  if (!error) return;
  const err = new Error(error.message || message);
  err.status = 500;
  throw err;
}

module.exports = { assertSupabaseEnv, getSupabase, throwIfError };
