// 텔레그램 수집 봇 webhook 등록
// 실행: node --env-file=.env.local scripts/set-telegram-webhook.mjs <webhookURL>
//   예) ... https://sellcon-buy-coupon.vercel.app/api/telegram/ingest
//   env: TELEGRAM_INGEST_BOT_TOKEN, TELEGRAM_INGEST_SECRET
const token = process.env.TELEGRAM_INGEST_BOT_TOKEN;
const secret = process.env.TELEGRAM_INGEST_SECRET;
const url = process.argv[2];
if (!token || !url) { console.error("❌ TELEGRAM_INGEST_BOT_TOKEN(env) + webhookURL(인자) 필요"); process.exit(1); }

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret || undefined,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  }),
});
const data = await res.json();
console.log(data.ok ? "✅ webhook 등록됨: " + url : "❌ 실패: " + data.description);
// 현재 상태 확인
const info = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json();
console.log("현재 webhook:", info?.result?.url || "(없음)", "/ pending:", info?.result?.pending_update_count ?? "-");
