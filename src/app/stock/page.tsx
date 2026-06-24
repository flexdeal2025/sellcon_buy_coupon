"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { VivaconStockPanel } from "@/components/vivacon-stock-panel";
import { StockHistoryPanel } from "@/components/stock-history-panel";
import { Upload, History } from "lucide-react";

type Tab = "register" | "history";

export default function StockPage() {
  const [tab, setTab] = useState<Tab>("register");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">재고 등록 (OCR)</h1>
        <p className="text-sm text-muted-foreground">
          기프티콘 이미지를 올리면 OCR로 코드를 읽고, 검수·수정 후 코드형/이미지형으로 발행합니다.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex rounded-xl bg-secondary p-1">
        {([["register", "재고 등록", Upload], ["history", "재고 이력", History]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors",
              tab === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "register" ? <VivaconStockPanel /> : <StockHistoryPanel />}
    </div>
  );
}
