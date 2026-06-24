import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PasscodeGate } from "@/components/passcode-gate";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "기프티콘 매입 관리",
  description: "기프티콘 대량 매입 워크플로우 관리 앱",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* Wanted Sans - 모던·고가독성 국내 폰트 (OFL, 상업용 무료) */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css"
        />
      </head>
      <body
        className="min-h-full bg-background font-sans text-foreground"
        style={{ ["--font-app" as string]: "Wanted Sans Variable" }}
      >
        <PasscodeGate>
          <AppShell>{children}</AppShell>
        </PasscodeGate>
      </body>
    </html>
  );
}
