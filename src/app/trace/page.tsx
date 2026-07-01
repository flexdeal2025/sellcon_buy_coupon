"use client";

import { useState } from "react";
import { CouponTracePanel } from "@/components/coupon-trace-panel";
import { LineageAuditPanel } from "@/components/lineage-audit-panel";

type Tab = "trace" | "audit";
const TABS: { key: Tab; label: string }[] = [
  { key: "trace", label: "쿠폰 추적" },
  { key: "audit", label: "무결성 대시보드" },
];

export default function TracePage() {
  const [tab, setTab] = useState<Tab>("trace");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">이력 조회</h1>
        <p className="text-sm text-muted-foreground">
          {tab === "trace"
            ? "쿠폰번호(또는 주문번호) 하나로 매입처·매입원가·증빙부터 발송까지 전 과정을 추적합니다."
            : "기간별 매입 건의 증빙→발행→판매→발송 사슬을 점검해 누락을 찾습니다."}
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "trace" && <CouponTracePanel />}
      {tab === "audit" && <LineageAuditPanel />}
    </div>
  );
}
