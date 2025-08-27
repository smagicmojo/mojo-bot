# $MOJO Render Webhook Bot + Score API

## Steps
1) Create Telegram bot via @BotFather → copy the BOT_TOKEN.
2) Deploy this folder as a *Render Web Service*.
   - Build Command: pip install -r requirements.txt
   - Start Command: gunicorn app:app
   - Environment:
     - BOT_TOKEN = your token
     - GAME_URL  = https://<you>.github.io/mojo-banana-dash/
     - WEBHOOK_KEY = random 32 chars (e.g., f3d7b8e2c7a34d0b8f4e1c0a9b77a123)
3) After deploy, set webhook:
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<your-app>.onrender.com/webhook/<WEBHOOK_KEY>
4) Add the bot to your MOJO group (or test in DM).
5) Use /start to get *Play* button; /leaderboard to view scores.
6) Weekly reset (optional): POST to /reset_weekly.