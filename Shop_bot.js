const mineflayer = require('mineflayer')
const fs = require('fs')
const path = require('path')
const https = require('https')
const Auth = require('./Auth.js')

const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals

/* =======================
   📂 PATHS
   ======================= */

const CONFIG_PATH = path.join(__dirname, 'Shop_Bot_configs', 'config.json')
const STATE_PATH = path.join(__dirname, 'Shop_Bot_configs', 'bot_state.json')
const DISCORD_CONFIG_PATH = path.join(__dirname, 'Shop_Bot_configs', 'discord config.json')

/* =======================
   📄 LOADERS
   ======================= */

function loadConfig() {
  const fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return {
    ...fileConfig,
    username: "put username here",
    password: "put password here"
  }
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { start: false, items: [], discord_webhook: null }
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function getWebhookUrl() {
  try {
    const discordCfg = JSON.parse(fs.readFileSync(DISCORD_CONFIG_PATH, 'utf8'))
    if (discordCfg.discord_webhook) return discordCfg.discord_webhook
  } catch (e) {}
  // Fallback to bot_state.json
  try {
    const state = loadState()
    if (state.discord_webhook) return state.discord_webhook
  } catch (e) {}
  return null
}

let config = loadConfig()

fs.watchFile(CONFIG_PATH, () => {
  try {
    config = loadConfig()
    console.log('🔄 Config reloaded')
  } catch (e) {
    console.error('❌ Config reload failed:', e)
  }
})

/* =======================
   📦 INVENTORY HELPER
   ======================= */

const INVENTORY_SLOTS = 36 // Main inventory (27) + hotbar (9)

function calculateTotalSlots(items) {
  // items = [{ item_id: "diamond", quantity: 100 }, ...]
  let totalSlots = 0
  
  for (const item of items) {
    const stackSize = getStackSize(item.item_id)
    const stacks = Math.ceil(item.quantity / stackSize)
    totalSlots += stacks
  }
  
  return totalSlots
}

function getStackSize(itemId) {
  // Shulker boxes (all colors) - stack size 1
  if (itemId.includes('shulker_box')) {
    return 1
  }
  
  // Common stack sizes
  const stackSizes = {
    'ender_pearl': 16,
    'snowball': 16,
    'egg': 16,
    'bucket': 16,
    'sign': 16,
    'banner': 16,
    'potion': 1,
    'splash_potion': 1,
    'lingering_potion': 1,
    'enchanted_book': 1,
    'written_book': 16,
    'writable_book': 1
  }
  
  // Default stack size is 64
  return stackSizes[itemId] || 64
}

/* =======================
   🔔 DISCORD WEBHOOK
   ======================= */

function sendDiscordMessage(webhookUrl, message) {
  if (!webhookUrl) return
  
  const payload = JSON.stringify({
    content: message
  })
  
  const url = new URL(webhookUrl)
  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }
  
  const req = https.request(options, (res) => {
    console.log(`Discord webhook status: ${res.statusCode}`)
  })
  
  req.on('error', (e) => {
    console.error('Discord webhook error:', e)
  })
  
  req.write(payload)
  req.end()
}

/* =======================
   🤖 CREATE BOT
   ======================= */

let bot = null
let reconnectAttempts = 0
let kickCount = 0
const BASE_RECONNECT_DELAY = 5000 // 5 seconds base delay
const BACKOFF_INTERVAL = 10 // Add delay every 10 attempts
const BACKOFF_INCREMENT = 60000 // Add 1 minute (60 seconds) each time

function getReconnectDelay() {
  // Calculate how many backoff increments to add
  const backoffSteps = Math.floor(reconnectAttempts / BACKOFF_INTERVAL)
  const delay = BASE_RECONNECT_DELAY + (backoffSteps * BACKOFF_INCREMENT)
  return delay
}

