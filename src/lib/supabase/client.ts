"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * 브라우저용 Supabase 클라이언트 (싱글톤).
 * 환경변수가 비어 있어도 빌드는 통과하며, 런타임에 isSupabaseConfigured 로 체크합니다.
 */
let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(url || "http://localhost", anonKey || "public-anon-key", {
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return _client;
}

export const isSupabaseConfigured = Boolean(url && anonKey);
