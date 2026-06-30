"use client";

import { useState } from "react";
import { VivaconInventoryPanel } from "@/components/vivacon-inventory-panel";
import { VivaconStockSummaryPanel } from "@/components/vivacon-stock-summary-panel";
import { SmartstoreStockPlanPanel } from "@/components/smartstore-stock-plan-panel";

type Tab = "overview" | "detail" | "ss-sync";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "재고 현황" },
  { key: "detail", label: "코드 재고 상세" },
  { key: "ss-sync", label: "스마트스토어 동기화" },
];

export default function VivaconPage() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">쿠폰재고 (비바콘)</h1>
        <p className="text-sm text-muted-foreground">
          이미지형(GCP pending) + 코드형(비바콘 DB) 재고를 통합 조회합니다.
        </p>
      </div>

      {/* 탭 바 */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <VivaconStockSummaryPanel />}
      {tab === "detail" && <VivaconInventoryPanel />}
      {tab === "ss-sync" && <SmartstoreStockPlanPanel />}
    </div>
  );
}
