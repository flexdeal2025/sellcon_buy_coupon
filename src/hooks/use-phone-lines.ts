"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { PhoneLine } from "@/lib/types";

/**
 * phone_lines 실시간 구독 + CRUD (회선 관리 페이지에서 사용).
 */
export function usePhoneLines() {
  const [lines, setLines] = useState<PhoneLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("phone_lines")
      .select("*")
      .order("sequence_number", { ascending: true });
    if (error) setError(error.message);
    else setLines((data ?? []) as PhoneLine[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel("phone_lines_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "phone_lines" },
        () => fetchAll(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

  const upsert = useCallback(async (line: Partial<PhoneLine>) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("phone_lines")
      .upsert(line, { onConflict: "sequence_number" });
    if (error) throw new Error(error.message);
  }, []);

  const update = useCallback(async (id: string, patch: Partial<PhoneLine>) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("phone_lines").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  }, []);

  const remove = useCallback(async (id: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("phone_lines").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }, []);

  return { lines, loading, error, upsert, update, remove, refresh: fetchAll };
}