function createBot() {
  console.log(`🔌 Connecting to ${config.host}:${config.port} as ${config.username}...`)
  
  bot = mineflayer.createBot({
    host: config.host || '6b6t.org',
    port: config.port || 25565,
    username: config.username || "PenguinShopBot",
    version: "1.20.1"
  })

  bot.loadPlugin(pathfinder)

  bot.on('error', (err) => {
    console.log('❌ Connection Error:', err.message || err)
    // Log more details for common issues
    if (err.message && err.message.includes('ENOTFOUND')) {
      console.log('   → Server hostname not found. Check if "6b6t.org" is correct.')
    } else if (err.message && err.message.includes('ECONNREFUSED')) {
      console.log('   → Connection refused. Server might be down or port is wrong.')
    } else if (err.message && err.message.includes('ETIMEDOUT')) {
      console.log('   → Connection timeout. Server might be unreachable.')
    }
  })

  bot.on('kicked', (reason) => {
    kickCount++
    console.log('👢 Bot was kicked:', reason)
    const webhookUrl = getWebhookUrl()
    if (webhookUrl && kickCount % 20 === 0) {
      sendDiscordMessage(webhookUrl, `👢 **Bot Kicked (x${kickCount})**\nReason: ${reason}`)
    }
  })

  bot.on('end', () => {
    const serverAddress = `${config.host}:${config.port}`
    console.log(`🛑 Bot disconnected from ${serverAddress}`)
    
    // Reset state flags
    ready = false
    loggedIn = false
    loginDone = false
    authStarted = false
    
    // Attempt to reconnect (infinite attempts with progressive backoff)
    reconnectAttempts++
    const delay = getReconnectDelay()
    const delaySeconds = Math.round(delay / 1000)
    
    console.log(`🔄 Reconnect attempt #${reconnectAttempts} in ${delaySeconds} seconds...`)

    // Only send Discord disconnect notification every 20 disconnects
    const webhookUrl = getWebhookUrl()
    if (webhookUrl && reconnectAttempts % 20 === 0) {
      sendDiscordMessage(
        webhookUrl,
        `🛑 **Bot Disconnected (x${reconnectAttempts})**\nServer: ${serverAddress}\nStill attempting to reconnect...\nCurrent delay: ${delaySeconds}s`
      )
    }
    
    setTimeout(() => {
      createBot()
    }, delay)
  })

  bot.once('spawn', async () => {
    const serverAddress = `${config.host}:${config.port}`
    console.log(`🌍 Bot spawned on ${serverAddress}`)
    
    // Reset reconnect counter on successful connection
    if (reconnectAttempts > 0) {
      console.log(`✅ Bot reconnected to ${serverAddress} after ${reconnectAttempts} attempt(s)`)
      const webhookUrl = getWebhookUrl()
      if (webhookUrl) {
        sendDiscordMessage(
          webhookUrl,
          `✅ **Bot Reconnected**\n` +
          `Server: ${serverAddress}\n` +
          `Successfully reconnected after ${reconnectAttempts} attempt(s).\n` +
          `Reconnect delay reset to ${BASE_RECONNECT_DELAY/1000} seconds.`
        )
      }
      reconnectAttempts = 0 // Reset counter
      kickCount = 0
    }
    
    const mcData = require('minecraft-data')(bot.version)
    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)

    if (authStarted) return
    authStarted = true

    const auth = new Auth(bot, config.password)

    try {
      await auth.main()
      console.log('🔐 Auth complete — bot logged in and ready')
      loggedIn = true
      loginDone = true
      ready = true
      console.log('✅ Bot ready')
    } catch (err) {
      console.log('❌ Login failed:', err)
    }
  })

  bot.on('message', msg => {
    const text = msg.toString().toLowerCase()
    // Kept for debug visibility only — auth is handled by Auth class
    if (text.includes('/login')) {
      console.log('🔐 Login prompt detected (handled by Auth)')
    }
  })
}

const wait = ms => new Promise(r => setTimeout(r, ms))

let running = false
let ready = false
let loggedIn = false
let loginDone = false
let authStarted = false

// Create the initial bot instance
createBot()

/* =======================
   👀 LOOK AT NEAREST PLAYER
   ======================= */

function lookAtNearestPlayer() {
  const players = Object.values(bot.players)
  if (!players.length) return

  let nearest = null
  let nearestDist = Infinity

  for (const p of players) {
    if (!p.entity) continue
    if (p.username === bot.username) continue

    const dist = bot.entity.position.distanceTo(p.entity.position)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = p.entity
    }
  }

  if (nearest) {
    bot.lookAt(nearest.position.offset(0, nearest.height || 1.6, 0), true)
  }
}

