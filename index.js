/*
 * $MOJO Presale Alert Server (Render-ready)
 * --------------------------------------------------
 * Listens for Helius webhooks for SOL transfers into your presale wallet,
 * formats a hype message, and posts it to your Telegram channel.
 *
 * ENV VARS (set these on Render):
 *  - TELEGRAM_BOT_TOKEN    : Telegram bot token
 *  - TELEGRAM_CHAT_ID      : Channel/Group ID (e.g., -1001234567890)
 *  - PRESALE_WALLET        : Solana address receiving presale SOL
 *  - TOKENS_PER_SOL        : e.g., 1000000 (1 SOL = 1,000,000 $MOJO)
 *  - WEBHOOK_SECRET        : any string; must match Authorization: Bearer <secret> header (or ?secret=)
 *  - ANNOUNCE_ANIMATION_URL: (optional) GIF/MP4 URL to send with each alert
 *  - SOL_PRICE_USD         : (optional) override SOL price; if not set, server fetches live price
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---- Config ----
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID || "";
const PRESALE_WALLET     = (process.env.PRESALE_WALLET || "").trim();
const TOKENS_PER_SOL     = parseFloat(process.env.TOKENS_PER_SOL || "1000000");
const WEBHOOK_SECRET     = process.env.WEBHOOK_SECRET || "";
const ANNOUNCE_ANIMATION_URL = process.env.ANNOUNCE_ANIMATION_URL || "";
const SOL_PRICE_OVERRIDE = parseFloat(process.env.SOL_PRICE_USD || "0");

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !PRESALE_WALLET) {
  console.warn("[WARN] Missing one or more required env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PRESALE_WALLET");
}

// ---- Simple persistence (JSON file) ----
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const STATE_PATH = path.join(DATA_DIR, 'state.json');

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { totalSol: 0, buyers: {}, processedSignatures: {} };
  }
}
function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("[ERR] Failed saving state:", e);
  }
}
let state = loadState();

// ---- Helpers ----
const fmt = new Intl.NumberFormat('en-US');
function fmtUsd(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function getSolPriceUSD() {
  if (SOL_PRICE_OVERRIDE > 0) return SOL_PRICE_OVERRIDE;
  try {
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const json = await resp.json();
    const price = json?.solana?.usd;
    if (typeof price === 'number') return price;
  } catch (e) {
    console.warn("[WARN] Coingecko fetch failed:", e.message);
  }
  // Fallback to a safe default if price fetch fails
  return 150; // adjust if needed
}

function verifySecret(req) {
  if (!WEBHOOK_SECRET) return true; // If not set, skip verification
  const auth = req.headers['authorization'] || req.headers['x-webhook-secret'] || req.query?.secret;
  if (!auth) return false;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim() === WEBHOOK_SECRET;
  }
  return (auth === WEBHOOK_SECRET);
}

async function sendTelegramText(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: "Markdown"
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const j = await res.json();
  if (!j.ok) console.error("[TG ERR]", j);
  return j;
}

async function sendTelegramAnimation(caption, animationUrl) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendAnimation`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    animation: animationUrl,
    caption,
    parse_mode: "Markdown"
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const j = await res.json();
  if (!j.ok) console.error("[TG ERR]", j);
  return j;
}

async function announceBuy({ buyer, amountSol, signature }) {
  const solPrice = await getSolPriceUSD();
  const tokens = amountSol * TOKENS_PER_SOL;
  const pricePerToken = solPrice / TOKENS_PER_SOL;
  const totalRaisedUsd = state.totalSol * solPrice;
  const holders = Object.keys(state.buyers).length;

  const shortSig = signature ? (signature.slice(0, 6) + "..." + signature.slice(-4)) : "tx";
  const txLink = signature ? `https://solscan.io/tx/${signature}` : `https://solscan.io/account/${PRESALE_WALLET}`;

  const message =
`🐒🔥 *$MOJO New Presale Buy!* 🔥🐒

*Amount:* ${amountSol.toFixed(3)} SOL 🚀
*Total:* $${fmtUsd(amountSol * solPrice)} 💵
*Tokens Bought:* ${fmt.format(Math.floor(tokens))} $MOJO 🌴

💰 *Price Per Token:* $${pricePerToken.toFixed(8)}
📈 *Total Raised:* $${fmtUsd(totalRaisedUsd)}
🤝 *Total Holders:* ${holders}

🔗 *Transaction:* [${shortSig}](${txLink})

Buy now 👉 smagicmojo.github.io/mojo-coin`;

  if (ANNOUNCE_ANIMATION_URL) {
    await sendTelegramAnimation(message, ANNOUNCE_ANIMATION_URL);
  } else {
    await sendTelegramText(message);
  }
}

// ---- Core webhook: /helius ----
app.post('/helius', async (req, res) => {
  if (!verifySecret(req)) {
    return res.status(401).json({ ok: false, error: "invalid secret" });
  }

  let payload = req.body;

  // Normalize: Helius "enhanced webhooks" send { ... , transactions: [ ... ] }
  const txs = Array.isArray(payload?.transactions) ? payload.transactions
            : (Array.isArray(payload) ? payload : (payload?.type || payload?.signature ? [payload] : []));

  let buys = 0;
  for (const tx of txs) {
    try {
      const signature = tx.signature || tx?.transaction?.signatures?.[0] || '';
      if (signature && state.processedSignatures[signature]) {
        continue; // dedupe
      }

      // Look for native transfer into our wallet
      const nativeTransfers = tx.nativeTransfers || tx?.events?.nativeTransfers || [];
      for (const nt of nativeTransfers) {
        const toAcc = (nt.toUserAccount || nt.toUser || "").trim();
        const fromAcc = (nt.fromUserAccount || nt.fromUser || "").trim();
        const lamports = Number(nt.amount || nt.lamports || 0); // Helius uses lamports
        if (!toAcc || lamports <= 0) continue;

        if (toAcc.toLowerCase() === PRESALE_WALLET.toLowerCase()) {
          const amountSol = lamports / 1_000_000_000;
          // Update state
          state.totalSol += amountSol;
          state.buyers[fromAcc || 'unknown'] = true;
          state.processedSignatures[signature || (`${fromAcc}:${lamports}:${Date.now()}`)] = true;
          saveState(state);
          await announceBuy({ buyer: fromAcc, amountSol, signature });
          buys++;
        }
      }
    } catch (e) {
      console.error("[Webhook parse error]", e);
    }
  }

  return res.json({ ok: true, processed: buys });
});

// ---- Health & test routes ----
app.get('/health', (req, res) => {
  res.json({ ok: true, at: new Date().toISOString(), state: { totalSol: state.totalSol, holders: Object.keys(state.buyers).length } });
});

// Manual test to send a sample buy (no secret required but rate-limited in real life)
app.post('/test', async (req, res) => {
  const amountSol = Number(req.body?.amountSol || 1);
  const buyer = req.body?.buyer || "ExampleBuyer";
  await (async () => {
    state.totalSol += amountSol;
    state.buyers[buyer] = true;
    saveState(state);
    await announceBuy({ buyer, amountSol, signature: "" });
  })();
  res.json({ ok: true });
});

// Root
app.get('/', (req, res) => {
  res.send('MOJO presale alert server is running. Use /health.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MOJO presale alert server listening on :${PORT}`);
});
