import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ADMIN_ROLE_KEY = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';

const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_ROLE_KEY);

async function checkSeed() {
  console.log('🧪 Checking Materialized View Seed Data...');
  try {
    const { data: mvData, error: mvError } = await supabase
      .from('public_directory_listings')
      .select('*');

    if (mvError) throw new Error(mvError.message);
    console.log('✅ SEED MV DATA:', mvData);

    const { data: users, error: uError } = await supabase.from('customer_profiles').select('*');
    if(uError) throw new Error(uError.message);
    console.log('✅ SEED CUSTOMER DATA:', users);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ SEED CHECK FAILED:', error);
    process.exit(1);
  }
}

checkSeed();