/* =======================
   📦 FIND & GRAB ITEMS (MULTI-ITEM)
   ======================= */

async function gotoWithTimeout(goal, timeout = 15000) {

  return Promise.race([
    bot.pathfinder.goto(goal),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Pathfinder timeout")), timeout)
    )
  ])
}

async function grabItemsFromChests(itemsList) {

  const itemsToGrab = {}

  for (const item of itemsList) {
    itemsToGrab[item.item_id] = {
      needed: item.quantity,
      grabbed: 0
    }
  }

  const webhookUrl = getWebhookUrl()

  let emptyChestCounter = 0
  let searchRadius = config.chest_search_distance || 6
  const openedChests = new Set()

  console.log('📦 Starting smart infinite chest search...')

  while (Object.values(itemsToGrab).some(i => i.grabbed < i.needed)) {

    config = loadConfig() // 🔥 LIVE CONFIG RELOAD

    const chestBlocks = bot.findBlocks({
      matching: block => block.name.includes('chest'),
      maxDistance: searchRadius,
      count: 500
    })

    // 🔥 If none found → EXPAND SEARCH
    if (chestBlocks.length === 0) {

      searchRadius += 6
      console.log(`🔍 No chests found. Expanding radius → ${searchRadius}`)

      await wait(1500)
      continue
    }

    for (const pos of chestBlocks) {

      const stillNeed = Object.values(itemsToGrab)
        .some(item => item.grabbed < item.needed)

      if (!stillNeed) break

      const chestKey = `${pos.x},${pos.y},${pos.z}`

      if (openedChests.has(chestKey)) continue

      const chestBlock = bot.blockAt(pos)
      if (!chestBlock) continue

      try {

        openedChests.add(chestKey)

        // 🔥 WALK TO CHEST
        await gotoWithTimeout(
          new GoalNear(pos.x, pos.y, pos.z, 2),
          15000
        )

        await bot.lookAt(chestBlock.position.offset(0.5, 0.5, 0.5), true)
        await wait(config.delay_after_chest_open || 400)

        const chest = await bot.openContainer(chestBlock)

        const containerItems = chest.containerItems()

        let foundSomething = false

        for (const [itemId, itemInfo] of Object.entries(itemsToGrab)) {

          if (itemInfo.grabbed >= itemInfo.needed) continue

          const remaining = itemInfo.needed - itemInfo.grabbed

          const matches = containerItems?.filter(i => i?.name === itemId) || []


          if (matches.length > 0) {

            searchRadius = config.chest_search_distance || 6

            foundSomething = true
            emptyChestCounter = 0

            console.log(`✨ Found ${itemId}`)

            for (const item of matches) {

              if (itemInfo.grabbed >= itemInfo.needed) break

              const take = Math.min(item.count, remaining)

              await chest.withdraw(item.type, item.metadata, take)

              itemInfo.grabbed += take

              console.log(
                `📦 ${itemInfo.grabbed}/${itemInfo.needed} ${itemId}`
              )

              await wait(100)
            }
          }
        }

        if (!foundSomething) {

          emptyChestCounter++

          if (emptyChestCounter >= 10) {

            console.log('⚠️ 10 empty chests opened — still searching.')

            if (webhookUrl) {
              sendDiscordMessage(
                webhookUrl,
                `⚠️ **Stock Warning**\nOpened 10 chests without finding items.\nBot is expanding search and continuing.\nMay need to be restocked not the biggest issue yet.\nIf repeatedly happening issue may be stock or bot stuck.`
              )
            }

            emptyChestCounter = 0

            // 🔥 Expand search automatically
            searchRadius += 6
            console.log(`🔍 Increasing radius → ${searchRadius}`)
          }
        }

        chest.close()
        await wait(150)

      } catch (err) {

        console.log('Chest/path error:', err.message)

        // If pathfinder fails → expand search
        searchRadius += 4
      }
    }

    // Prevent memory bloat
    if (openedChests.size > 800) {
      openedChests.clear()
      console.log('🔄 Reset chest memory')
    }

    await wait(500)
  }

  console.log('✅ ALL ITEMS COLLECTED')

  return Object.entries(itemsToGrab).map(([itemId, info]) => ({
    item_id: itemId,
    requested: info.needed,
    grabbed: info.grabbed
  }))
}

