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
        {/* Pretendard - 한국어 가독성 최적화 폰트 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body
        className="min-h-full bg-background font-sans text-foreground"
        style={{ ["--font-pretendard" as string]: "Pretendard Variable" }}
      >
        <PasscodeGate>
          <AppShell>{children}</AppShell>
        </PasscodeGate>
      </body>
    </html>
  );
}
