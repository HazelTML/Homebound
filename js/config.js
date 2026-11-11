/*
 * Copy the Project URL and publishable/anon key from Supabase > Project Settings > API.
 * The publishable key is designed to be used by browser clients, WITH RLS enabled.
 * NEVER put a service_role/secret key in this file.
 * Leave these blank to use the original, fully offline-in-memory DEMO mode.
 */
window.HOMEBOUND_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_PUBLISHABLE_KEY: ''
};