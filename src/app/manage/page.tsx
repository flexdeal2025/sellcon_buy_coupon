"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PhoneLinesPanel } from "@/components/phone-lines-panel";
import { TaxPanel } from "@/components/tax-panel";
import { PresetsPanel } from "@/components/presets-panel";
import { SmartstorePanel } from "@/components/smartstore-panel";
import { PnLPanel } from "@/components/pnl-panel";
import { CardTaxPanel } from "@/components/card-tax-panel";
import { PurchaseReconcilePanel } from "@/components/purchase-reconcile-panel";
import { SupplierAccountsPanel } from "@/components/supplier-accounts-panel";
import { Phone, FileSpreadsheet, Star, BarChart2, Wallet, CreditCard, PackageSearch, KeyRound } from "lucide-react";

type Tab = "lines" | "tax" | "presets" | "ai" | "pnl" | "cardtax" | "reconcile" | "accounts";

const TABS: { key: Tab; label: string; icon: typeof Phone }[] = [
  { key: "pnl",       label: "손익",     icon: Wallet },
  { key: "ai",        label: "AI분석",   icon: BarChart2 },
  { key: "cardtax",   label: "카드장부",  icon: CreditCard },
  { key: "reconcile", label: "매입대조",  icon: PackageSearch },
  { key: "accounts",  label: "계정정보",  icon: KeyRound },
  { key: "lines",     label: "회선",     icon: Phone },
  { key: "tax",       label: "세무",     icon: FileSpreadsheet },
  { key: "presets",   label: "프리셋",   icon: Star },
];

export default function ManagePage() {
  const [tab, setTab] = useState<Tab>("pnl");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">관리</h1>

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

      {tab === "pnl"     && <PnLPanel />}
      {tab === "lines"   && <PhoneLinesPanel />}
      {tab === "tax"     && <TaxPanel />}
      {tab === "presets" && <PresetsPanel />}
      {tab === "ai"      && <SmartstorePanel />}
      {tab === "cardtax"   && <CardTaxPanel />}
      {tab === "reconcile" && <PurchaseReconcilePanel />}
      {tab === "accounts"  && <SupplierAccountsPanel />}
    </div>
  );
}
