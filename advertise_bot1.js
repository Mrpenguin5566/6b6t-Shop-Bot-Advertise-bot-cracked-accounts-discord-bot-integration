const mineflayer = require("mineflayer");
const { pathfinder } = require("mineflayer-pathfinder");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const Auth = require("./Auth.js");

/* ===================== CONFIG ===================== */

const config = {
host: "6b6t.org",
port: 25565,

username: "put username",
password: "put password",

version: "1.20.1",

messageDelay: 5 * 60 * 1000,
reconnectDelay: 60 * 1000

};

const MESSAGE_WEBHOOK_URL = "put webhook url in here";

/* ===================== TP WHITELIST ===================== */

function loadAllowedPlayers() {

    try {

        const filePath = path.join(__dirname, "advertise-bots", "allowed-tps.json");

        const data = fs.readFileSync(filePath, "utf8");

        return JSON.parse(data).allowed.map(p => p.toLowerCase());

    } catch (err) {

        console.log("Could not read allowed-tps.json", err.message);

        return [];

    }

}

/* ===================== STATE ===================== */

let bot;
let messageTimer;
let reconnectTimeout;
let authStarted = false;

/* ===================== DISCORD ===================== */

async function sendChatToDiscord(message) {
try {
await fetch(MESSAGE_WEBHOOK_URL, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
username: config.username,
embeds: [{
title: "Bot Message",
description: message
}]
})
});
} catch (err) {
console.log("Webhook error:", err.message);
}
}

/* ===================== CHAT BOT ===================== */

function startMessaging() {

if (messageTimer) clearInterval(messageTimer);

messageTimer = setInterval(() => {

    const messages = [
        "put advertise message here",
        "this bot is amde by Mr_penguin5566"
    ];

    const msg = messages[Math.floor(Math.random() * messages.length)];

    console.log("Sending message:", msg);

    bot.chat(msg);

    sendChatToDiscord(msg);

}, config.messageDelay);

}

/* ===================== BOT CREATION ===================== */

function createBot() {

authStarted = false;

bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version
});

bot.loadPlugin(pathfinder);

console.log("Starting bot...");

bot.on("login", () => {
    console.log("Bot logged into server");
});

bot.on("spawn", async () => {

    console.log("Bot spawned");

    if (authStarted) return;
    authStarted = true;

    const auth = new Auth(bot, config.password);

    try {

        await auth.main();

        console.log("Bot logged in and ready");

        startMessaging();

    } catch (err) {

        console.log("Login failed:", err);

    }

});

/* ===================== TP LISTENER ===================== */

bot.on("messagestr", (message) => {

    const allowedPlayers = loadAllowedPlayers();

    const match = message.match(/^(\w+) wants to teleport to you/i);

    if (!match) return;

    const player = match[1];
    const playerLower = player.toLowerCase();

    console.log(`TP request from ${player}`);

    if (allowedPlayers.includes(playerLower)) {

        console.log(`Accepting TP from ${player}`);

        bot.chat(`/tpy ${player}`);

    } else {

        console.log(`Denied TP from ${player}`);

        bot.chat(`/tpn ${player}`);

    }

});

bot.on("death", () => {
    console.log("Bot died — respawning");
    bot.respawn();
});

bot.on("end", () => {

    console.log("Bot disconnected");

    authStarted = false;

    if (messageTimer) clearInterval(messageTimer);

    if (reconnectTimeout) return;

    console.log("Reconnecting in 60 seconds...");

    reconnectTimeout = setTimeout(() => {

        reconnectTimeout = null;
        createBot();

    }, config.reconnectDelay);

});

bot.on("kicked", reason => {
    console.log("Bot was kicked:", reason);
});

bot.on("error", err => {
    console.log("Error:", err.message);
});

}

createBot();