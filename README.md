# Bot Setup Guide

This project runs a set of Minecraft bots (advertise bots + a shop bot) and a Discord bot that controls them all. Before running anything you need to fill in your credentials and settings across a few files.

No real tokens or passwords are stored in this repo — every sensitive field has a placeholder you need to replace.

---

## Files You Need to Edit

### 1. `Shop_Bot_configs/discord config.json`

This is the main Discord config used by `main.py` (the Discord bot).

```json
{
  "discord_token": "put your discord bot token in here",
  "discord_webhook": "put webhook url in here",
  "join_leaving": false
}
```

| Field | What to put |
|---|---|
| `discord_token` | Your Discord bot token from the [Discord Developer Portal](https://discord.com/developers/applications) |
| `discord_webhook` | A Discord webhook URL for the shop bot to send notifications to (channel → Edit Channel → Integrations → Webhooks) |
| `join_leaving` | Set to `true` if you want join/leave messages sent in your server, `false` to disable |

---

### 2. `Shop_Bot_configs/config.json`

Settings for the shop bot's Minecraft account and in-game commands.

```json
{
  "host": "6b6t.org",
  "port": 25565,
  "username": "enter name of bot",
  "command_1": "put command",
  "command_2": "put command",
  "command_3": "put command",
  ...
}
```

| Field | What to put |
|---|---|
| `username` | The Minecraft username of the shop bot account |
| `command_1` | In-game command to run at the start of a delivery (e.g. `/sethome`) |
| `command_2` | In-game command to run after grabbing items — this gets auto-updated to `/tpa <username>` when you use the `/setcustomer` Discord command, but you can also set it manually here |
| `command_3` | In-game command to run after dropping items (e.g. `/home`) |

The delay values (in milliseconds) are already set to sensible defaults — change them if you need the bot to go faster or slower.

> **Note:** The password for the shop bot is set inside `Shop_bot.js` directly — see section 4 below.

---

### 3. `advertise_bot1.js` and `advertise_bot2.js`

Each advertise bot has its own config block near the top of the file.

```js
const config = {
  host: "6b6t.org",
  port: 25565,
  username: "put username",
  password: "put password",
  ...
};

const MESSAGE_WEBHOOK_URL = "put webhook url in here";
```

| Field | What to put |
|---|---|
| `username` | Minecraft username for this advertise bot account |
| `password` | Minecraft password for this advertise bot account (used with `/login` on the server) |
| `MESSAGE_WEBHOOK_URL` | A Discord webhook URL to log the bot's in-game messages — can be the same webhook as the shop bot or a different channel |

You'll also want to update the advertise messages in the `messages` array a bit further down:

```js
const messages = [
    "put advertise message here",
    "this bot is amde by Mr_penguin5566"
];
```

Replace those with whatever you actually want the bots to say in-game.

---

### 4. `Shop_bot.js`

The shop bot's Minecraft credentials are set inside `loadConfig()` near the top:

```js
function loadConfig() {
  const fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return {
    ...fileConfig,
    username: "put username here",
    password: "put password here"
  }
}
```

| Field | What to put |
|---|---|
| `username` | Minecraft username for the shop bot account |
| `password` | Minecraft password for the shop bot account |

---

### 5. `main.py` — Discord Role Permissions

Near the top of `main.py` there's a list for which Discord roles are allowed to use the bot commands:

```python
ALLOWED_ROLE_IDS = [
    #put roles here
]
```

Add the numeric role IDs of any Discord roles you want to give access. To get a role ID: enable Developer Mode in Discord (Settings → Advanced), then right-click the role and click "Copy Role ID".

Example:
```python
ALLOWED_ROLE_IDS = [
    123456789012345678,
    987654321098765432
]
```

Admins on your server always have access regardless of this list.

---

### 6. `advertise-bots-shit/allowed-tps.json`

This controls which Minecraft players are allowed to `/tpy` to the advertise bots. You can manage this list from Discord using `/allowtp` and `/removetp`, or edit the file directly.

```json
{
  "allowed": [
    "add own team via this file or via the discord bot"
  ]
}
```

Replace the placeholder string with actual Minecraft usernames (lowercase), or just leave it empty (`"allowed": []`) and manage it through Discord.

---

## Quick Checklist

Before running:

- [ ] `discord config.json` — Discord bot token filled in
- [ ] `discord config.json` — Webhook URL filled in
- [ ] `config.json` — Shop bot Minecraft username filled in
- [ ] `config.json` — In-game commands set
- [ ] `Shop_bot.js` — Shop bot username + password filled in
- [ ] `advertise_bot1.js` — Username, password, and webhook URL filled in
- [ ] `advertise_bot2.js` — Username, password, and webhook URL filled in
- [ ] `advertise_bot1.js` / `advertise_bot2.js` — Advertise messages updated
- [ ] `main.py` — Discord role IDs added to `ALLOWED_ROLE_IDS`

---

## How to Run

### Prerequisites

Make sure you have both installed before running anything:
- **Node.js** — https://nodejs.org (download and install the LTS version)
- **Python** — https://www.python.org/downloads (3.10 or newer recommended)

Once Node.js is installed, install the required packages by opening a terminal in the project folder and running:
```
npm install
```

For Python, install the required Discord library:
```
pip install discord.py
```

---

### Running the Discord Bot (recommended way)

The Discord bot (`main.py`) is the main controller — once it's running you can start/stop the Minecraft bots from Discord using slash commands.

Open a terminal in the project folder and run:
```
python main.py
```

You should see `✅ Synced as <your bot name>` in the console when it's ready.

---

### Running the Minecraft Bots Manually

If you want to run a bot directly without going through Discord, open a terminal in the project folder and run whichever you need:

```
node advertise_bot1.js
```
```
node advertise_bot2.js
```
```
node Shop_bot.js
```

Each command runs that bot in the foreground. To run multiple bots at the same time you'll need to open a separate terminal window for each one.

---

### Stopping a Bot

To stop any running bot just press `Ctrl + C` in the terminal window it's running in.

You can also start/stop bots from Discord using the `/startbot` and `/stopbot` slash commands once `main.py` is running.

---

## Discord Commands

| Command | What it does |
|---|---|
| `/startbot` | Start an advertise or shop bot |
| `/stopbot` | Stop a running bot |
| `/status-of-bots` | Check which bots are running |
| `/startdelivery` | Trigger a shop delivery cycle |
| `/stopdelivery` | Cancel a delivery |
| `/additem` | Add an item to the delivery order |
| `/removeitem` | Remove an item from the delivery order |
| `/clearorder` | Clear all items from the order |
| `/vieworder` | See the current order and slot usage |
| `/setcustomer` | Set the player to `/tpa` to during delivery |
| `/allowtp` | Add a player to the advertise bot TP whitelist |
| `/removetp` | Remove a player from the TP whitelist |
| `/list-tp` | List all whitelisted players |
| `/balance` | Check your coin balance |
| `/leaderboard` | View top coin holders |
| `/addcoins` | Give coins to a user |
| `/removecoins` | Take coins from a user |
