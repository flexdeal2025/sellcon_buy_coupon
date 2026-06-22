"use client";

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

interface Vendor {
  id: string;
  name: string;
  name_en: string;
}

export function PurchaseVendorsPanel() {
  const sb = getSupabaseClient();
  const [rows, setRows] = useState<Vendor[]>([]);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");

  const fetchRows = useCallback(async () => {
    const { data } = await sb.from("purchase_vendors").select("*").order("name", { ascending: true });
    if (data) setRows(data as Vendor[]);
  }, [sb]);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  const add = async () => {
    const n = name.trim();
    if (!n) { toast.error("매입처명을 입력하세요"); return; }
    const { data, error } = await sb.from("purchase_vendors").insert({ name: n, name_en: nameEn.trim() }).select().single();
    if (error) { toast.error(error.message.includes("duplicate") ? "이미 있는 매입처" : "추가 실패"); return; }
    setRows((p) => [...p, data as Vendor].sort((a, b) => a.name.localeCompare(b.name)));
    setName(""); setNameEn("");
  };

  const saveEn = async (id: string, value: string) => {
    const { error } = await sb.from("purchase_vendors").update({ name_en: value }).eq("id", id);
    if (error) { toast.error("저장 실패"); return; }
    setRows((p) => p.map((r) => (r.id === id ? { ...r, name_en: value } : r)));
  };

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    const { error } = await sb.from("purchase_vendors").delete().eq("id", id);
    if (error) { toast.error("삭제 실패"); return; }
    setRows((p) => p.filter((r) => r.id !== id));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        매입처별 영문명을 직접 관리합니다. 영문매입처명은 이미지형 재고 발행 시 파일명에 사용됩니다 (예: 당근마켓 → daangn).
      </p>

      {/* 추가 */}
      <div className="flex flex-wrap gap-2">
        <input className="w-40 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder="매입처명 (당근마켓)"
          value={name} onChange={(e) => setName(e.target.value)} />
        <input className="w-40 rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-mono" placeholder="영문명 (daangn)"
          value={nameEn} onChange={(e) => setNameEn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button onClick={add} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          <Plus className="h-3.5 w-3.5" /> 추가
        </button>
      </div>

      {/* 목록 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-3 py-2 text-left text-xs">매입처명</th>
              <th className="px-3 py-2 text-left text-xs">영문명(파일명용)</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted-foreground text-sm">등록된 매입처가 없습니다</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/50">
                <td className="px-3 py-1.5 text-xs font-medium">{r.name}</td>
                <td className="px-2 py-1.5">
                  <input className="w-40 rounded-md border border-border bg-background px-2 py-1 text-xs font-mono"
                    defaultValue={r.name_en} placeholder="영문명"
                    onBlur={(e) => e.target.value !== r.name_en && saveEn(r.id, e.target.value.trim())} />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
