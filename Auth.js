const EventEmitter = require("events")
const { GoalBlock } = require("mineflayer-pathfinder").goals

class Auth extends EventEmitter {

    constructor(bot, password) {
        super()

        this.bot = bot

        this.config = {
        password: password,
        username: bot.username
        }

        this.state = {
            authenticated: false,
            ready: false,
            loginSent: false
        }
    }

    login() {
        if (this.state.loginSent) return

        this.state.loginSent = true

        console.log("Sending login command...")
        this.bot.chat(`/login ${this.config.password}`)
    }

    findPortal() {
        const portal = this.bot.findBlock({
            matching: this.bot.registry.blocksByName.nether_portal.id,
            maxDistance: 64
        })

        return portal || null
    }

    async enterPortal() {

        let portal = null

        while (!portal && !this.state.ready) {
            portal = this.findPortal()
            await new Promise(r => setTimeout(r, 200))
        }

        if (!portal) return

        console.log("Portal found:", portal.position)

        await this.bot.pathfinder.goto(
            new GoalBlock(
                portal.position.x,
                portal.position.y,
                portal.position.z
            )
        )

        console.log("Entered portal")
    }

    async main() {

        return new Promise((resolve, reject) => {

            const listener = async (msg) => {

                const text = msg.toLowerCase()

                if (!this.state.loginSent && text.includes("please login")) {
                    this.login()
                }

                if (!this.state.authenticated && text.includes("you are now logged in")) {

                    console.log("Login confirmed")

                    this.state.authenticated = true

                    await this.bot.waitForChunksToLoad()

                    await this.enterPortal()

                    await new Promise(r => setTimeout(r, 8000))

                    await this.enterPortal()
                }

                if (!this.state.ready && text.includes("welcome to 6b6t.org")) {

                    console.log("Successfully entered server")

                    this.state.ready = true

                    this.bot.removeListener("messagestr", listener)

                    this.emit("ready")

                    resolve()
                }
            }

            this.bot.on("messagestr", listener)

            setTimeout(() => {
                if (!this.state.authenticated) reject("Login timeout")
            }, 30000)

            setTimeout(() => {
                if (!this.state.ready) reject("Server entry timeout")
            }, 120000)

        })

    }

}

module.exports = Auth