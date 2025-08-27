import os, time, sqlite3, threading
from flask import Flask, request, jsonify
from telegram import Bot, Update, InlineKeyboardButton, InlineKeyboardMarkup

BOT_TOKEN   = os.environ["BOT_TOKEN"]
GAME_URL    = os.environ["GAME_URL"]
WEBHOOK_KEY = os.environ["WEBHOOK_KEY"]
ADMIN_CHAT_ID = os.environ.get("ADMIN_CHAT_ID")  # group ID or your user ID

DB_PATH = "scores.db"
app = Flask(__name__)
bot = Bot(BOT_TOKEN)

# ── Database ──
def init_db():
    con = sqlite3.connect(DB_PATH); c = con.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS scores(
        user_id TEXT PRIMARY KEY,
        best_score INTEGER DEFAULT 0,
        updated_at INTEGER
    )""")
    con.commit(); con.close()
init_db()

def set_best(user_id, score):
    con = sqlite3.connect(DB_PATH); c = con.cursor()
    c.execute("SELECT best_score FROM scores WHERE user_id=?", (user_id,))
    row = c.fetchone()
    if row is None:
        best = score
        c.execute("INSERT INTO scores(user_id,best_score,updated_at) VALUES(?,?,?)",
                  (user_id, best, int(time.time())))
    else:
        best = max(row[0] or 0, score)
        c.execute("UPDATE scores SET best_score=?,updated_at=? WHERE user_id=?",
                  (best, int(time.time()), user_id))
    con.commit(); con.close()
    return best

def get_leaderboard(limit=10):
    con = sqlite3.connect(DB_PATH); c = con.cursor()
    c.execute("SELECT user_id, best_score FROM scores ORDER BY best_score DESC, updated_at ASC LIMIT ?", (limit,))
    rows = c.fetchall(); con.close()
    return rows

def reset_scores():
    con = sqlite3.connect(DB_PATH); c = con.cursor()
    c.execute("DELETE FROM scores"); con.commit(); con.close()

# ── API Endpoints ──
@app.post("/score")
def score():
    data = request.get_json(force=True, silent=True) or {}
    uid  = str(data.get("user_id","")).strip()
    sc   = int(data.get("score", 0))
    if not uid or sc < 0:
        return jsonify(ok=False, error="bad params"), 400
    best = set_best(uid, sc)
    try: bot.set_game_score(user_id=int(uid), score=best, force=True)
    except Exception: pass
    return jsonify(ok=True, best=best)

@app.get("/leaderboard")
def leaderboard():
    rows = get_leaderboard(50)
    return jsonify(ok=True, top=[{"user_id": r[0], "best": r[1]} for r in rows])

@app.get("/health")
def health(): return "ok", 200

@app.post(f"/webhook/{WEBHOOK_KEY}")
def tg_webhook():
    upd = Update.de_json(request.get_json(force=True), bot)
    if upd.message and upd.message.text:
        chat_id = upd.effective_chat.id
        user_id = upd.effective_user.id
        text = upd.message.text.strip()

        if text.startswith("/start"):
            url_base = request.url_root.strip("/")
            play_url = f"{GAME_URL}?uid={user_id}&api={url_base}"
            kb  = InlineKeyboardMarkup([[InlineKeyboardButton("▶️ Play $MOJO Banana Dash", url=play_url)]])
            bot.send_message(chat_id, "Collect bananas, avoid rocks. Scores auto-save 🍌", reply_markup=kb)

        elif text.startswith("/leaderboard"):
            rows = get_leaderboard(10)
            lines = ["🏆 Top Bananas"]
            for i, (uid, sc) in enumerate(rows, start=1):
                lines.append(f"{i}. {uid} — {sc}")
            bot.send_message(chat_id, "\n".join(lines) if len(lines) > 1 else "No scores yet.")
        else:
            bot.send_message(chat_id, "Commands: /start, /leaderboard")
    return "OK", 200

# ── Weekly Reset Scheduler ──
def weekly_task():
    while True:
        now = time.gmtime()
        # Run Sunday 00:00 UTC (adjust if you want another day/time)
        if now.tm_wday == 6 and now.tm_hour == 0 and now.tm_min < 5:
            # Summarize winners
            rows = get_leaderboard(5)
            if rows and ADMIN_CHAT_ID:
                msg = ["🍌 Weekly $MOJO Winners 🍌"]
                for i,(uid,sc) in enumerate(rows, start=1):
                    msg.append(f"{i}. {uid} — {sc}")
                msg.append("\n🎉 Congrats fam! Leaderboard reset for new week 🚀")
                try: bot.send_message(ADMIN_CHAT_ID, "\n".join(msg))
                except Exception: pass
            reset_scores()
            time.sleep(3600)  # wait 1h to avoid duplicate reset
        time.sleep(60)  # check every minute

threading.Thread(target=weekly_task, daemon=True).start()

if __name__ == "__main__":

    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))

