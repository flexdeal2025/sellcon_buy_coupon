"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { PurchaseRecord, PurchaseInsert } from "@/lib/types";

/**
 * purchase_records 실시간 구독 + CRUD.
 * 부부 중 한 명이 변경하면 Realtime 으로 모두에게 즉시 반영됩니다.
 */
export function useRecords() {
  const [records, setRecords] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("purchase_records")
      .select("*")
      .order("purchase_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setRecords((data ?? []) as PurchaseRecord[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    if (!isSupabaseConfigured) return;

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel("purchase_records_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_records" },
        () => {
          fetchAll();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

  const insert = useCallback(async (payload: PurchaseInsert) => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("purchase_records")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as PurchaseRecord;
  }, []);

  const update = useCallback(
    async (id: string, patch: Partial<PurchaseRecord>) => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("purchase_records")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as PurchaseRecord;
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("purchase_records").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }, []);

  return { records, loading, error, insert, update, remove, refresh: fetchAll };
}
