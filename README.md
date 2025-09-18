# $MOJO Presale Buy Alerts (Render-ready)

This tiny Node.js server receives **Helius** webhooks for SOL sent to your **presale wallet** and posts a hype alert to your **Telegram channel**.

---

## 1) Prereqs

- Telegram bot token (add your bot to your channel as **Admin**).
- Channel ID (looks like `-100xxxxxxxxxx`).
- Your **presale treasury** Solana address.
- Helius account + API key for **Webhooks** (free tier OK).

> TIP: Get your channel ID by adding `@RawDataBot` to the channel temporarily and sending any message. It will show the chat_id. Remove the bot afterwards.

---

## 2) Deploy on Render

1. Create a new **GitHub repo** and push these files.
2. On **Render → New → Web Service**, connect the repo.
3. Environment:
   - **Runtime**: Node 18+
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
4. Add these **Environment Variables** (from `.env.example`):
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `PRESALE_WALLET`
   - `TOKENS_PER_SOL` (e.g., `1000000`)
   - `WEBHOOK_SECRET` (any secret string)
   - Optional: `ANNOUNCE_ANIMATION_URL`, `SOL_PRICE_USD`
5. Deploy. After it’s live, note your base URL, e.g. `https://mojo-alerts.onrender.com`

---

## 3) Create the Helius Webhook

In your Helius Dashboard:

- **Create Webhook** → choose **Enhanced / Address Activity** (anything that includes *native transfers*).
- **Webhook URL**: `https://YOUR-RENDER-URL/helius`
- Add **Authorization** header: `Bearer YOUR_WEBHOOK_SECRET`
- **Addresses to monitor**: your `PRESALE_WALLET`
- **Event filters**: include **native transfers**

Save it. Send a tiny test transfer (e.g., `0.01 SOL`) to your presale wallet—your Telegram channel should get a message.

---

## 4) Test Endpoints

- `GET /health` → check server health & totals.
- `POST /test` with JSON `{"amountSol": 1.5, "buyer": "YourWallet"}` → sends a fake alert (no Helius needed).

---

## 5) Message Format

```
🐒🔥 $MOJO New Presale Buy! 🔥🐒

Amount: 1.500 SOL
Total: $315.00
Tokens Bought: 1,500,000 $MOJO

Price Per Token: $0.00015000
Total Raised: $12,345.67
Total Holders: 123

Transaction: <solscan link>
```

If `ANNOUNCE_ANIMATION_URL` is set, the server posts the alert as a caption under your GIF/MP4 (like Little Pepe). Otherwise it posts text only.

---

## 6) Notes

- Totals are stored in `data/state.json`. This is **file-based** and may reset on redeploys. For stronger persistence, plug in Redis/Postgres.
- If you sell by *rate* (e.g., 1 SOL = 1,000,000 MOJO), the server calculates `Price Per Token` using live SOL price (Coingecko). You can hard‑set `SOL_PRICE_USD` to lock a price.
- The webhook dedupes by signature to avoid double posts.
- Security: the server verifies the `Authorization: Bearer WEBHOOK_SECRET` header (or `?secret=` query param).

---

## 7) Troubleshooting

- No Telegram messages? Check:
  - Bot is admin in the channel.
  - `TELEGRAM_CHAT_ID` is correct (must be negative for channels).
  - Render logs (enable "View Logs").
  - Helius is hitting `/helius` (check webhook delivery logs).

Happy shipping 🚀🐒
