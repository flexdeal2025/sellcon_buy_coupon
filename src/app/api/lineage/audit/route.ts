import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";
import { primaryIssue, type LineageFlags } from "@/lib/lineage";

export const runtime = "nodejs";
export const maxDuration = 60;

// timestamptz(UTC) → KST 날짜(YYYY-MM-DD)
function kstDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

interface AuditRow {
  id: string;
  date: string;
  product_name: string;
  supplier: string;
  coupon_code: string;
  stored_as_code: boolean;
  proof: "linked" | "system" | "missing";
  published: boolean;
  sold: boolean;
  sent: boolean;
  failed: boolean;
  status: string; // primaryIssue
}

// 리니지 무결성 감사(dry, 읽기전용): 기간(매입일) 내 매입건의 증빙→발행→판매→발송 상태.
export async function GET(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    // 기본: 최근 7일 (KST)
    const todayKst = kstDate(new Date().toISOString());
    const to = url.searchParams.get("to") || todayKst;
    const from = url.searchParams.get("from") || kstDate(new Date(Date.now() - 6 * 86400_000).toISOString());
    const supplier = url.searchParams.get("supplier") || "";

    const ours = getServerSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vc = getVivaconSupabase() as any;

    const sel = "id, product_name, supplier, coupon_code, purchase_date, created_at, stored_as_code, published, source";
    // A) 매입일 범위 + B) 매입일 없으면 등록일(KST) 범위
    const [a, b] = await Promise.all([
      ours.from("stock_registrations").select(sel).gte("purchase_date", from).lte("purchase_date", to),
      ours.from("stock_registrations").select(sel).is("purchase_date", null)
        .gte("created_at", `${from}T00:00:00+09:00`).lte("created_at", `${to}T23:59:59+09:00`),
    ]);
    if (a.error) throw new Error(a.error.message);
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of [...(a.data ?? []), ...(b.data ?? [])]) byId.set(r.id as string, r);
    let regs = [...byId.values()];
    if (supplier) regs = regs.filter((r) => (r.supplier as string) === supplier);

    // 증빙 링크
    const ids = regs.map((r) => r.id as string);
    const linked = new Set<string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const { data } = await ours.from("proof_registration_links").select("registration_id").in("registration_id", ids.slice(i, i + 1000));
      for (const l of data ?? []) linked.add(l.registration_id as string);
    }

    // 판매/발송 상태 (코드→gifticon_orders). 코드형: 쿠폰코드 배치 / 이미지형: 원본_파일경로 ilike
    const orderMap = new Map<string, { sold: boolean; sent: boolean; failed: boolean }>();
    const upd = (code: string, row: Record<string, unknown>) => {
      const cur = orderMap.get(code) ?? { sold: false, sent: false, failed: false };
      cur.sold = true;
      if (row.alimtalk_sent || row.dispatch_completed) cur.sent = true;
      if (row.dispatch_failed) cur.failed = true;
      orderMap.set(code, cur);
    };
    const OSEL = "쿠폰코드, alimtalk_sent, dispatch_completed, dispatch_failed, status";
    const codeCodes = regs.filter((r) => r.stored_as_code && r.coupon_code).map((r) => r.coupon_code as string);
    for (let i = 0; i < codeCodes.length; i += 200) {
      const { data } = await vc.from("gifticon_orders").select(OSEL).in("쿠폰코드", codeCodes.slice(i, i + 200));
      for (const row of data ?? []) if (row["쿠폰코드"]) upd(String(row["쿠폰코드"]), row);
    }
    // 이미지형: 원본_파일경로/전송완료_파일경로에 쿠폰번호 임베드
    const imgCodes = regs.filter((r) => !r.stored_as_code && r.coupon_code).map((r) => r.coupon_code as string);
    for (const code of imgCodes) {
      const { data } = await vc.from("gifticon_orders")
        .select("alimtalk_sent, dispatch_completed, dispatch_failed, status")
        .or(`원본_파일경로.ilike.%${code}%,전송완료_파일경로.ilike.%${code}%`).limit(5);
      for (const row of data ?? []) upd(code, row);
    }

    const rows: AuditRow[] = regs.map((r) => {
      const code = (r.coupon_code as string) || "";
      const proof: AuditRow["proof"] = linked.has(r.id as string) ? "linked" : (r.source === "sellcon" ? "system" : "missing");
      const o = orderMap.get(code);
      const flags: LineageFlags = {
        proof, published: !!r.published, sold: !!o, sent: o?.sent ?? false, failed: o?.failed ?? false,
      };
      return {
        id: r.id as string,
        date: (r.purchase_date as string) || kstDate(r.created_at as string),
        product_name: (r.product_name as string) || "",
        supplier: (r.supplier as string) || "",
        coupon_code: code,
        stored_as_code: !!r.stored_as_code,
        proof, published: !!r.published, sold: flags.sold, sent: flags.sent, failed: flags.failed,
        status: primaryIssue(flags),
      };
    }).sort((x, y) => y.date.localeCompare(x.date) || x.product_name.localeCompare(y.product_name));

    const summary = {
      total: rows.length,
      complete: rows.filter((r) => r.status === "complete").length,
      proofMissing: rows.filter((r) => r.status === "proof-missing").length,
      unpublished: rows.filter((r) => r.status === "unpublished").length,
      dispatchIssue: rows.filter((r) => r.status === "dispatch-issue").length,
    };

    return NextResponse.json({ ok: true, from, to, supplier, summary, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "감사 조회 실패" }, { status: 500 });
  }
}
