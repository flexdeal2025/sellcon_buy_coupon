"use client";

import { useState, useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

/** 스마트스토어 상품명 앞의 "[비바콘]" 류 접두 제거 */
export function stripVivacon(name: string | null | undefined): string {
  return (name ?? "").replace(/^\s*\[?\s*비바콘\s*\]?\s*/, "").trim();
}

/**
 * 비바콘 스마트스토어 상품명 자동완성 후보 ([비바콘] 제거, 중복제거, 정렬).
 * 카드장부·재고등록·프리셋 등 상품명 입력 자동완성에 공통 사용.
 */
export function useVivaconProducts(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient().from("smartstore_products").select("name").limit(3000);
      if (!data) return;
      setNames(Array.from(new Set(data.map((r) => stripVivacon(r.name)).filter(Boolean))).sort());
    })();
  }, []);
  return names;
}
