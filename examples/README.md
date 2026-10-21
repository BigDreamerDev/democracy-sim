# Starter kits

Copy one, put your key in, run it. Each is a single file with no build step. Node 18+.
Make keys under **You → Build your own app** in the game. See [../API.md](../API.md) for everything else.

| Kit | What it does | Needs |
|-|-|-|
| [minimal.html](minimal.html) | a whole (ugly) client in one page | a browser |
| [whatsapp-gazette-bot/](whatsapp-gazette-bot/) | posts every Gazette entry to your WhatsApp group | a computer that stays on, a phone to scan a QR code |
| [discord-gazette.mjs](discord-gazette.mjs) | posts every Gazette entry to a Discord channel | a Discord channel webhook URL |
| [vote-reminder.mjs](vote-reminder.mjs) | pings your phone when you have a vote to cast, and again before it closes | the free [ntfy](https://ntfy.sh) app |
| [webhook-receiver.mjs](webhook-receiver.mjs) | receives signed webhooks (Gazette or personal alerts) and forwards them to ntfy | somewhere public to run it, e.g. Render's free tier |

The first three poll the API with long-polling, so they work from any laptop with no public address.
The receiver is for when you'd rather the realm push to you.

All of them use only **read** keys. Nothing here acts as you.

## Running

```bash
# Discord
REALM_KEY=rlm_… DISCORD_WEBHOOK=https://discord.com/api/webhooks/… node discord-gazette.mjs

# vote reminders: install ntfy on your phone and subscribe to a topic only you know
REALM_KEY=rlm_… NTFY_TOPIC=realm-uzair-8f3k2 node vote-reminder.mjs

# webhook receiver: deploy, then add https://<your-service>/realm as a webhook in the game
WEBHOOK_SECRET=whsec_… NTFY_TOPIC=realm-uzair-8f3k2 node webhook-receiver.mjs
```

On Windows PowerShell set variables with `$env:REALM_KEY="rlm_…"` first, then `node discord-gazette.mjs`.

`REALM_API` overrides the server address in every kit (default `https://democracy-sim-1.onrender.com/api/v1`).
