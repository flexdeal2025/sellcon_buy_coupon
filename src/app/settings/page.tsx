"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PhoneLinesPanel } from "@/components/phone-lines-panel";
import { PresetsPanel } from "@/components/presets-panel";
import { SupplierAccountsPanel } from "@/components/supplier-accounts-panel";
import { Phone, Star, KeyRound } from "lucide-react";

type Tab = "lines" | "accounts" | "presets";

const TABS: { key: Tab; label: string; icon: typeof Phone }[] = [
  { key: "lines",    label: "회선",     icon: Phone },
  { key: "accounts", label: "계정정보",  icon: KeyRound },
  { key: "presets",  label: "프리셋",   icon: Star },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("lines");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">설정</h1>

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

      {tab === "lines"    && <PhoneLinesPanel />}
      {tab === "accounts" && <SupplierAccountsPanel />}
      {tab === "presets"  && <PresetsPanel />}
    </div>
  );
}
