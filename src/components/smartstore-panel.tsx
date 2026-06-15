"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatKRW } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  Sparkles,
  Package,
  TrendingUp,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Clock,
} from "lucide-react";

interface Product {
  channel_product_no: number;
  name: string;
  sale_price: number;
  stock_quantity: number;
  status: string;
  low_stock_threshold: number;
  synced_at: string;
}

interface SalesStat {
  channel_product_no: number;
  qty7d: number;
  qty30d: number;
  rev30d: number;
}

interface AIReport {
  id: string;
  report_date: string;
  report_text: string;
  created_at: string;
}

export function SmartstorePanel() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Map<number, SalesStat>>(new Map());
  const [latestReport, setLatestReport] = useState<AIReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);

  const fetchData = useCallback(async () => {
    const supabase = getSupabaseClient();

    // 상품 재고
    const { data: prods } = await supabase
      .from("smartstore_products")
      .select("*")
      .order("stock_quantity", { ascending: true });

    // 7일 / 30일 집계
    const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
    const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
    const { data: sales } = await supabase
      .from("smartstore_daily_sales")
      .select("channel_product_no, sale_date, total_quantity, total_revenue")
      .gte("sale_date", thirtyAgo);

    const m = new Map<number, SalesStat>();
    for (const s of sales ?? []) {
      const cur = m.get(s.channel_product_no) ?? { channel_product_no: s.channel_product_no, qty7d: 0, qty30d: 0, rev30d: 0 };
      cur.qty30d += s.total_quantity;
      cur.rev30d += s.total_revenue;
      if (s.sale_date >= sevenAgo) cur.qty7d += s.total_quantity;
      m.set(s.channel_product_no, cur);
    }

    // 최신 AI 리포트
    const { data: reports } = await supabase
      .from("ai_analysis_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    setProducts(prods ?? []);
    setStats(m);
    setLatestReport(reports?.[0] ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/smartstore/sync");
      const data = (await res.json()) as { ok: boolean; error?: string; synced?: { products: number; lowStock: number } };
      if (!data.ok) throw new Error(data.error ?? "동기화 실패");
      toast.success(`동기화 완료 — 상품 ${data.synced?.products}개, 재고임박 ${data.synced?.lowStock}건`);
      await fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "동기화 오류");
    } finally {
      setSyncing(false);
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/smartstore/analyze");
      const data = (await res.json()) as { ok: boolean; error?: string; report?: string };
      if (!data.ok) throw new Error(data.error ?? "분석 실패");
      toast.success("AI 분석 완료 — 텔레그램으로도 발송되었습니다");
      await fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "분석 오류");
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const syncedAt = products[0]?.synced_at
    ? new Date(products[0].synced_at).toLocaleString("ko-KR")
    : null;

  const displayProducts = showAllProducts ? products : products.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* 액션 버튼 */}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={handleSync} disabled={syncing} variant="outline">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          재고 동기화
        </Button>
        <Button onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          AI 분석 실행
        </Button>
      </div>

      {syncedAt && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          마지막 동기화: {syncedAt}
        </p>
      )}

      {/* 상품 재고 현황 */}
      {products.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            데이터 없음 — 먼저 <strong>재고 동기화</strong>를 실행하세요.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" />
              상품 재고 현황
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {displayProducts.map((p) => {
              const st = stats.get(p.channel_product_no);
              const dailyAvg = st ? st.qty7d / 7 : 0;
              const daysLeft = dailyAvg > 0 ? Math.round((p.stock_quantity / dailyAvg) * 10) / 10 : null;
              const isLow = p.stock_quantity <= (p.low_stock_threshold ?? 10);
              const isOut = p.stock_quantity === 0;

              return (
                <div
                  key={p.channel_product_no}
                  className={cn(
                    "rounded-lg border p-3",
                    isOut ? "border-destructive/40 bg-destructive/5"
                      : isLow ? "border-warning/40 bg-warning/5"
                      : "border-border bg-secondary",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight">{p.name}</p>
                    {isOut ? (
                      <Badge variant="destructive" className="shrink-0 text-[10px]">품절</Badge>
                    ) : isLow ? (
                      <Badge variant="outline" className="shrink-0 border-warning/60 text-[10px] text-warning">재고임박</Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>재고 <strong className={cn(isLow ? "text-warning" : "text-foreground")}>{p.stock_quantity}개</strong></span>
                    {st && <span>7일 판매 <strong className="text-foreground">{st.qty7d}개</strong></span>}
                    {st && <span>30일 매출 <strong className="text-foreground">{formatKRW(st.rev30d)}</strong></span>}
                    {daysLeft !== null && (
                      <span className={cn(daysLeft <= 3 ? "text-destructive font-semibold" : "")}>
                        예상 소진 <strong>{daysLeft}일</strong>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {products.length > 5 && (
              <button
                onClick={() => setShowAllProducts(!showAllProducts)}
                className="flex w-full items-center justify-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showAllProducts ? (
                  <><ChevronUp className="h-3 w-3" /> 접기</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> {products.length - 5}개 더 보기</>
                )}
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 판매 TOP 3 */}
      {stats.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              7일 판매 TOP 3
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...stats.entries()]
              .sort((a, b) => b[1].qty7d - a[1].qty7d)
              .slice(0, 3)
              .map(([no, st], i) => {
                const p = products.find((x) => x.channel_product_no === no);
                return (
                  <div key={no} className="flex items-center gap-3 rounded-lg border border-border bg-secondary px-3 py-2">
                    <span className="text-lg font-bold text-muted-foreground">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p?.name ?? `상품 ${no}`}</p>
                      <p className="text-xs text-muted-foreground">{st.qty7d}개 / 7일</p>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-primary">{formatKRW(st.rev30d)}</span>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {/* AI 분석 리포트 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            AI 매입 전략 리포트
            {latestReport && (
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {new Date(latestReport.created_at).toLocaleDateString("ko-KR")}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {latestReport ? (
            <div className="whitespace-pre-wrap rounded-lg bg-secondary p-3 text-sm leading-relaxed">
              {latestReport.report_text}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-5 w-5" />
              <p>아직 AI 분석 리포트가 없습니다.</p>
              <p className="mt-1 text-xs">
  Vercel에 GEMINI_API_KEY 등록 후 사용 가능합니다. (무료)
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
