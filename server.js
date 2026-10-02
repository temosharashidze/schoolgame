const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const rooms = new Map();

const TICK_RATE = 30;
const WORLD_W = 1600;
const WORLD_H = 900;

const PLAYER_RADIUS = 24;
const BULLET_SPEED = 950;
const BULLET_DAMAGE = 25;

const MAX_SCORE = 10;

const server = http.createServer((req, res) => {
    let file = req.url === "/" ? "/GAME3.html" : req.url;

    if (file.includes("?")) {
        file = file.split("?")[0];
    }

    const filePath = path.join(__dirname, file);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        let type = "text/html";

        if (filePath.endsWith(".js")) {
            type = "application/javascript";
        }

        if (filePath.endsWith(".css")) {
            type = "text/css";
        }

        res.writeHead(200, {
            "Content-Type": type
        });

        res.end(data);
    });
});

const wss = new WebSocket.Server({
    server
});

function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }

    return code;
}

function createRoom() {
    let code;

    do {
        code = randomCode();
    } while (rooms.has(code));

    const room = {
        code,
        players: new Map(),
        bot: null,

        bullets: [],

        score: {
            p1: 0,
            p2: 0
        },

        started: false
    };

    rooms.set(code, room);

    return room;
}

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(room, data) {
    for (const player of room.players.values()) {
        send(player.ws, data);
    }
}

function spawnPosition(id) {
    if (id === "p1") {
        return {
            x: 260,
            y: WORLD_H / 2
        };
    }

    return {
        x: WORLD_W - 260,
        y: WORLD_H / 2
    };
}

function createPlayer(id, ws, name) {
    const spawn = spawnPosition(id);

    return {
        id,
        ws,

        name: name || id.toUpperCase(),

        x: spawn.x,
        y: spawn.y,

        angle: id === "p1" ? 0 : Math.PI,

        hp: 100,

        kills: 0,
        deaths: 0,

        keys: {
            w: false,
            a: false,
            s: false,
            d: false
        },

        shooting: false,
        lastShot: 0,

        speed: 320,

        alive: true,

        respawnAt: 0
    };
}

function createBot() {
    const spawn = spawnPosition("p2");

    return {
        id: "bot",

        name: "BOT",

        x: spawn.x,
        y: spawn.y,

        angle: Math.PI,

        hp: 100,

        kills: 0,
        deaths: 0,

        alive: true,

        lastShot: 0,

        targetX: spawn.x,
        targetY: spawn.y,

        respawnAt: 0
    };
}

function resetPlayer(player) {
    const spawn = spawnPosition(player.id);

    player.x = spawn.x;
    player.y = spawn.y;

    player.hp = 100;

    player.alive = true;

    player.respawnAt = 0;

    player.shooting = false;
}

function resetBot(bot) {
    bot.x = WORLD_W - 260;
    bot.y = WORLD_H / 2;

    bot.hp = 100;

    bot.alive = true;

    bot.lastShot = 0;

    bot.respawnAt = 0;
}

function roomState(room) {
    const players = [];

    for (const p of room.players.values()) {
        players.push({
            id: p.id,
            name: p.name,

            x: p.x,
            y: p.y,

            angle: p.angle,

            hp: p.hp,

            kills: p.kills,
            deaths: p.deaths,

            alive: p.alive
        });
    }

    if (room.bot) {
        players.push({
            id: "bot",
            name: "BOT",

            x: room.bot.x,
            y: room.bot.y,

            angle: room.bot.angle,

            hp: room.bot.hp,

            kills: room.bot.kills,
            deaths: room.bot.deaths,

            alive: room.bot.alive
        });
    }

    return {
        type: "state",

        players,

        bullets: room.bullets.map(b => ({
            id: b.id,
            x: b.x,
            y: b.y
        })),

        score: room.score,

        lobby: room.players.size < 2 && !room.bot
    };
}

function announce(room, message) {
    broadcast(room, {
        type: "message",
        message
    });
}

