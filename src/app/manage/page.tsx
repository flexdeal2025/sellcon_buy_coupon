"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { TaxPanel } from "@/components/tax-panel";
import { SmartstorePanel } from "@/components/smartstore-panel";
import { PnLPanel } from "@/components/pnl-panel";
import { CardTaxPanel } from "@/components/card-tax-panel";
import { PurchaseReconcilePanel } from "@/components/purchase-reconcile-panel";
import { EvidenceReportPanel } from "@/components/evidence-report-panel";
import { FileSpreadsheet, BarChart2, Wallet, CreditCard, PackageSearch, ShieldCheck } from "lucide-react";

type Tab = "pnl" | "ai" | "cardtax" | "reconcile" | "evidence" | "tax";

const TABS: { key: Tab; label: string; icon: typeof Wallet }[] = [
  { key: "pnl",       label: "손익",     icon: Wallet },
  { key: "ai",        label: "AI분석",   icon: BarChart2 },
  { key: "cardtax",   label: "카드장부",  icon: CreditCard },
  { key: "reconcile", label: "매입대조",  icon: PackageSearch },
  { key: "evidence",  label: "증빙비중",  icon: ShieldCheck },
  { key: "tax",       label: "세무",     icon: FileSpreadsheet },
];

export default function ManagePage() {
  const [tab, setTab] = useState<Tab>("pnl");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">정산 · 세무</h1>

      {/* 탭 */}
      <div className="flex rounded-xl bg-secondary p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium transition-colors whitespace-nowrap px-2",
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pnl"       && <PnLPanel />}
      {tab === "ai"        && <SmartstorePanel />}
      {tab === "cardtax"   && <CardTaxPanel />}
      {tab === "reconcile" && <PurchaseReconcilePanel />}
      {tab === "evidence"  && <EvidenceReportPanel />}
      {tab === "tax"       && <TaxPanel />}
    </div>
  );
}
