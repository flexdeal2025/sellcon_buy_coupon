"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

interface Report {
  count: number;
  total: number;
  noEvi: number;
  months: { ym: string; total: number; no: number }[];
  suppliers: { supplier: string; total: number; no: number }[];
}

const won = (n: number) => Math.round(n).toLocaleString() + "원";
const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : "0.0") + "%";

export function EvidenceReportPanel() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await fetch("/api/purchase/evidence-report");
      const json = await res.json();
      if (!json.ok) { setErr(json.error || "조회 실패"); return; }
      setData(json);
    } catch {
      setErr("조회 중 오류");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">매입(purchase_records) 중 <strong>적격증빙 없는(증빙유형 공란)</strong> 비중 — 세무 소명 방어 지표.</p>
        <button onClick={load} className="ml-auto rounded-lg border border-border bg-background px-2 py-1.5 text-sm hover:bg-secondary">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {loading && <p className="py-8 text-center text-sm text-muted-foreground">집계 중...</p>}
      {err && <p className="py-8 text-center text-sm text-destructive">{err}</p>}

      {data && !loading && (
        <>
          {/* 전체 요약 */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="총 매입액" value={won(data.total)} />
            <Stat label="무증빙 매입액" value={won(data.noEvi)} danger={data.noEvi > 0} />
            <Stat label="무증빙 비중" value={pct(data.noEvi, data.total)} danger={data.noEvi > 0} />
          </div>

          {/* 월별 */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/60">
                <tr>
                  <th className="px-3 py-2 text-left text-xs">월</th>
                  <th className="px-3 py-2 text-right text-xs">총 매입액</th>
                  <th className="px-3 py-2 text-right text-xs">무증빙</th>
                  <th className="px-3 py-2 text-right text-xs">무증빙 비중</th>
                </tr>
              </thead>
              <tbody>
                {data.months.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground text-sm">매입 데이터 없음</td></tr>}
                {data.months.map((m) => (
                  <tr key={m.ym} className="border-b border-border/50">
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap">{m.ym}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums">{won(m.total)}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums">{won(m.no)}</td>
                    <td className={cn("px-3 py-1.5 text-right text-xs tabular-nums font-medium", m.no > 0 ? "text-amber-600" : "text-muted-foreground")}>{pct(m.no, m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 매입처별 (무증빙 상위) */}
          {data.suppliers.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">매입처별 무증빙액 상위</p>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/60">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs">매입처</th>
                      <th className="px-3 py-2 text-right text-xs">무증빙액</th>
                      <th className="px-3 py-2 text-right text-xs">무증빙 비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.suppliers.map((s) => (
                      <tr key={s.supplier} className="border-b border-border/50">
                        <td className="px-3 py-1.5 text-xs">{s.supplier}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-amber-600">{won(s.no)}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums">{pct(s.no, s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">매입 {data.count.toLocaleString()}건 기준. 증빙유형은 매입 등록/수정 시 입력됩니다.</p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-bold tabular-nums", danger && "text-amber-600")}>{value}</p>
    </div>
  );
}
