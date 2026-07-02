"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn, formatKRW } from "@/lib/utils";
import { Loader2, Search } from "lucide-react";

const AUTH = { "x-app-passcode": process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234" };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Row {
  product_order_id: string; product_name: string; decision_date: string; quantity: number;
  settle_amount: number; current_cost: number | null; current_source: string;
  auto_cost: number | null; auto_coupons: number; auto_known: number;
  traceable: boolean; cost_known: boolean; diff: number | null;
}
interface Resp {
  ok: boolean; error?: string;
  summary: { total: number; traceable: number; autoCostKnown: number; settleSum: number; autoCostSum: number; autoProfitSum: number; currentCostSumOnAuto: number };
  rows: Row[];
}

export function CostPreviewPanel() {
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 60 * 86400_000)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [filter, setFilter] = useState<"all" | "known" | "untraceable" | "diff">("known");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ from, to, limit: "1000" });
      const res = await fetch(`/api/pnl/cost-preview?${p}`, { headers: AUTH, cache: "no-store" });
      const json = await res.json();
      if (!json.ok) { toast.error("조회 실패: " + json.error); return; }
      setData(json as Resp);
    } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const rows = (data?.rows ?? []).filter((r) =>
    filter === "known" ? r.cost_known
      : filter === "untraceable" ? !r.traceable
      : filter === "diff" ? (r.cost_known && r.current_cost != null && Math.abs(r.diff ?? 0) > 0)
      : true,
  );
  const s = data?.summary;
  const settleOnAuto = data ? sumSettleOnAuto(data) : 0;
  const autoMargin = s && settleOnAuto > 0 ? (s.autoProfitSum / settleOnAuto) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-300/60 bg-amber-50/50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
        <strong>실원가 검증(dry-run)</strong> — 발송된 실제 쿠폰의 매입원가를 추적해 현재 반영원가와 비교만 합니다(쓰기 없음).
        발송로그는 2026-04부터라 이전 건은 미추적으로 나올 수 있습니다.
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5" />
        <span className="text-muted-foreground">~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5" />
        <div className="flex rounded-lg bg-secondary p-0.5 text-xs">
          {([["known", "실원가확보"], ["diff", "차이있음"], ["untraceable", "미추적"], ["all", "전체"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={cn("rounded-md px-2 py-1 font-medium", filter === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>{label}</button>
          ))}
        </div>
        <button onClick={load} disabled={loading} className="ml-auto flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} 조회
        </button>
      </div>

      {/* 요약 */}
      {s && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-background px-3 py-2 text-sm">
            <span>구매확정 <strong>{s.total}</strong></span>
            <span className="text-blue-600">발송추적 <strong>{s.traceable}</strong></span>
            <span className="text-green-600">실원가확보 <strong>{s.autoCostKnown}</strong></span>
            <span className="ml-auto text-xs text-muted-foreground">추적률 {s.total ? Math.round((s.autoCostKnown / s.total) * 100) : 0}%</span>
          </div>
          {s.autoCostKnown > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="매출(실원가확보분)" v={formatKRW(sumSettleOnAuto(data!))} />
              <Mini label="실원가 합" v={formatKRW(s.autoCostSum)} />
              <Mini label="실수익(매출-실원가)" v={formatKRW(s.autoProfitSum)} accent />
              <Mini label="현재원가 합(동일건)" v={formatKRW(s.currentCostSumOnAuto)} />
            </div>
          )}
          {s.autoCostKnown > 0 && (
            <p className="text-xs text-muted-foreground">
              ※ 같은 건 기준 <strong>현재원가 {formatKRW(s.currentCostSumOnAuto)}</strong> vs <strong>실원가 {formatKRW(s.autoCostSum)}</strong>
              {" "}(차이 {formatKRW(s.currentCostSumOnAuto - s.autoCostSum)}). 실수익률 약 {autoMargin.toFixed(1)}%
            </p>
          )}
        </div>
      )}

      {/* 표 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-2 py-2 text-left">확정일</th>
              <th className="px-2 py-2 text-left">상품명</th>
              <th className="px-2 py-2 text-right">매출(정산)</th>
              <th className="px-2 py-2 text-right">현재원가</th>
              <th className="px-2 py-2 text-right">실원가</th>
              <th className="px-2 py-2 text-right">차이</th>
              <th className="px-2 py-2 text-center">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product_order_id} className="border-b border-border/50 hover:bg-secondary/30">
                <td className="px-2 py-1.5 whitespace-nowrap">{r.decision_date?.slice(5)}</td>
                <td className="px-2 py-1.5 max-w-[16rem] truncate" title={r.product_name}>{r.product_name}{r.quantity > 1 ? ` ×${r.quantity}` : ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatKRW(r.settle_amount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                  {r.current_cost != null ? formatKRW(r.current_cost) : "-"}
                  <span className="ml-1 text-[10px]">{r.current_source === "order" ? "건별" : r.current_source === "product" ? "평균" : ""}</span>
                </td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{r.auto_cost != null ? formatKRW(r.auto_cost) : "-"}</td>
                <td className={cn("px-2 py-1.5 text-right tabular-nums", r.diff != null && r.diff !== 0 ? (r.diff > 0 ? "text-red-600" : "text-green-600") : "text-muted-foreground")}>
                  {r.diff != null ? (r.diff > 0 ? `+${formatKRW(r.diff)}` : formatKRW(r.diff)) : "-"}
                </td>
                <td className="px-2 py-1.5 text-center text-xs">
                  {r.cost_known ? <span className="text-green-600">실원가</span>
                    : r.traceable ? <span className="text-amber-600" title={`발송쿠폰 ${r.auto_coupons}개 중 원가확보 ${r.auto_known}개`}>원가일부</span>
                    : <span className="text-muted-foreground">미추적</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">해당 조건 데이터가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">차이 = 현재원가 − 실원가. (+빨강: 현재원가가 과대계상 → 실제 수익은 더 큼 / −초록: 현재원가 과소)</p>
    </div>
  );
}

function sumSettleOnAuto(d: Resp): number {
  return d.rows.filter((r) => r.cost_known).reduce((s, r) => s + r.settle_amount, 0);
}

function Mini({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-bold tabular-nums", accent && "text-success")}>{v}</p>
    </div>
  );
}
