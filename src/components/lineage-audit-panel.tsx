"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSupabaseClient } from "@/lib/supabase/client";
import { RefreshCw, Loader2, Search } from "lucide-react";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
const AUTH = { "x-app-passcode": PASSCODE };

type Status = "complete" | "proof-missing" | "unpublished" | "dispatch-issue";
interface Row {
  id: string; date: string; product_name: string; supplier: string; coupon_code: string;
  stored_as_code: boolean; proof: "linked" | "system" | "missing"; published: boolean;
  sold: boolean; sent: boolean; failed: boolean; status: Status;
}
interface Resp {
  ok: boolean; error?: string;
  summary: { total: number; complete: number; proofMissing: number; unpublished: number; dispatchIssue: number };
  rows: Row[]; from: string; to: string;
}

const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function LineageAuditPanel() {
  const [to, setTo] = useState(() => localYmd(new Date()));
  const [from, setFrom] = useState(() => localYmd(new Date(Date.now() - 6 * 86400_000)));
  const [supplier, setSupplier] = useState("");
  const [vendors, setVendors] = useState<string[]>([]);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
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
      const p = new URLSearchParams({ from, to });
      if (supplier) p.set("supplier", supplier);
      const res = await fetch(`/api/lineage/audit?${p}`, { headers: AUTH, cache: "no-store" });
      const json = await res.json();
      if (!json.ok) { toast.error("조회 실패: " + json.error); return; }
      setData(json as Resp);
    } catch (e) {
      toast.error("오류: " + (e instanceof Error ? e.message : ""));
    } finally { setLoading(false); }
  }, [from, to, supplier]);
  useEffect(() => { load(); }, [load]);

  const rows = (data?.rows ?? []).filter((r) => (onlyIssues ? r.status !== "complete" : true));

  return (
    <div className="space-y-3">
      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5" title="매입일 시작" />
        <span className="text-muted-foreground">~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5" title="매입일 끝" />
        <div className="flex gap-1">
          {[["", "7일"], ["1", "어제"], ["0", "오늘"]].map(([k, label]) => (
            <button key={label} onClick={() => {
              const base = new Date();
              if (k === "0") { setFrom(localYmd(base)); setTo(localYmd(base)); }
              else if (k === "1") { const y = new Date(Date.now() - 86400_000); setFrom(localYmd(y)); setTo(localYmd(y)); }
              else { setTo(localYmd(base)); setFrom(localYmd(new Date(Date.now() - 6 * 86400_000))); }
            }} className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary">{label}</button>
          ))}
        </div>
        <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5">
          <option value="">전체 매입처</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> 누락만
        </label>
        <button onClick={load} disabled={loading} className="ml-auto flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} 조회
        </button>
      </div>

      {/* 요약 */}
      {data && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
          <span>대상 <strong>{data.summary.total}</strong></span>
          <span className="text-green-600">정상 <strong>{data.summary.complete}</strong></span>
          <span className="text-red-600">증빙누락 <strong>{data.summary.proofMissing}</strong></span>
          <span className="text-amber-600">미발행 <strong>{data.summary.unpublished}</strong></span>
          <span className="text-red-600">발송이상 <strong>{data.summary.dispatchIssue}</strong></span>
          <span className="ml-auto text-xs text-muted-foreground">{data.from} ~ {data.to}</span>
        </div>
      )}

      {/* 표 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-2 py-2 text-left">매입일</th>
              <th className="px-2 py-2 text-left">상품명</th>
              <th className="px-2 py-2 text-left">매입처</th>
              <th className="px-2 py-2 text-left">쿠폰번호</th>
              <th className="px-2 py-2 text-center">①증빙</th>
              <th className="px-2 py-2 text-center">②발행</th>
              <th className="px-2 py-2 text-center">③판매</th>
              <th className="px-2 py-2 text-center">④발송</th>
              <th className="px-2 py-2 text-left">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-border/50",
                r.status === "dispatch-issue" || r.status === "proof-missing" ? "bg-red-50/40 dark:bg-red-950/10"
                  : r.status === "unpublished" ? "bg-amber-50/30 dark:bg-amber-950/10" : "hover:bg-secondary/30")}>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.date?.slice(5)}</td>
                <td className="px-2 py-1.5 max-w-[16rem] truncate" title={r.product_name}>{r.product_name}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{r.supplier || "-"}</td>
                <td className="px-2 py-1.5 font-mono text-xs truncate max-w-[7rem]" title={r.coupon_code}>{r.coupon_code || "-"}</td>
                <td className="px-2 py-1.5 text-center">{r.proof === "linked" ? "✅" : r.proof === "system" ? <span title="셀콘 시스템증빙">🔵</span> : <span className="text-red-600 font-bold">❌</span>}</td>
                <td className="px-2 py-1.5 text-center">{r.published ? "✅" : <span className="text-amber-600">⬜</span>}</td>
                <td className="px-2 py-1.5 text-center">{r.sold ? "✅" : <span className="text-muted-foreground" title="미판매(재고)">⬜</span>}</td>
                <td className="px-2 py-1.5 text-center">{!r.sold ? <span className="text-muted-foreground">–</span> : r.sent ? "✅" : <span className="text-red-600 font-bold" title={r.failed ? "발송실패" : "미발송"}>⚠️</span>}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {r.status === "complete" ? <span className="text-green-600">정상</span>
                    : r.status === "proof-missing" ? <span className="font-medium text-red-600">증빙누락</span>
                    : r.status === "unpublished" ? <span className="text-amber-600">미발행</span>
                    : <span className="font-medium text-red-600">발송이상</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">{onlyIssues ? "누락 건이 없습니다 (모두 정상)." : "해당 기간 매입 건이 없습니다."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">※ 미판매(③⬜)는 정상(아직 안 팔린 재고). 빨강(증빙누락·발송이상)만 조치 대상. 읽기 전용.</p>
    </div>
  );
}
