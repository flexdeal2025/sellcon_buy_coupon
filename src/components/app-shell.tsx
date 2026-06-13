"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import {
  LayoutDashboard,
  PlusCircle,
  PackageCheck,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SupabaseBanner } from "@/components/supabase-banner";

const NAV = [
  { href: "/", label: "현황", icon: LayoutDashboard },
  { href: "/new", label: "매입입력", icon: PlusCircle },
  { href: "/inventory", label: "재고확인", icon: PackageCheck },
  { href: "/manage", label: "회선/세무", icon: Settings2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col">
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="text-lg">🎟️</span>
          <span>기프티콘 매입</span>
        </Link>
        {/* 데스크톱 네비게이션 */}
        <nav className="hidden gap-1 sm:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <SupabaseBanner />

      {/* 본문 (모바일 하단 탭바 높이만큼 패딩) */}
      <main className="flex-1 px-4 py-4 pb-28 sm:pb-8">{children}</main>

      {/* 모바일 하단 탭바 */}
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-3xl items-stretch border-t border-border bg-background/95 pb-safe backdrop-blur sm:hidden">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon
                className={cn("h-6 w-6", active && "scale-110")}
                strokeWidth={active ? 2.5 : 2}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}
