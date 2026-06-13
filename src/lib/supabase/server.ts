import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 서버(Route Handler) 전용 Supabase 클라이언트.
 * service_role 키가 있으면 사용하고, 없으면 anon 키로 폴백합니다.
 * service_role 키는 절대 클라이언트로 노출하지 마세요.
 */
export function getServerSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  return createClient(url || "http://localhost", key || "public-anon-key", {
    auth: { persistSession: false },
  });
}
