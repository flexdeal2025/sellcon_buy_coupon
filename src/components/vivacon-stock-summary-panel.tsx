"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
const AUTH = { "x-app-passcode": PASSCODE };

// ─── 타입 ────────────────────────────────────────────────────────────────────

type TabType = "image" | "code" | "image_done" | "code_done";

const TABS: { key: TabType; label: string }[] = [
  { key: "image", label: "이미지형" },
  { key: "code", label: "코드형" },
  { key: "image_done", label: "이미지형 (판매완료)" },
  { key: "code_done", label: "코드형 (판매완료)" },
];

interface DateCount {
  date: string; // YYMMDD
  count: number;
}
interface StockItem {
  product: string;
  product_key: string;
  dates: DateCount[];
  total: number;
}
interface SummaryData {
  type: TabType;
  items: StockItem[];
  total_count: number;
  product_count: number;
  scanned_at: string;
}

// 모달 아이템 — 타입별로 필드가 다르므로 느슨하게 정의
type ModalItem = Record<string, string | number | null | undefined>;

interface ModalState {
  type: TabType;
  product: string;
  date: string; // YYMMDD
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function yymmddToDisplay(s: string): string {
  if (!/^\d{6}$/.test(s)) return s;
  return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}

function formatKST(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  } catch {
    return String(iso);
  }
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function VivaconStockSummaryPanel() {
  const [tab, setTab] = useState<TabType>("image");
  const [search, setSearch] = useState("");
  const [minCount, setMinCount] = useState("");
  const [data, setData] = useState<Record<TabType, SummaryData | null>>({
    image: null,
    code: null,
    image_done: null,
    code_done: null,
  });
  const [loading, setLoading] = useState<Record<TabType, boolean>>({
    image: true,
    code: false,
    image_done: false,
    code_done: false,
  });
  const [modal, setModal] = useState<ModalState | null>(null);
  const [modalItems, setModalItems] = useState<ModalItem[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  // 탭 전환 시 최초 1회 로드 (이미 로드된 탭은 캐시 유지)
  const loaded = useRef<Set<TabType>>(new Set());

  const load = useCallback(
    async (t: TabType, force = false) => {
      if (!force && loaded.current.has(t)) return;
      setLoading((p) => ({ ...p, [t]: true }));
      try {
        const res = await fetch(`/api/vivacon/stock-summary?type=${t}`, { headers: AUTH });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? "조회 실패");
        setData((p) => ({ ...p, [t]: json as SummaryData }));
        loaded.current.add(t);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "조회 실패");
      } finally {
        setLoading((p) => ({ ...p, [t]: false }));
      }
    },
    [],
  );

  // 초기 로드 (이미지형)
  useEffect(() => {
    void load("image");
  }, [load]);

  const handleTabChange = (t: TabType) => {
    setTab(t);
    void load(t);
  };

  const handleRefresh = () => {
    loaded.current.delete(tab);
    void load(tab, true);
  };

  // ─── 모달 열기 ──────────────────────────────────────────────────────────────

  const openModal = async (item: StockItem, dc: DateCount) => {
    const ms: ModalState = { type: tab, product: item.product, date: dc.date };
    setModal(ms);
    setModalItems([]);
    setModalLoading(true);
    try {
      const params = new URLSearchParams({
        type: ms.type,
        product: ms.product,
        date: ms.date,
      });
      const res = await fetch(`/api/vivacon/stock-detail?${params}`, { headers: AUTH });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "조회 실패");
      setModalItems((json.items ?? []) as ModalItem[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "상세 조회 실패");
      setModal(null);
    } finally {
      setModalLoading(false);
    }
  };

  // ─── 필터링 ─────────────────────────────────────────────────────────────────

  const current = data[tab];
  const minN = Number(minCount) || 0;
  const filtered = (current?.items ?? []).filter((item) => {
    if (search && !item.product.toLowerCase().includes(search.toLowerCase())) return false;
    if (minN > 0 && item.total < minN) return false;
    return true;
  });

