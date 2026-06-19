import discord
from discord import app_commands
import json
import os
import subprocess
from discord.app_commands import Choice

# =======================
# NODE BOT PATHS
# =======================

JS_BOTS = {
    "advertise1": "advertise_bot1.js",
    "advertise2": "advertise_bot2.js",
    "shop": "Shop_bot.js"
}

running_bots = {}

def get_bot_choices():
    choices = []
    for bot in JS_BOTS:
        nice_name = bot.replace("_", " ").title()
        choices.append(Choice(name=nice_name, value=bot))
    return choices

# =======================
# FILES & CONSTANTS
# =======================

DISCORD_CONFIG = "Shop_Bot_configs/discord config.json"
STATE_FILE = "Shop_Bot_configs/bot_state.json"
MC_CONFIG = "Shop_Bot_configs/config.json"
TP_FILE = "advertise-bots/allowed-tps.json"

ALLOWED_ROLE_IDS = [
    #put roles here
]

# =======================
# COIN SYSTEM CONFIG
# =======================

COINS_PER_INVITE = 0.5
COINS_PER_BOOST = 10
COIN_DATA_FILE = "Coin Bot/coin_data.json"

# =======================
# LOAD DISCORD TOKEN
# =======================

with open(DISCORD_CONFIG, "r") as f:
    main_cfg = json.load(f)

JOIN_LEAVING = main_cfg.get("join_leaving", False)

TOKEN = main_cfg.get("discord_token")
if not TOKEN:
    raise RuntimeError("❌ discord_token missing")

WEBHOOK_URL = main_cfg.get("discord_webhook")

invite_cache = {}

# =======================
# HELPERS
# =======================


def load_state():
    if not os.path.exists(STATE_FILE):
        return {"start": False, "items": [], "discord_webhook": WEBHOOK_URL}
    with open(STATE_FILE, "r") as f:
        return json.load(f)

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def load_mc_config():
    with open(MC_CONFIG, "r") as f:
        return json.load(f)

def save_mc_config(cfg):
    with open(MC_CONFIG, "w") as f:
        json.dump(cfg, f, indent=2)

async def get_or_create_channel(guild: discord.Guild, name: str):
    channel = discord.utils.get(guild.text_channels, name=name)
    if channel:
        return channel

    overwrites = {
        guild.default_role: discord.PermissionOverwrite(send_messages=False)
    }

    return await guild.create_text_channel(name=name, overwrites=overwrites)

def load_tp_list():
    if not os.path.exists(TP_FILE):
        return {"allowed": []}
    with open(TP_FILE, "r") as f:
        return json.load(f)

def save_tp_list(data):
    with open(TP_FILE, "w") as f:
        json.dump(data, f, indent=2)

def load_coin_data():
    if os.path.exists(COIN_DATA_FILE):
        with open(COIN_DATA_FILE, "r") as f:
            try:
                return json.load(f)
            except:
                return {}
    return {}

