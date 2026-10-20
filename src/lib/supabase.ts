
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing public Supabase environment variables.");
}

if (
  !supabaseUrl.startsWith("https://") ||
  !supabaseUrl.endsWith(".supabase.co")
) {
  throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL configuration.");
}

if (
  supabaseKey.includes("\n") ||
  supabaseKey.includes("\r") ||
  /[^\x21-\x7E]/.test(supabaseKey)
) {
  throw new Error("Invalid Supabase public key formatting.");
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
