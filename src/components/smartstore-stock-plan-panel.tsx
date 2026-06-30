"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RefreshCw, Loader2, ArrowUp, ArrowDown, Minus, HelpCircle } from "lucide-react";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
const AUTH = { "x-app-passcode": PASSCODE };

type Action = "increase" | "decrease" | "same" | "no-match";
interface PlanRow {
  name: string; channel_product_no: number;
  smartstore: number; realCode: number; realImage: number; real: number;
  diff: number; matched: boolean; action: Action;
}
interface PlanResp {
  ok: boolean; error?: string;
  summary: { total: number; increase: number; decrease: number; same: number; noMatch: number };
  plan: PlanRow[]; scanned_at: string;
}

const ACTION_META: Record<Action, { label: string; cls: string; icon: typeof ArrowUp }> = {
  increase: { label: "올림", cls: "text-green-600 dark:text-green-400", icon: ArrowUp },
  decrease: { label: "내림", cls: "text-red-600 dark:text-red-400", icon: ArrowDown },
  same: { label: "동일", cls: "text-muted-foreground", icon: Minus },
  "no-match": { label: "매칭없음", cls: "text-amber-600 dark:text-amber-500", icon: HelpCircle },
};

export function SmartstoreStockPlanPanel() {
  const [data, setData] = useState<PlanResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"changes" | "all" | "no-match">("changes");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/smartstore/stock-plan", { headers: AUTH, cache: "no-store" });
      const json = await res.json();
      if (!json.ok) { toast.error("미리보기 실패: " + json.error); return; }
      setData(json as PlanResp);
    } catch (e) {
      toast.error("조회 오류: " + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = (data?.plan ?? []).filter((r) =>
    filter === "all" ? true : filter === "no-match" ? r.action === "no-match" : r.action === "increase" || r.action === "decrease",
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-300/60 bg-amber-50/50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
        <strong>미리보기(dry-run)</strong> — 실제 스마트스토어에는 아직 쓰지 않습니다. 진짜 재고(코드형 <code>coupon_codes</code> + 이미지형 <code>GCP</code>)와
        현재 스마트스토어 재고를 비교만 합니다. 숫자 검수 후 다음 단계(PC에서 실제 반영)로 진행합니다.
      </div>

      {/* 요약 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
        {data && (
          <>
            <span>대상 <strong>{data.summary.total}</strong></span>
            <span className="text-green-600">올림 <strong>{data.summary.increase}</strong></span>
            <span className="text-red-600">내림 <strong>{data.summary.decrease}</strong></span>
            <span className="text-muted-foreground">동일 <strong>{data.summary.same}</strong></span>
            <span className="text-amber-600">매칭없음 <strong>{data.summary.noMatch}</strong></span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg bg-secondary p-0.5 text-xs">
            {([["changes", "변경분"], ["no-match", "매칭없음"], ["all", "전체"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={cn("rounded-md px-2 py-1 font-medium", filter === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm hover:bg-secondary disabled:opacity-50">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 새로고침
          </button>
        </div>
      </div>

      {data && data.summary.noMatch > 0 && filter !== "no-match" && (
        <p className="text-xs text-muted-foreground">
          ※ <strong className="text-amber-600">매칭없음 {data.summary.noMatch}건</strong>은 상품명이 우리 재고와 매칭되지 않은 건 — 실제 반영 시 <strong>건너뜁니다</strong>(0으로 덮어쓰지 않음). 상품명 표기를 맞추면 매칭됩니다.
        </p>
      )}

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-3 py-2 text-left">상품명</th>
              <th className="px-2 py-2 text-right">현재(SS)</th>
              <th className="px-2 py-2 text-right">실재고</th>
              <th className="px-2 py-2 text-right" title="코드형 / 이미지형">코드/이미지</th>
              <th className="px-2 py-2 text-right">차이</th>
              <th className="px-2 py-2 text-center">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = ACTION_META[r.action];
              return (
                <tr key={r.channel_product_no} className="border-b border-border/50 hover:bg-secondary/30">
                  <td className="px-3 py-1.5 max-w-xs truncate" title={r.name}>{r.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.smartstore}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{r.matched ? r.real : "-"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{r.matched ? `${r.realCode}/${r.realImage}` : "-"}</td>
                  <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums", r.diff > 0 ? "text-green-600" : r.diff < 0 ? "text-red-600" : "text-muted-foreground")}>
                    {r.matched ? (r.diff > 0 ? `+${r.diff}` : r.diff) : "-"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", m.cls)}>
                      <m.icon className="h-3 w-3" /> {m.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">표시할 항목이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && <p className="text-xs text-muted-foreground">스캔: {new Date(data.scanned_at).toLocaleString("ko-KR")}</p>}
    </div>
  );
}
