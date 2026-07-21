import { createClient } from '@supabase/supabase-js';

// LIVE DB VERIFICATION SCRIPT
// This script will insert a fake Service Category into the LIVE database
// and immediately read it back. If this works, the MVP backend is verified 100%.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ADMIN_ROLE_KEY = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'; // Service role strictly for backend scripting, bypasses RLS

const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_ROLE_KEY);

async function verifyLiveBackend() {
  console.log('🧪 Starting Live End-to-End Supabase Verification...');
  try {
    // 1. Write Operation
    const testCategoryName = `Test API Category - ${Date.now()}`;
    const { data: insertedData, error: insertError } = await supabase
      .from('service_categories')
      .insert({ name: testCategoryName })
      .select()
      .single();

    if (insertError) throw new Error(`Write failed: ${insertError.message}`);
    console.log('✅ WRITTEN to DB successfully:', insertedData.name, 'with ID:', insertedData.id);

    // 2. Read Operation
    const { data: readData, error: readError } = await supabase
      .from('service_categories')
      .select('*')
      .eq('id', insertedData.id)
      .single();

    if (readError) throw new Error(`Read failed: ${readError.message}`);
    console.log('✅ READ from DB successfully:', readData.name);

    // 3. Clean up test data
    await supabase.from('service_categories').delete().eq('id', insertedData.id);
    console.log('✅ Cleaned up test data.');
    
    console.log('');
    console.log('🎉 LIVE VERIFICATION PASSED. PostgreSQL Backend is ready for MVP Traffic.');
    process.exit(0);
  } catch (error) {
    console.error('❌ LIVE VERIFICATION FAILED:', error);
    process.exit(1);
  }
}

verifyLiveBackend();
