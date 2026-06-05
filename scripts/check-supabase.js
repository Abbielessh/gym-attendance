require('dotenv').config();
const { getSupabase, assertSupabaseEnv } = require('../src/supabaseClient');

async function main() {
  assertSupabaseEnv();
  const supabase = getSupabase();
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  console.log('Supabase connection successful.');
  console.log(`Gym name: ${(data && data.gym_name) || 'Not set'}`);
}

main().catch((err) => {
  console.error('Supabase connection failed.');
  console.error(err.message || err);
  process.exit(1);
});
