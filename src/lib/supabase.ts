
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing Supabase environment variables."
  );
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl)) {
  throw new Error(
    "Invalid Supabase URL. Check NEXT_PUBLIC_SUPABASE_URL."
  );
}

if (/[\r\n]/.test(supabaseKey)) {
  throw new Error(
    "Supabase public key contains a newline."
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