  const isLoading = loading[tab];
  const tabCfg = TABS.find((t) => t.key === tab)!;

  // ─── 렌더 ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* 탭 바 */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {data[key] && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({data[key]!.total_count})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 검색 + 필터 + 새로고침 */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">상품명 검색</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품 폴더명으로 검색…"
            className="w-56 rounded border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">최소 재고 수량</label>
          <input
            value={minCount}
            onChange={(e) => setMinCount(e.target.value)}
            placeholder="예: 10"
            type="number"
            min={0}
            className="w-28 rounded border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          {tabCfg.label} 새로고침
        </button>
      </div>

      {/* 상태 줄 */}
      {current && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>마지막 동기화: {formatKST(current.scanned_at)}</span>
          <span>상품 수: {filtered.length}개 (전체 {current.product_count}개)</span>
        </div>
      )}

      {/* 카드 목록 */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">스캔 중…</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">재고 없음</div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.product_key}
              className="rounded border border-border bg-background p-3 shadow-sm"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-medium">{item.product}</span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  총 재고{" "}
                  <span
                    className={
                      item.total === 0
                        ? "text-muted-foreground"
                        : item.total <= 3
                          ? "font-bold text-warning"
                          : "font-bold text-success"
                    }
                  >
                    {item.total}
                  </span>
                </span>
              </div>
              {/* 날짜 칩 */}
              <div className="flex flex-wrap gap-1.5">
                {item.dates.map((dc) => (
                  <button
                    key={dc.date}
                    onClick={() => void openModal(item, dc)}
                    className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs hover:border-primary hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    {dc.date} {dc.count}장
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 모달 */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-t-xl border border-border bg-background shadow-xl sm:rounded-xl">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-xs text-muted-foreground">재고 상세</p>
                <p className="font-medium leading-tight">
                  {modal.product}
                  <span className="ml-1.5 text-sm text-muted-foreground">
                    · {modal.date}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setModal(null)}
                className="rounded p-1 hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 모달 바디 */}
            <div className="flex-1 overflow-y-auto">
              {modalLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">조회 중…</div>
              ) : modalItems.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">항목 없음</div>
              ) : modal.type === "image" ? (
                // 이미지형: 파일명 + 업로드일시 + 보기 버튼
                <ul className="divide-y divide-border/50">
                  {modalItems.map((item, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{String(item.name ?? "")}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatKST(String(item.time_created ?? ""))}
                        </p>
                      </div>
                      {item.signed_url && (
                        <a
                          href={String(item.signed_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs hover:bg-secondary"
                        >
                          <ExternalLink className="h-3 w-3" />
                          보기
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : modal.type === "code" || modal.type === "code_done" ? (
                // 코드형: 쿠폰코드 + 유효기간 + 상태
                <ul className="divide-y divide-border/50">
                  {modalItems.map((item, i) => (
                    <li key={i} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm">{String(item.coupon_code ?? "—")}</span>
                        <span className="text-xs text-muted-foreground">{String(item.status ?? "")}</span>
                      </div>
                      <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
                        <span>유효기간 {String(item.expiry_date ?? "—")}</span>
                        {item.옵션명 && <span>옵션 {String(item.옵션명)}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                // 이미지형 발행이력: 등록 정보
                <ul className="divide-y divide-border/50">
                  {modalItems.map((item, i) => (
                    <li key={i} className="px-4 py-3">
                      <p className="truncate text-sm font-medium">
                        {String(item.published_ref ?? item.product_name ?? "—")}
                      </p>
                      <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
                        <span>유효기간 {String(item.expiry_date ?? "—")}</span>
                        {item.option_name && <span>옵션 {String(item.option_name)}</span>}
                        <span>등록 {formatKST(String(item.created_at ?? ""))}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 모달 푸터 */}
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              총 {modalItems.length}건
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
