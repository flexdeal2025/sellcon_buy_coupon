"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import {
  LayoutDashboard,
  PlusCircle,
  PackageCheck,
  Wallet,
  Settings2,
  Compass,
  ClipboardList,
  Boxes,
  ScanLine,
  ReceiptText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SupabaseBanner } from "@/components/supabase-banner";

type NavChild = { href: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
  href: string; // 그룹 진입 시 기본 경로
  match: string[]; // 이 그룹으로 간주할 경로 prefix 목록
  children?: NavChild[]; // 별도 경로로 분리된 하위 기능 (서브내비로 표시)
};

const NAV: NavGroup[] = [
  {
    key: "purchase",
    label: "매입관리",
    icon: ClipboardList,
    href: "/",
    match: ["/", "/new", "/inventory"],
    children: [
      { href: "/", label: "현황", icon: LayoutDashboard },
      { href: "/new", label: "매입입력", icon: PlusCircle },
      { href: "/inventory", label: "재고확인", icon: PackageCheck },
    ],
  },
  {
    key: "finance",
    label: "정산·세무",
    icon: Wallet,
    href: "/manage",
    match: ["/manage"],
  },
  {
    key: "vivacon",
    label: "쿠폰재고",
    icon: Boxes,
    href: "/vivacon",
    match: ["/vivacon"],
  },
  {
    key: "stock",
    label: "재고등록",
    icon: ScanLine,
    href: "/stock",
    match: ["/stock"],
  },
  {
    key: "proof",
    label: "증빙매핑",
    icon: ReceiptText,
    href: "/proof",
    match: ["/proof"],
  },
  {
    key: "settings",
    label: "설정",
    icon: Settings2,
    href: "/settings",
    match: ["/settings"],
  },
  {
    key: "vision",
    label: "사업방향",
    icon: Compass,
    href: "/admin/architecture",
    match: ["/admin"],
  },
];

// 화면 전체 폭을 쓰는 PC 작업용 라우트 (헤더+콘텐츠 함께 넓어짐)
const WIDE_ROUTES = ["/vivacon", "/stock", "/proof"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeGroup = NAV.find((g) => isGroupActive(pathname, g)) ?? NAV[0];
  const wide = WIDE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  return (
    <div className={cn("mx-auto flex min-h-screen w-full flex-col", wide ? "max-w-[1800px]" : "max-w-3xl lg:max-w-6xl")}>
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
        <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap font-bold">
          <span className="text-lg">🎟️</span>
          <span>기프티콘 매입</span>
        </Link>
        {/* 데스크톱 네비게이션 */}
        <nav className="hidden min-w-0 gap-0.5 overflow-x-auto sm:flex">
          {NAV.map((g) => {
            const active = g.key === activeGroup.key;
            return (
              <Link
                key={g.key}
                href={g.href}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <g.icon className="h-4 w-4" />
                {g.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <SupabaseBanner />

      {/* 그룹 하위 서브내비 (별도 경로로 분리된 기능들) */}
      {activeGroup.children && activeGroup.children.length > 0 && (
        <div className="sticky top-14 z-20 border-b border-border bg-background/80 px-4 py-2 backdrop-blur">
          <div className="flex gap-1.5 overflow-x-auto">
            {activeGroup.children.map((c) => {
              const active = isChildActive(pathname, c.href);
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-foreground text-background"
                      : "bg-secondary text-secondary-foreground hover:bg-accent",
                  )}
                >
                  <c.icon className="h-3.5 w-3.5" />
                  {c.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 본문 (모바일 하단 탭바 높이만큼 패딩) */}
      <main className="flex-1 px-4 py-4 pb-28 sm:pb-8">{children}</main>

      {/* 모바일 하단 탭바 */}
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-3xl items-stretch border-t border-border bg-background/95 pb-safe backdrop-blur sm:hidden">
        {NAV.map((g) => {
          const active = g.key === activeGroup.key;
          return (
            <Link
              key={g.key}
              href={g.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <g.icon
                className={cn("h-6 w-6", active && "scale-110")}
                strokeWidth={active ? 2.5 : 2}
              />
              {g.label}
            </Link>
          );
        })}
      </nav>

      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}

function isGroupActive(pathname: string, g: NavGroup) {
  return g.match.some((m) =>
    m === "/" ? pathname === "/" : pathname === m || pathname.startsWith(m + "/"),
  );
}

function isChildActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
