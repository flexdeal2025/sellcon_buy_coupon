import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";

export const runtime = "nodejs";

const pad = (n: number) => String(n).padStart(2, "0");

// 업로드 배치 생성 (batch_no = YYYYMMDD_NN 자동)
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let body: {
    storage_type?: string;
    default_product_name?: string;
    default_exchange_location?: string;
    purchase_date?: string;
    created_by?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }

  const storage_type = body.storage_type === "code" ? "code" : "image";
  try {
    const sb = getServerSupabase();
    const now = new Date();
    const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const { count } = await sb
      .from("stock_batches")
      .select("id", { count: "exact", head: true })
      .like("batch_no", `${ymd}_%`);
    const batch_no = `${ymd}_${pad((count ?? 0) + 1)}`;

    const { data, error } = await sb
      .from("stock_batches")
      .insert({
        batch_no,
        storage_type,
        default_product_name: (body.default_product_name ?? "").trim(),
        default_exchange_location: (body.default_exchange_location ?? "").trim(),
        purchase_date: body.purchase_date || null,
        created_by: (body.created_by ?? "").trim(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, batch: data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "배치 생성 실패" }, { status: 500 });
  }
}