function addBot(room) {
    if (room.bot) {
        return false;
    }

    if (room.players.size >= 2) {
        return false;
    }

    room.bot = createBot();

    room.started = true;

    announce(
        room,
        "🤖 BOT შემოვიდა! თამაში იწყება!"
    );

    broadcast(room, {
        type: "bot_joined"
    });

    return true;
}

function removeBot(room) {
    if (!room.bot) {
        return;
    }

    room.bot = null;

    room.started = false;

    broadcast(room, {
        type: "bot_left"
    });
}

function killPlayer(room, victim, attackerId) {
    victim.alive = false;

    victim.deaths++;

    victim.hp = 0;

    if (attackerId === "p1") {
        room.score.p1++;
    }

    if (
        attackerId === "p2" ||
        attackerId === "bot"
    ) {
        room.score.p2++;
    }

    let attackerName = attackerId.toUpperCase();

    if (attackerId === "bot") {
        attackerName = "BOT";
    }

    announce(
        room,
        "💀 " +
        victim.name +
        " მოკლა " +
        attackerName
    );

    if (
        room.score.p1 >= MAX_SCORE ||
        room.score.p2 >= MAX_SCORE
    ) {
        const winner =
            room.score.p1 >= MAX_SCORE
                ? "p1"
                : "p2";

        broadcast(room, {
            type: "game_over",
            winner
        });

        setTimeout(() => {
            if (!rooms.has(room.code)) {
                return;
            }

            room.score.p1 = 0;
            room.score.p2 = 0;

            room.bullets = [];

            for (const p of room.players.values()) {
                resetPlayer(p);

                p.kills = 0;
                p.deaths = 0;
            }

            if (room.bot) {
                resetBot(room.bot);

                room.bot.kills = 0;
                room.bot.deaths = 0;
            }

            announce(
                room,
                "🔄 ახალი რაუნდი დაიწყო!"
            );
        }, 3500);

        return;
    }

    victim.respawnAt = Date.now() + 1500;

    if (attackerId === "p1") {
        const attacker = room.players.get("p1");

        if (attacker) {
            attacker.kills++;
        }
    }

    if (
        attackerId === "p2" ||
        attackerId === "bot"
    ) {
        if (attackerId === "bot") {
            if (room.bot) {
                room.bot.kills++;
            }
        } else {
            const attacker = room.players.get("p2");

            if (attacker) {
                attacker.kills++;
            }
        }
    }
}

function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(dx * dx + dy * dy);
}

function shoot(room, shooter) {
    if (!shooter.alive) {
        return;
    }

    const now = Date.now();

    if (now - shooter.lastShot < 180) {
        return;
    }

    shooter.lastShot = now;

    const bullet = {
        id: Math.random()
            .toString(36)
            .slice(2),

        owner: shooter.id,

        x:
            shooter.x +
            Math.cos(shooter.angle) *
            (PLAYER_RADIUS + 12),

        y:
            shooter.y +
            Math.sin(shooter.angle) *
            (PLAYER_RADIUS + 12),

        vx:
            Math.cos(shooter.angle) *
            BULLET_SPEED,

        vy:
            Math.sin(shooter.angle) *
            BULLET_SPEED
    };

    room.bullets.push(bullet);
}

function updateBot(room) {
    const bot = room.bot;

    if (!bot) {
        return;
    }

    if (!bot.alive) {
        if (
            bot.respawnAt &&
            Date.now() >= bot.respawnAt
        ) {
            resetBot(bot);
        }

        return;
    }

    const target =
        room.players.values().next().value;

    if (!target || !target.alive) {
        return;
    }

    const dx = target.x - bot.x;
    const dy = target.y - bot.y;

    const dist = Math.sqrt(
        dx * dx +
        dy * dy
    );

    if (dist <= 0) {
        return;
    }

    bot.angle = Math.atan2(
        dy,
        dx
    );

    if (dist > 330) {
        bot.x +=
            (dx / dist) *
            150 /
            TICK_RATE;

        bot.y +=
            (dy / dist) *
            150 /
            TICK_RATE;
    }

    if (dist < 850) {
        shoot(room, bot);
    }

    bot.x = Math.max(
        PLAYER_RADIUS,
        Math.min(
            WORLD_W - PLAYER_RADIUS,
            bot.x
        )
    );

    bot.y = Math.max(
        PLAYER_RADIUS,
        Math.min(
            WORLD_H - PLAYER_RADIUS,
            bot.y
        )
    );
}

