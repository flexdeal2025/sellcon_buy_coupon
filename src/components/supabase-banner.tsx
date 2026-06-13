"use client";

import { AlertTriangle } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Supabase 환경변수가 설정되지 않았을 때 안내 배너.
 * 배포 전 .env 설정을 잊지 않도록 돕습니다.
 */
export function SupabaseBanner() {
  if (isSupabaseConfigured) return null;
  return (
    <div className="flex items-start gap-2 border-b border-warning/30 bg-warning/15 px-4 py-2 text-xs text-warning-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Supabase 환경변수(<code>NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>)가 설정되지 않았습니다. 데이터 저장/조회가
        동작하지 않습니다. <code>.env.local</code> 또는 Vercel 환경변수를 설정하세요.
      </span>
    </div>
  );
}
