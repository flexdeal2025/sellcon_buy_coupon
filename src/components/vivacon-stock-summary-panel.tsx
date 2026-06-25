"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";

interface StockItem {
  product: string;
  product_key: string;
  image_count: number;
  image_dates: string[];
  code_count: number;
  code_earliest_expiry: string | null;
  total: number;
}

interface SummaryData {
  items: StockItem[];
  image_total: number;
  code_total: number;
  scanned_at: string;
}

/** YYMMDD → "2026-08-31" */
function yymmddToDisplay(s: string): string {
  if (!/^\d{6}$/.test(s)) return s;
  return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}

function countClass(n: number): string {
  if (n === 0) return "text-muted-foreground";
  if (n <= 3) return "text-warning font-semibold";
  return "text-success font-semibold";
}

export function VivaconStockSummaryPanel() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/vivacon/stock-summary", {
        headers: { "x-app-passcode": PASSCODE },
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "조회 실패");
      setData(json as SummaryData);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "조회 실패";
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const imageTotal = data?.image_total ?? 0;
  const codeTotal = data?.code_total ?? 0;

  return (
    <div className="space-y-4">
      {/* 요약 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-6">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">이미지형</p>
            <p className="text-2xl font-bold tabular-nums">
              {loading ? "—" : imageTotal}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">코드형</p>
            <p className="text-2xl font-bold tabular-nums">
              {loading ? "—" : codeTotal}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">합계</p>
            <p className="text-2xl font-bold tabular-nums">
              {loading ? "—" : imageTotal + codeTotal}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </button>
          {data?.scanned_at && (
            <p className="text-xs text-muted-foreground">
              {new Date(data.scanned_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준
            </p>
          )}
        </div>
      </div>

      {err && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {/* 상품별 재고 테이블 */}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-left font-medium">상품명</th>
              <th className="px-3 py-2 text-right font-medium">이미지</th>
              <th className="px-3 py-2 text-right font-medium">코드</th>
              <th className="px-3 py-2 text-right font-medium">합계</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                이미지 유효기간
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                코드 최근만료
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  스캔 중…
                </td>
              </tr>
            ) : !err && (data?.items?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  재고 없음
                </td>
              </tr>
            ) : (
              (data?.items ?? []).map((item) => (
                <tr
                  key={item.product_key}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/20"
                >
                  <td className="px-3 py-2 font-medium">{item.product}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${countClass(item.image_count)}`}>
                    {item.image_count}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${countClass(item.code_count)}`}>
                    {item.code_count}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${countClass(item.total)}`}>
                    {item.total}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {item.image_dates.length > 0
                      ? item.image_dates.map(yymmddToDisplay).join(", ")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {item.code_earliest_expiry ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