function updateRoom(room) {
    for (const player of room.players.values()) {
        if (!player.alive) {
            if (
                player.respawnAt &&
                Date.now() >= player.respawnAt
            ) {
                resetPlayer(player);
            }

            continue;
        }

        let dx = 0;
        let dy = 0;

        if (player.keys.w) dy--;
        if (player.keys.s) dy++;

        if (player.keys.a) dx--;
        if (player.keys.d) dx++;

        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(
                dx * dx +
                dy * dy
            );

            dx /= len;
            dy /= len;

            player.x +=
                dx *
                player.speed /
                TICK_RATE;

            player.y +=
                dy *
                player.speed /
                TICK_RATE;
        }

        player.x = Math.max(
            PLAYER_RADIUS,
            Math.min(
                WORLD_W - PLAYER_RADIUS,
                player.x
            )
        );

        player.y = Math.max(
            PLAYER_RADIUS,
            Math.min(
                WORLD_H - PLAYER_RADIUS,
                player.y
            )
        );

        if (player.shooting) {
            shoot(room, player);
        }
    }

    updateBot(room);

    for (
        let i = room.bullets.length - 1;
        i >= 0;
        i--
    ) {
        const bullet = room.bullets[i];

        bullet.x +=
            bullet.vx /
            TICK_RATE;

        bullet.y +=
            bullet.vy /
            TICK_RATE;

        if (
            bullet.x < 0 ||
            bullet.x > WORLD_W ||
            bullet.y < 0 ||
            bullet.y > WORLD_H
        ) {
            room.bullets.splice(i, 1);
            continue;
        }

        const targets = [];

        for (const p of room.players.values()) {
            targets.push(p);
        }

        if (room.bot) {
            targets.push(room.bot);
        }

        let hit = false;

        for (const target of targets) {
            if (!target.alive) {
                continue;
            }

            if (target.id === bullet.owner) {
                continue;
            }

            const dx =
                bullet.x -
                target.x;

            const dy =
                bullet.y -
                target.y;

            const d = Math.sqrt(
                dx * dx +
                dy * dy
            );

            if (d < PLAYER_RADIUS) {
                target.hp -= BULLET_DAMAGE;

                if (target.hp <= 0) {
                    killPlayer(
                        room,
                        target,
                        bullet.owner
                    );
                }

                room.bullets.splice(i, 1);

                hit = true;

                break;
            }
        }

        if (hit) {
            continue;
        }
    }
}

