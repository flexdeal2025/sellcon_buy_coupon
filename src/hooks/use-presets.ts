"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { LS_KEYS, DEFAULT_SUPPLIERS, DEFAULT_PRODUCTS } from "@/lib/constants";

type Kind = "supplier" | "product";

const MIGRATED_KEY = "gc_presets_migrated_v1";

/** localStorage에서 기존 프리셋 배열 읽기 (이관용) */
function readLS(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/**
 * 자주 쓰는 매입처/상품명 프리셋 (Supabase 저장, 모든 기기 공유).
 * 첫 로드 시 기존 localStorage 값을 자동 이관하고, 전역적으로 비어있으면 기본값을 시드한다.
 */
export function usePresets() {
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const ran = useRef(false);

  const fetchAll = useCallback(async () => {
    const sb = getSupabaseClient();
    const { data } = await sb
      .from("presets")
      .select("kind,value")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    const rows = (data as { kind: Kind; value: string }[] | null) ?? [];
    setSuppliers(rows.filter((r) => r.kind === "supplier").map((r) => r.value));
    setProducts(rows.filter((r) => r.kind === "product").map((r) => r.value));
    return rows;
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const sb = getSupabaseClient();
      const rows = await fetchAll();

      const migrated = (() => {
        try { return window.localStorage.getItem(MIGRATED_KEY) === "1"; }
        catch { return false; }
      })();

      if (!migrated) {
        const seed: { kind: Kind; value: string; sort_order: number }[] = [];
        // 테이블이 전역적으로 비어있으면: 이 기기 localStorage 값(없으면 기본값)으로 시드
        // 이미 채워져 있으면: 이 기기 localStorage 값만 병합(중복은 무시)
        const empty = rows.length === 0;
        const sup = readLS(LS_KEYS.suppliers) ?? (empty ? DEFAULT_SUPPLIERS : []);
        const prod = readLS(LS_KEYS.products) ?? (empty ? DEFAULT_PRODUCTS : []);
        sup.forEach((value, i) => seed.push({ kind: "supplier", value, sort_order: i }));
        prod.forEach((value, i) => seed.push({ kind: "product", value, sort_order: i }));

        if (seed.length > 0) {
          await sb.from("presets").upsert(seed, { onConflict: "kind,value", ignoreDuplicates: true });
        }
        try { window.localStorage.setItem(MIGRATED_KEY, "1"); } catch { /* ignore */ }
        await fetchAll();
      }
      setHydrated(true);
    })();
  }, [fetchAll]);

  const add = useCallback(async (kind: Kind, name: string) => {
    const v = name.trim();
    if (!v) return;
    const setter = kind === "supplier" ? setSuppliers : setProducts;
    let added = false;
    setter((prev) => {
      if (prev.includes(v)) return prev;
      added = true;
      return [...prev, v];
    });
    if (!added) return;
    const sb = getSupabaseClient();
    await sb.from("presets").upsert(
      { kind, value: v, sort_order: 999 },
      { onConflict: "kind,value", ignoreDuplicates: true },
    );
  }, []);

  const remove = useCallback(async (kind: Kind, name: string) => {
    const setter = kind === "supplier" ? setSuppliers : setProducts;
    setter((prev) => prev.filter((x) => x !== name));
    const sb = getSupabaseClient();
    await sb.from("presets").delete().eq("kind", kind).eq("value", name);
  }, []);

  return {
    suppliers,
    products,
    addSupplier: (name: string) => add("supplier", name),
    removeSupplier: (name: string) => remove("supplier", name),
    addProduct: (name: string) => add("product", name),
    removeProduct: (name: string) => remove("product", name),
    hydrated,
  };
}