def save_coin_data(data):
    with open(COIN_DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

def get_coin_user(data, user_id):
    uid = str(user_id)
    if uid not in data:
        data[uid] = {"coins": 0, "invites": 0}
    return data[uid]

def get_stack_size(item_id: str):
    return 64  # default stack size


def calculate_total_slots(items):
    total_slots = 0

    for item in items:
        stack_size = get_stack_size(item["item_id"])
        quantity = item["quantity"]

        stacks = (quantity + stack_size - 1) // stack_size
        total_slots += stacks

    return total_slots

# =======================
# DISCORD SETUP
# =======================

intents = discord.Intents.default()
intents.members = True
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

# =======================
# PERMISSIONS
# =======================

def has_permission(interaction: discord.Interaction):
    member = interaction.guild.get_member(interaction.user.id)

    if member is None:
        return False

    if member.guild_permissions.administrator:
        return True

    return any(role.id in ALLOWED_ROLE_IDS for role in member.roles)

# =======================
# EVENTS (FIXED MERGE)
# =======================

@client.event
async def on_ready():
    await tree.sync()
    print(f"✅ Synced as {client.user}")

    for g in client.guilds:
        try:
            invites = await g.invites()
            invite_cache[g.id] = {i.code: i.uses for i in invites}
        except:
            invite_cache[g.id] = {}

@client.event
async def on_member_join(member):
    if member.bot:
        return

    guild = member.guild

    # INVITE TRACK
    try:
        new_invites = {i.code: i.uses for i in await guild.invites()}
    except:
        new_invites = {}

    old = invite_cache.get(guild.id, {})
    used = None

    for code, uses in new_invites.items():
        if uses > old.get(code, 0):
            used = code
            break

    invite_cache[guild.id] = new_invites

    if used:
        invites = await guild.invites()
        inv = next((i for i in invites if i.code == used), None)

        if inv and inv.inviter and not inv.inviter.bot:
            data = load_coin_data()
            user = get_coin_user(data, inv.inviter.id)
            user["coins"] += COINS_PER_INVITE
            user["invites"] += 1
            save_coin_data(data)

    # JOIN MESSAGE
    if JOIN_LEAVING:
        channel = await get_or_create_channel(guild, "join")
        await channel.send(f"👋 Welcome **{member.mention}** to the server!")

@client.event
async def on_member_remove(member):
    if not JOIN_LEAVING or member.bot:
        return
    channel = await get_or_create_channel(member.guild, "leave")
    await channel.send(f"🚪 **{member.name}** has left the server.")

@client.event
async def on_member_update(before, after):
    if before.premium_since is None and after.premium_since is not None:
        data = load_coin_data()
        user = get_coin_user(data, after.id)
        user["coins"] += COINS_PER_BOOST
        save_coin_data(data)

# =======================
# GLOBAL PERMISSION CHECK (APPLIES TO ALL COMMANDS)
# =======================

@tree.interaction_check
async def global_check(interaction: discord.Interaction) -> bool:

    # ✅ Allow anyone to use leaderboard
    if interaction.command and interaction.command.name == "leaderboard":
        return True

    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return False

    return True


# =======================
# joining and leaving
# =======================

@client.event
async def on_member_join(member):
    if not JOIN_LEAVING or member.bot:
        return

    channel = await get_or_create_channel(member.guild, "join")
    await channel.send(f"👋 Welcome **{member.mention}** to the server!")


@client.event
async def on_member_remove(member):
    if not JOIN_LEAVING or member.bot:
        return

    channel = await get_or_create_channel(member.guild, "leave")
    await channel.send(f"🚪 **{member.name}** has left the server.")

# =======================
# /additem (NEW)
# =======================

@tree.command(name="additem", description="Add an item to the delivery order")
async def additem(
        interaction: discord.Interaction,
        item_id: str,
        quantity: int
):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    if quantity < 1:
        await interaction.response.send_message(
            "❌ Quantity must be at least 1",
            ephemeral=True
        )
        return

    state = load_state()

    # Initialize items list if it doesn't exist
    if "items" not in state:
        state["items"] = []

    # Check if item already exists in order
    item_id_lower = item_id.lower()
    existing_item = None
    for item in state["items"]:
        if item["item_id"] == item_id_lower:
            existing_item = item
            break

    if existing_item:
        existing_item["quantity"] += quantity
        await interaction.response.send_message(
            f"✅ Updated `{item_id}` to {existing_item['quantity']} total",
            ephemeral=True
        )
    else:
        state["items"].append({
            "item_id": item_id_lower,
            "quantity": quantity
        })
        await interaction.response.send_message(
            f"✅ Added {quantity}x `{item_id}` to order",
            ephemeral=True
        )

    save_state(state)


# =======================
# /removeitem (NEW)
# =======================

@tree.command(name="removeitem", description="Remove an item from the delivery order")
async def removeitem(interaction: discord.Interaction, item_id: str):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    state = load_state()

    if "items" not in state or len(state["items"]) == 0:
        await interaction.response.send_message(
            "❌ No items in order",
            ephemeral=True
        )
        return

    item_id_lower = item_id.lower()
    original_length = len(state["items"])
    state["items"] = [item for item in state["items"] if item["item_id"] != item_id_lower]

    if len(state["items"]) == original_length:
        await interaction.response.send_message(
            f"❌ Item `{item_id}` not found in order",
            ephemeral=True
        )
    else:
        save_state(state)
        await interaction.response.send_message(
            f"✅ Removed `{item_id}` from order",
            ephemeral=True
        )


# =======================
# /clearorder (NEW)
# =======================

@tree.command(name="clearorder", description="Clear all items from the delivery order")
async def clearorder(interaction: discord.Interaction):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    state = load_state()
    state["items"] = []
    save_state(state)

    await interaction.response.send_message(
        "✅ Order cleared",
        ephemeral=True
    )


# =======================
# /vieworder (NEW)
# =======================

@tree.command(name="vieworder", description="View the current delivery order")
async def vieworder(interaction: discord.Interaction):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    state = load_state()
    items = state.get("items", [])

    if len(items) == 0:
        await interaction.response.send_message(
            "📦 **Current Order**: Empty",
            ephemeral=True
        )
        return

    total_slots = calculate_total_slots(items)

    embed = discord.Embed(title="📦 Current Delivery Order", color=0x00ff00)

    items_text = ""
    for item in items:
        stack_size = get_stack_size(item["item_id"])
        stacks = (item["quantity"] + stack_size - 1) // stack_size
        slot_text = "slot" if stacks == 1 else "slots"
        items_text += f"• {item['quantity']}x `{item['item_id']}` ({stacks} {slot_text})\n"

    embed.add_field(name="Items", value=items_text, inline=False)
    embed.add_field(
        name="Inventory Usage",
        value=f"{total_slots}/36 slots {'✅' if total_slots <= 36 else '❌ TOO MANY!'}",
        inline=False
    )

    if total_slots > 36:
        embed.color = 0xff0000
        embed.set_footer(text="⚠️ Order exceeds inventory capacity! Reduce items before starting.")

    await interaction.response.send_message(embed=embed, ephemeral=True)


# =======================
# /setcustomer
# =======================

@tree.command(name="setcustomer", description="Set the username for the /tpa command")
async def setcustomer(
        interaction: discord.Interaction,
        username: str
):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    # Validate username (basic check - no spaces, reasonable length)
    if " " in username or len(username) < 1 or len(username) > 16:
        await interaction.response.send_message(
            "❌ Invalid username. Must be 1-16 characters with no spaces.",
            ephemeral=True
        )
        return

    cfg = load_mc_config()
    # Only update command_2 with the /tpa prefix hard-coded
    cfg["command_2"] = f"/tpa {username}"
    save_mc_config(cfg)

    await interaction.response.send_message(
        f"✅ TPA command updated to: `/tpa {username}`",
        ephemeral=True
    )


# =======================
# /startbot (UPDATED)
# =======================

@tree.command(name="startdelivery", description="Run one delivery cycle")
async def startdelivery(interaction: discord.Interaction):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    state = load_state()

    # Ensure webhook URL is set
    if "discord_webhook" not in state:
        state["discord_webhook"] = WEBHOOK_URL

    items = state.get("items", [])

    if len(items) == 0:
        await interaction.response.send_message(
            "❌ **No items in order!**\n\n"
            "Use `/additem` to add items first:\n"
            "Example: `/additem item_id:red_shulker_box quantity:8`\n\n"
            "Then use `/vieworder` to check your order before starting.",
            ephemeral=True
        )
        return

    # Check inventory capacity
    total_slots = calculate_total_slots(items)

    if total_slots > 36:
        items_list = ", ".join([f"{item['quantity']}x {item['item_id']}" for item in items])
        await interaction.response.send_message(
            f"❌ **Order Too Large!**\n"
            f"Items: {items_list}\n"
            f"Required slots: {total_slots}/36\n\n"
            f"Use `/removeitem` or `/clearorder` to reduce the order size.",
            ephemeral=True
        )
        return

    state["start"] = True
    save_state(state)

    items_summary = ", ".join([f"{item['quantity']}x {item['item_id']}" for item in items])

    await interaction.response.send_message(
        f"🚀 **Delivery Started!**\n"
        f"Items: {items_summary}\n"
        f"Inventory usage: {total_slots}/36 slots",
        ephemeral=True
    )


# =======================
# /stopbot
# =======================

@tree.command(name="stopdelivery", description="Stop delivery")
async def stopdelivery(interaction: discord.Interaction):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    state = load_state()
    state["start"] = False
    save_state(state)

    await interaction.response.send_message(
        "🛑 Bot stopped",
        ephemeral=True
    )

# ====================
# commands to start/stop/check status on all the bots
# ====================

# ====================
# commands to start the bots
# ====================

@tree.command(name="startbot", description="Start a bot")
@app_commands.choices(bot_name=get_bot_choices())
async def startjs(interaction: discord.Interaction, bot_name: str):

    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    bot = bot_name

    if bot in running_bots:
        await interaction.response.send_message(
            f"⚠️ {bot} is already running",
            ephemeral=True
        )
        return

    process = subprocess.Popen(["node", JS_BOTS[bot]])
    running_bots[bot] = process

    await interaction.response.send_message(
        f"✅ Started `{bot}`",
        ephemeral=True
    )

# ====================
# commands to stop all the bots
# ====================

@tree.command(name="stopbot", description="Stop a bot")
@app_commands.choices(bot_name=get_bot_choices())
async def stopjs(interaction: discord.Interaction, bot_name: str):

    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    bot = bot_name

    if bot not in running_bots:
        await interaction.response.send_message(
            "❌ Bot is not running",
            ephemeral=True
        )
        return

    running_bots[bot].terminate()
    del running_bots[bot]

    await interaction.response.send_message(
        f"🛑 Stopped `{bot}`",
        ephemeral=True
    )

# ====================
# commands to check the status of all the bots
# ====================

@tree.command(name="status-of-bots", description="Check the bot status")
async def statusjs(interaction: discord.Interaction):

    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    if not running_bots:
        await interaction.response.send_message(
            "⚪ No JS bots running",
            ephemeral=True
        )
        return

    msg = ""
    for bot in JS_BOTS:
        if bot in running_bots:
            msg += f"🟢 {bot}\n"
        else:
            msg += f"🔴 {bot}\n"

    await interaction.response.send_message(msg, ephemeral=True)

# ====================
# commands for the Tp parts of the bots
# ====================

# ====================
# commands to add people to the allowed tp list
# ====================

@tree.command(name="allowtp", description="Allow a player to teleport to the bot")
async def allowtp(interaction: discord.Interaction, username: str):

    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    data = load_tp_list()

    username = username.lower()

    if username in [p.lower() for p in data["allowed"]]:
        await interaction.response.send_message(
            f"⚠️ `{username}` is already allowed",
            ephemeral=True
        )
        return

    data["allowed"].append(username)
    save_tp_list(data)

    await interaction.response.send_message(
        f"✅ `{username}` can now teleport to the bot",
        ephemeral=True
    )

# ====================
# commands to remove people to the allowed tp list
# ====================

@tree.command(name="removetp", description="Remove a player from the teleport whitelist")
async def removetp(interaction: discord.Interaction, username: str):

    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    data = load_tp_list()

    username = username.lower()

    if username not in [p.lower() for p in data["allowed"]]:
        await interaction.response.send_message(
            f"❌ `{username}` is not on the whitelist",
            ephemeral=True
        )
        return

    data["allowed"] = [p for p in data["allowed"] if p.lower() != username]

    save_tp_list(data)

    await interaction.response.send_message(
        f"🗑 Removed `{username}` from TP whitelist",
        ephemeral=True
    )

# ====================
# commands to list the people on the allowed tp list
# ====================

@tree.command(name="list-tp", description="List all players allowed to teleport")
async def listtp(interaction: discord.Interaction):
    try:
        if not has_permission(interaction):
            await interaction.response.send_message("❌ No permission", ephemeral=True)
            return

        data = load_tp_list()
        allowed = data.get("allowed", [])

        if not allowed:
            await interaction.response.send_message(
                "⚪ No players are currently allowed to teleport.",
                ephemeral=True
            )
            return

        player_list = "\n".join([f"• {player}" for player in allowed])

        await interaction.response.send_message(
            f"📜 **Allowed TP Players:**\n{player_list}",
            ephemeral=True
        )
    except Exception as e:
        await interaction.response.send_message(f"❌ Error: {e}", ephemeral=True)

# ====================
# commands for the coin login part of the bot
# ====================

# ====================
# commands to check the balance of a user
# ====================

@tree.command(name="balance", description="Check your coins")
async def balance(interaction: discord.Interaction):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    data = load_coin_data()
    user = get_coin_user(data, interaction.user.id)
    save_coin_data(data)

    await interaction.response.send_message(
        f"💰 Coins: **{user['coins']}**\nInvites: **{user['invites']}**",
        ephemeral=True
    )

# ====================
# commands to check the leaderboard
# ====================

@tree.command(name="leaderboard", description="Top coin holders")
async def leaderboard(interaction: discord.Interaction):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    data = load_coin_data()
    sorted_users = sorted(data.items(), key=lambda x: x[1]["coins"], reverse=True)[:10]

    msg = ""
    for i, (uid, info) in enumerate(sorted_users, 1):
        member = interaction.guild.get_member(int(uid))
        name = member.display_name if member else f"User {uid}"
        msg += f"{i}. {name} — {info['coins']} coins\n"

    await interaction.response.send_message(msg or "No data yet.")

# ====================
# commands to add coins to a user
# ====================

@tree.command(name="addcoins", description="Add coins")
async def addcoins(interaction: discord.Interaction, member: discord.Member, amount: float):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    data = load_coin_data()
    user = get_coin_user(data, member.id)

    user["coins"] += amount
    save_coin_data(data)

    await interaction.response.send_message(
        f"✅ Added {amount} coins to {member.display_name}"
    )

# ====================
# commands to remove coins to a user
# ====================

@tree.command(name="removecoins", description="Remove coins")
async def removecoins(interaction: discord.Interaction, member: discord.Member, amount: float):
    if not has_permission(interaction):
        await interaction.response.send_message("❌ No permission", ephemeral=True)
        return

    data = load_coin_data()
    user = get_coin_user(data, member.id)

    if user["coins"] < amount:
        await interaction.response.send_message("❌ Not enough coins", ephemeral=True)
        return

    user["coins"] -= amount
    save_coin_data(data)

    await interaction.response.send_message(
        f"✅ Removed {amount} coins from {member.display_name}"
    )

# =======================
# START DISCORD BOT
# =======================

client.run(TOKEN)