wss.on("connection", ws => {
    let currentRoom = null;
    let currentPlayer = null;

    send(ws, {
        type: "connected"
    });

    ws.on("message", raw => {
        let data;

        try {
            data = JSON.parse(
                raw.toString()
            );
        } catch {
            return;
        }

        /*
        ==========================
        CREATE ROOM
        ==========================
        */

        if (data.type === "create_room") {
            if (currentRoom) {
                return;
            }

            const room = createRoom();

            currentRoom = room;

            currentPlayer = createPlayer(
                "p1",
                ws,
                String(
                    data.name ||
                    "PLAYER 1"
                ).slice(0, 16)
            );

            room.players.set(
                "p1",
                currentPlayer
            );

            send(ws, {
                type: "room_created",

                room: room.code,

                playerId: "p1"
            });

            /*
            IMPORTANT:
            აქ BOT აღარ შემოდის ავტომატურად.
            მოთამაშე რჩება LOBBY-ში.
            */

            return;
        }

        /*
        ==========================
        JOIN ROOM
        ==========================
        */

        if (data.type === "join_room") {
            if (currentRoom) {
                return;
            }

            const code = String(
                data.room || ""
            )
                .trim()
                .toUpperCase();

            const room = rooms.get(code);

            if (!room) {
                send(ws, {
                    type: "error",
                    message:
                        "ოთახი ვერ მოიძებნა."
                });

                return;
            }

            if (room.players.size >= 2) {
                send(ws, {
                    type: "error",
                    message:
                        "ოთახი უკვე სავსეა."
                });

                return;
            }

            /*
            თუ BOT უკვე არის,
            რეალური მოთამაშე მას ანაცვლებს.
            */

            if (room.bot) {
                removeBot(room);
            }

            currentRoom = room;

            currentPlayer = createPlayer(
                "p2",
                ws,
                String(
                    data.name ||
                    "PLAYER 2"
                ).slice(0, 16)
            );

            room.players.set(
                "p2",
                currentPlayer
            );

            room.started = true;

            send(ws, {
                type: "room_joined",

                room: room.code,

                playerId: "p2"
            });

            announce(
                room,
                "⚔️ მეორე მოთამაშე შემოვიდა! თამაში იწყება!"
            );

            broadcast(room, {
                type: "game_started"
            });

            return;
        }

        /*
        ==========================
        CALL BOT
        ==========================
        */

        if (data.type === "add_bot") {
            if (!currentRoom || !currentPlayer) {
                return;
            }

            if (currentRoom.players.size >= 2) {
                return;
            }

            if (currentRoom.bot) {
                return;
            }

            addBot(currentRoom);

            return;
        }

        /*
        ==========================
        INPUT
        ==========================
        */

        if (data.type === "input") {
            if (!currentRoom || !currentPlayer) {
                return;
            }

            const k = data.keys || {};

            currentPlayer.keys.w =
                !!k.w;

            currentPlayer.keys.a =
                !!k.a;

            currentPlayer.keys.s =
                !!k.s;

            currentPlayer.keys.d =
                !!k.d;

            if (
                typeof data.angle ===
                "number"
            ) {
                currentPlayer.angle =
                    data.angle;
            }

            currentPlayer.shooting =
                !!data.shooting;

            return;
        }

        /*
        ==========================
        SHOOT
        ==========================
        */

        if (data.type === "shoot") {
            if (!currentRoom || !currentPlayer) {
                return;
            }

            shoot(
                currentRoom,
                currentPlayer
            );

            return;
        }
    });

    /*
    ==========================
    PLAYER DISCONNECT
    ==========================
    */

    ws.on("close", () => {
        if (
            !currentRoom ||
            !currentPlayer
        ) {
            return;
        }

        currentRoom.players.delete(
            currentPlayer.id
        );

        currentRoom.bullets = [];

        /*
        თუ ოთახში აღარავინ დარჩა,
        ოთახიც წაიშლება.
        */

        if (
            currentRoom.players.size === 0
        ) {
            rooms.delete(
                currentRoom.code
            );

            return;
        }

        /*
        დარჩა ერთი მოთამაშე.
        BOT ავტომატურად აღარ შემოვა.
        */

        if (currentRoom.bot) {
            removeBot(currentRoom);
        }

        currentRoom.started = false;

        announce(
            currentRoom,
            "👋 მოთამაშე გავიდა. ლობიში დაბრუნდი."
        );
    });
});

/*
==========================
GAME LOOP
==========================
*/

setInterval(() => {
    for (const room of rooms.values()) {
        updateRoom(room);

        broadcast(
            room,
            roomState(room)
        );
    }
}, 1000 / TICK_RATE);

/*
==========================
SERVER START
==========================
*/

server.listen(
    PORT,
    () => {
        console.log(
            `RIVALS server running on port ${PORT}`
        );
    }
);
