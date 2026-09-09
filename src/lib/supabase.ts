import { createClient } from "@supabase/supabase-js";

// Standard client-side (anon key) client — RLS applies to every query made
// through this. Never import the service role key into anything that ships
// to the browser; that key only ever lives in the webhook edge function and
// any coach-only admin actions that must bypass RLS (e.g. manual grants).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
