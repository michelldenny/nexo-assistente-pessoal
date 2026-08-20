import { createClient } from "@supabase/supabase-js";

export function getSupabase() {
  const envObj = (globalThis as unknown as { env?: Record<string, string> })
    .env;
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    envObj?.SUPABASE_URL ||
    envObj?.NEXT_PUBLIC_SUPABASE_URL;

  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    envObj?.SUPABASE_SECRET_KEY ||
    envObj?.SUPABASE_SERVICE_ROLE_KEY ||
    envObj?.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey)
    throw new Error(
      "Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SECRET_KEY no arquivo .env.local ou no painel da Vercel."
    );
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function camel<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value])) as T;
}
