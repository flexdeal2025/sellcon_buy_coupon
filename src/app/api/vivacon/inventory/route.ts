import { NextResponse } from "next/server";
import { getVivaconSupabase, COUPON_STATUSES, COUPON_SELECT } from "@/lib/supabase/vivacon";

export const runtime = "nodejs";
export const maxDuration = 30;

// 정렬 허용 컬럼 (화이트리스트)
const SORTABLE = ["created_at", "expiry_date", "allocated_at"];

// 조회: 상품명 검색(q) / 상태(status) / 페이지(page,pageSize) / 정렬(sort,dir)
export async function GET(req: Request) {
  try {
    const sb = getVivaconSupabase();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const status = (url.searchParams.get("status") ?? "").trim();
    const page = Math.max(0, Number(url.searchParams.get("page") ?? 0));
    const pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get("pageSize") ?? 50)));
    const sortParam = url.searchParams.get("sort") ?? "created_at";
    const sort = SORTABLE.includes(sortParam) ? sortParam : "created_at";
    const ascending = (url.searchParams.get("dir") ?? "desc") === "asc"; // 기본 최신순(내림차순)

    // 메인 목록
    let query = sb
      .from("coupon_codes")
      .select(COUPON_SELECT, { count: "exact" })
      .order(sort, { ascending, nullsFirst: false })
      .order("id", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (q) query = query.ilike("상품명", `%${q}%`);
    if (status) query = query.eq("status", status);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    // 상태별 요약 (q 반영, status 무관)
    const summary: Record<string, number> = {};
    await Promise.all(
      COUPON_STATUSES.map(async (s) => {
        let cq = sb.from("coupon_codes").select("id", { count: "exact", head: true }).eq("status", s);
        if (q) cq = cq.ilike("상품명", `%${q}%`);
        const { count: c } = await cq;
        summary[s] = c ?? 0;
      }),
    );

    return NextResponse.json({ ok: true, rows: data ?? [], total: count ?? 0, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "조회 실패";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