/* =======================
   🚚 DELIVERY LOGIC
   ======================= */

async function runDelivery() {
  if (running || !ready || !loggedIn) return
  running = true

  config = loadConfig()
  console.log('🔄 Loaded latest config for delivery')

  const state = loadState()
  const itemsList = state.items || []
  
  if (itemsList.length === 0) {
    console.log('❌ No items to deliver. Use /additem in Discord first!')
    running = false
    saveState({ start: false, items: [] })
    return
  }

  console.log(`🚀 Starting delivery of ${itemsList.length} item type(s)`)
  itemsList.forEach(item => {
    console.log(`   - ${item.quantity}x ${item.item_id}`)
  })

  try {
    await wait(config.delay_after_spawn || 2000)

    if (config.command_1) {
      bot.chat(config.command_1)
      console.log(`📡 Command 1: ${config.command_1}`)
    }
    await wait(config.delay_after_command_1 || 1000)

    // 🔥 GRAB ITEMS
    const results = await grabItemsFromChests(itemsList)
    
    console.log('✅ Grab results:')
    for (const r of results) {
      console.log(`   ${r.item_id}: ${r.grabbed}/${r.requested}`)
    }

    // 🔥 COMMAND 2 AFTER GRAB
    if (config.command_2) {
      bot.chat(config.command_2)
      console.log(`📡 Command 2: ${config.command_2}`)
    }
    await wait(config.delay_after_command_2 || 1000)

    await wait(config.delay_before_drop || 1000)
    await lookAtNearestPlayer()
    await wait(300)

    // 🔥 DROP ALL GRABBED ITEMS
    let totalDropped = 0
    
    for (const itemData of itemsList) {
      const itemsToDrop = bot.inventory.items().filter(
        i => i.name === itemData.item_id
      )

      for (const item of itemsToDrop) {
        await bot.toss(item.type, item.metadata, item.count)
        totalDropped += item.count
        console.log(`⬇  Dropped ${item.count}x ${item.name}`)
        await wait(800)
      }
    }

    console.log(`✅ Dropped total: ${totalDropped} items`)

    await wait(config.delay_before_command_3 || 500)
    if (config.command_3) {
      bot.chat(config.command_3)
      console.log(`📡 Command 3: ${config.command_3}`)
    }

    console.log('🎉 Delivery complete')

  } catch (err) {
    console.error('❌ Delivery error:', err)
    
    // Send error to Discord
    const webhookUrl = getWebhookUrl()
    if (webhookUrl) {
      sendDiscordMessage(webhookUrl, `❌ **Delivery Failed**\n${err}`)
    }
  }

  saveState({ start: false, items: [] })
  running = false
}

/* =======================
   👂 WATCH START FLAG
   ======================= */

setInterval(() => {
  const state = loadState()
  if (state.start === true) {
    const itemsList = state.items || []
    
    if (itemsList.length === 0) {
      console.log('❌ No items configured. Use /additem in Discord first!')
      saveState({ start: false, items: [] })
      return
    }
    
    // Check inventory capacity
    const totalSlots = calculateTotalSlots(itemsList)
    
    if (totalSlots > INVENTORY_SLOTS) {
      console.error(`❌ Too many items! Needs ${totalSlots} slots, only have ${INVENTORY_SLOTS}`)
      
      const webhookUrl = getWebhookUrl()
      if (webhookUrl) {
        const itemsListText = itemsList.map(i => `${i.quantity}x ${i.item_id}`).join(', ')
        sendDiscordMessage(
          webhookUrl,
          `❌ **Order Too Large!**\n` +
          `Items: ${itemsListText}\n` +
          `Required slots: ${totalSlots}\n` +
          `Available slots: ${INVENTORY_SLOTS}\n` +
          `Please reduce the order size.`
        )
      }
      
      saveState({ start: false, items: [] })
    } else {
      runDelivery()
    }
  }
}, 1000)