"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Loader2, RefreshCw, Trash2, ExternalLink, FileText, FileArchive } from "lucide-react";

const AUTH = { "x-app-passcode": process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234" };

interface Doc {
  id: string; supplier: string; doc_date: string | null; amount: number | null;
  memo: string; file_name: string; content_type: string; url: string; created_at: string;
}

const fileIcon = (ct: string) => (ct.includes("pdf") ? "📄" : ct.startsWith("image/") ? "🖼️" : ct.includes("sheet") || ct.includes("excel") ? "📊" : "📎");

export function SupplierDocsPanel() {
  const [vendors, setVendors] = useState<string[]>([]);
  const [fSupplier, setFSupplier] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient().from("purchase_vendors").select("name").order("name");
      setVendors((data ?? []).map((v: { name: string }) => v.name));
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (fSupplier) p.set("supplier", fSupplier);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const res = await fetch(`/api/supplier-docs?${p}`, { headers: AUTH, cache: "no-store" });
      const json = await res.json();
      if (!json.ok) { toast.error("조회 실패: " + json.error); return; }
      setRows(json.rows as Doc[]);
    } finally { setLoading(false); }
  }, [fSupplier, from, to]);
  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    if (!confirm("이 증빙을 삭제합니다(파일 포함). 계속할까요?")) return;
    const res = await fetch(`/api/supplier-docs?id=${id}`, { method: "DELETE", headers: AUTH });
    const json = await res.json();
    if (!json.ok) { toast.error("삭제 실패: " + json.error); return; }
    await load();
  }

  async function downloadZip() {
    if (!fSupplier) { toast.error("일괄 다운로드는 공급처를 먼저 선택하세요"); return; }
    setZipping(true);
    try {
      const p = new URLSearchParams({ supplier: fSupplier });
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const res = await fetch(`/api/supplier-docs/download-zip?${p}`, { headers: AUTH });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error("다운로드 실패: " + (j.error || res.status));
        return;
      }
      const blob = await res.blob();
      const t = new Date();
      const ymd = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fSupplier}_${ymd}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      toast.success("ZIP 다운로드 시작");
    } finally { setZipping(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        대량 매입 공급처(센드비·오피스콘 등) 증빙을 공급처별로 모아 조회합니다. 업로드는 <strong>매입 건 상세</strong>에서, 여기선 조회·일괄다운로드만.
      </p>

      {/* 필터 + 일괄 다운로드 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
        <select value={fSupplier} onChange={(e) => setFSupplier(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5">
          <option value="">전체 공급처</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="시작" className="rounded-lg border border-border bg-background px-2 py-1.5" />
        <span className="text-muted-foreground">~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="끝" className="rounded-lg border border-border bg-background px-2 py-1.5" />
        <span className="text-muted-foreground">보관 {rows.length}건</span>
        <button onClick={downloadZip} disabled={zipping || !fSupplier || rows.length === 0}
          title={!fSupplier ? "공급처를 선택하면 일괄 다운로드됩니다" : "선택 공급처 증빙 전체를 ZIP으로"}
          className="ml-auto flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-primary hover:bg-primary/20 disabled:opacity-40">
          {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />} 공급처 일괄 ZIP
        </button>
        <button onClick={load} disabled={loading} className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 hover:bg-secondary">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 조회
        </button>
      </div>

      {/* 목록 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-3 py-2 text-left">공급처</th>
              <th className="px-3 py-2 text-left">매입일</th>
              <th className="px-3 py-2 text-right">금액</th>
              <th className="px-3 py-2 text-left">파일</th>
              <th className="px-3 py-2 text-left">메모</th>
              <th className="px-3 py-2 text-center">삭제</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/30">
                <td className="px-3 py-1.5 whitespace-nowrap">{r.supplier}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{r.doc_date ?? "-"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.amount != null ? r.amount.toLocaleString() : "-"}</td>
                <td className="px-3 py-1.5">
                  <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" title="새 탭에서 열기/다운로드">
                    <FileText className="h-3.5 w-3.5" /> {fileIcon(r.content_type)} <span className="max-w-[16rem] truncate align-middle">{r.file_name}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
                <td className="px-3 py-1.5 max-w-[16rem] truncate" title={r.memo}>{r.memo || "-"}</td>
                <td className="px-3 py-1.5 text-center">
                  <button onClick={() => remove(r.id)} title="삭제" className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">보관된 증빙이 없습니다. (매입 건 상세에서 증빙을 업로드하세요)</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
