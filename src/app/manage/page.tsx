"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PhoneLinesPanel } from "@/components/phone-lines-panel";
import { TaxPanel } from "@/components/tax-panel";
import { PresetsPanel } from "@/components/presets-panel";
import { Phone, FileSpreadsheet, Star } from "lucide-react";

type Tab = "lines" | "tax" | "presets";

const TABS: { key: Tab; label: string; icon: typeof Phone }[] = [
  { key: "lines", label: "회선 관리", icon: Phone },
  { key: "tax", label: "세무 관리", icon: FileSpreadsheet },
  { key: "presets", label: "프리셋", icon: Star },
];

export default function ManagePage() {
  const [tab, setTab] = useState<Tab>("lines");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">회선 · 세무 관리</h1>

      {/* 탭 */}
      <div className="flex rounded-xl bg-secondary p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium transition-colors",
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

      {tab === "lines" && <PhoneLinesPanel />}
      {tab === "tax" && <TaxPanel />}
      {tab === "presets" && <PresetsPanel />}
    </div>
  );
}
