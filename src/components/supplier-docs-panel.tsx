"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Upload, Loader2, RefreshCw, Trash2, ExternalLink, FileText } from "lucide-react";

const AUTH = { "x-app-passcode": process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234" };

interface Doc {
  id: string; supplier: string; doc_date: string | null; amount: number | null;
  memo: string; file_name: string; content_type: string; url: string; created_at: string;
}

const fileIcon = (ct: string) => (ct.includes("pdf") ? "📄" : ct.startsWith("image/") ? "🖼️" : ct.includes("sheet") || ct.includes("excel") ? "📊" : "📎");

export function SupplierDocsPanel() {
  const [vendors, setVendors] = useState<string[]>([]);
  // 업로드 폼
  const [supplier, setSupplier] = useState("");
  const [docDate, setDocDate] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [uploading, setUploading] = useState(false);
  // 필터/목록
  const [fSupplier, setFSupplier] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);

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

  async function handleUpload(file: File | null | undefined) {
    if (!file) return;
    if (!supplier.trim()) { toast.error("공급처를 입력하세요"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("supplier", supplier.trim());
      if (docDate) fd.append("doc_date", docDate);
      if (amount) fd.append("amount", amount);
      if (memo) fd.append("memo", memo.trim());
      const res = await fetch("/api/supplier-docs/upload", { method: "POST", headers: AUTH, body: fd });
      const json = await res.json();
      if (!json.ok) { toast.error("업로드 실패: " + json.error); return; }
      toast.success("증빙 보관 완료");
      setMemo(""); setAmount("");
      await load();
    } catch (e) {
      toast.error("업로드 오류: " + (e instanceof Error ? e.message : ""));
    } finally { setUploading(false); }
  }

  async function remove(id: string) {
    if (!confirm("이 증빙을 삭제합니다(파일 포함). 계속할까요?")) return;
    const res = await fetch(`/api/supplier-docs?id=${id}`, { method: "DELETE", headers: AUTH });
    const json = await res.json();
    if (!json.ok) { toast.error("삭제 실패: " + json.error); return; }
    await load();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        대량 매입 공급처(센드비·오피스콘 등)의 거래내역서·세금계산서 등을 미리 올려 두고 나중에 조회합니다. (이미지·PDF·엑셀 · GCS 안전 보관)
      </p>

      {/* 업로드 */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-secondary/40 p-3">
        <label className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">공급처</span>
          <input list="supdoc-vendors" value={supplier} onChange={(e) => setSupplier(e.target.value)}
            placeholder="예: 센드비" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
          <datalist id="supdoc-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
        </label>
        <label className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">매입일</span>
          <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">금액(선택)</span>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="w-28 rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums" /></label>
        <label className="flex-1 text-sm"><span className="mb-1 block text-xs text-muted-foreground">메모(선택)</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 1월 세금계산서" className="w-full min-w-[160px] rounded-lg border border-border bg-background px-2 py-1.5 text-sm" /></label>
        <label className={cn("flex cursor-pointer items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground", uploading && "pointer-events-none opacity-50")}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} 업로드
          <input type="file" accept="image/*,.pdf,.xlsx,.xls" className="hidden" disabled={uploading}
            onChange={(e) => { handleUpload(e.target.files?.[0]); e.currentTarget.value = ""; }} />
        </label>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/30 p-3 text-sm">
        <select value={fSupplier} onChange={(e) => setFSupplier(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5">
          <option value="">전체 공급처</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="시작" className="rounded-lg border border-border bg-background px-2 py-1.5" />
        <span className="text-muted-foreground">~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="끝" className="rounded-lg border border-border bg-background px-2 py-1.5" />
        <span className="text-muted-foreground">보관 {rows.length}건</span>
        <button onClick={load} disabled={loading} className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 hover:bg-secondary">
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
              <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">보관된 증빙이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
