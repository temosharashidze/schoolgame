const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const MAX_SCORE = 10;

const WORLD = {
    width: 1600,
    height: 900
};

/* =========================================================
   MAP
========================================================= */

const WALLS = [
    // Outer walls
    { x: 0, y: 0, w: 1600, h: 30 },
    { x: 0, y: 870, w: 1600, h: 30 },
    { x: 0, y: 0, w: 30, h: 900 },
    { x: 1570, y: 0, w: 30, h: 900 },

    // Inner walls
    { x: 650, y: 100, w: 300, h: 35 },
    { x: 650, y: 765, w: 300, h: 35 },
    { x: 770, y: 300, w: 60, h: 300 }
];

const SPAWNS = {
    p1: {
        x: 220,
        y: 450
    },

    p2: {
        x: 1380,
        y: 450
    },

    bot: {
        x: 1380,
        y: 450
    }
};

/* =========================================================
   SERVER
========================================================= */

const server = http.createServer((req, res) => {

    let file =
        req.url === "/"
            ? "/index.html"
            : req.url.split("?")[0];

    try {
        file = decodeURIComponent(file);
    } catch {
        res.writeHead(400);
        res.end("Bad request");
        return;
    }

    const filePath =
        path.join(__dirname, file);

    if (
        !filePath.startsWith(__dirname)
    ) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (err, data) => {

        if (err) {

            res.writeHead(404, {
                "Content-Type":
                    "text/plain; charset=utf-8"
            });

            res.end("Not found");

            return;
        }

        let contentType =
            "text/plain; charset=utf-8";

        if (file.endsWith(".html")) {
            contentType =
                "text/html; charset=utf-8";
        }

        if (file.endsWith(".js")) {
            contentType =
                "application/javascript";
        }

        if (file.endsWith(".css")) {
            contentType =
                "text/css";
        }

        res.writeHead(200, {
            "Content-Type": contentType
        });

        res.end(data);

    });

});

const wss =
    new WebSocket.Server({
        server
    });

/* =========================================================
   ROOMS
========================================================= */

const rooms = new Map();

function randomRoomCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    do {

        code = "";

        for (let i = 0; i < 5; i++) {

            code +=
                chars[
                    Math.floor(
                        Math.random() *
                        chars.length
                    )
                ];

        }

    } while (rooms.has(code));

    return code;
}

/* =========================================================
   PLAYER
========================================================= */

function createPlayer(
    id,
    name,
    isBot = false
) {

    const spawn =
        SPAWNS[id] ||
        SPAWNS.bot;

    return {

        id,

        name:
            name ||
            (isBot
                ? "BOT"
                : "PLAYER"),

        x: spawn.x,

        y: spawn.y,

        angle:
            id === "p1"
                ? 0
                : Math.PI,

        hp: 100,

        alive: true,

        shooting: false,

        isBot,

        keys: {
            w: false,
            a: false,
            s: false,
            d: false
        },

        shootCooldown: 0,

        respawnTimer: 0,

        botThink: 0,

        botDirection: 1

    };

}

/* =========================================================
   ROOM
========================================================= */

function createRoom() {

    const code =
        randomRoomCode();

    const room = {

        code,

        players: new Map(),

        bot: null,

        bullets: [],

        score: {
            p1: 0,
            p2: 0
        },

        started: false,

        gameOver: false

    };

    rooms.set(
        code,
        room
    );

    return room;

}

/* =========================================================
   SOCKET HELPERS
========================================================= */

function send(ws, data) {

    if (
        ws &&
        ws.readyState ===
        WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(data)
        );

    }

}

function broadcast(
    room,
    data
) {

    for (
        const player
        of room.players.values()
    ) {

        send(
            player.ws,
            data
        );

    }

}

/* =========================================================
   ALL PLAYERS
========================================================= */

function allPlayers(room) {

    const list =
        Array.from(
            room.players.values()
        );

    if (room.bot) {
        list.push(room.bot);
    }

    return list;

}

/* =========================================================
   START GAME
========================================================= */

function startGame(room) {

    if (
        room.players.size +
        (room.bot ? 1 : 0) <
        2
    ) {
        return;
    }

    room.started = true;

    room.gameOver = false;

    room.bullets = [];

    room.score.p1 = 0;
    room.score.p2 = 0;

    const players =
        allPlayers(room);

    for (const p of players) {

        respawnPlayer(
            p
        );

    }

    broadcast(
        room,
        {
            type: "message",
            message:
                "🔥 მატჩი დაიწყო!"
        }
    );

}

/* =========================================================
   RESPAWN
========================================================= */

function respawnPlayer(p) {

    const spawn =
        SPAWNS[p.id] ||
        SPAWNS.bot;

    p.x = spawn.x;
    p.y = spawn.y;

    p.angle =
        p.id === "p1"
            ? 0
            : Math.PI;

    p.hp = 100;

    p.alive = true;

    p.shooting = false;

    p.respawnTimer = 0;

}

/* =========================================================
   COLLISION
========================================================= */

function circleRectCollision(
    x,
    y,
    radius,
    rect
) {

    const closestX =
        Math.max(
            rect.x,
            Math.min(
                x,
                rect.x + rect.w
            )
        );

    const closestY =
        Math.max(
            rect.y,
            Math.min(
                y,
                rect.y + rect.h
            )
        );

    const dx =
        x - closestX;

    const dy =
        y - closestY;

    return (
        dx * dx +
        dy * dy
    ) <
    radius * radius;

}

function canMove(
    x,
    y,
    radius
) {

    if (
        x - radius < 35 ||
        x + radius > 1565 ||
        y - radius < 35 ||
        y + radius > 865
    ) {
        return false;
    }

    for (
        const wall
        of WALLS
    ) {

        if (
            circleRectCollision(
                x,
                y,
                radius,
                wall
            )
        ) {

            return false;

        }

    }

    return true;

}

function movePlayer(
    p,
    dx,
    dy
) {

    const radius = 22;

    const newX =
        p.x + dx;

    if (
        canMove(
            newX,
            p.y,
            radius
        )
    ) {

        p.x = newX;

    }

    const newY =
        p.y + dy;

    if (
        canMove(
            p.x,
            newY,
            radius
        )
    ) {

        p.y = newY;

    }

}

/* =========================================================
   BULLET / WALL
========================================================= */

function pointInsideWall(
    x,
    y
) {

    for (
        const wall
        of WALLS
    ) {

        if (
            x >= wall.x &&
            x <= wall.x + wall.w &&
            y >= wall.y &&
            y <= wall.y + wall.h
        ) {

            return true;

        }

    }

    return false;

}

/* =========================================================
   SHOOT
========================================================= */

function shoot(
    room,
    shooter
) {

    if (
        !shooter.alive
    ) {
        return;
    }

    if (
        shooter.shootCooldown > 0
    ) {
        return;
    }

    shooter.shootCooldown =
        shooter.isBot
            ? 0.45
            : 0.20;

    const speed =
        shooter.isBot
            ? 760
            : 900;

    const offset = 30;

    room.bullets.push({

        id:
            Math.random()
                .toString(36)
                .slice(2),

        owner:
            shooter.id,

        x:
            shooter.x +
            Math.cos(
                shooter.angle
            ) *
            offset,

        y:
            shooter.y +
            Math.sin(
                shooter.angle
            ) *
            offset,

        vx:
            Math.cos(
                shooter.angle
            ) *
            speed,

        vy:
            Math.sin(
                shooter.angle
            ) *
            speed,

        life: 1.2

    });

}

/* =========================================================
   BOT
========================================================= */

function updateBot(
    room,
    dt
) {

    if (
        !room.bot ||
        !room.bot.alive ||
        !room.started
    ) {
        return;
    }

    const targets =
        Array.from(
            room.players.values()
        )
        .filter(
            p => p.alive
        );

    if (
        targets.length === 0
    ) {
        return;
    }

    let target =
        targets[0];

    let bestDistance =
        Infinity;

    for (
        const p
        of targets
    ) {

        const dx =
            p.x -
            room.bot.x;

        const dy =
            p.y -
            room.bot.y;

        const distance =
            Math.hypot(
                dx,
                dy
            );

        if (
            distance <
            bestDistance
        ) {

            bestDistance =
                distance;

            target =
                p;

        }

    }

    const dx =
        target.x -
        room.bot.x;

    const dy =
        target.y -
        room.bot.y;

    const distance =
        Math.hypot(
            dx,
            dy
        );

    const targetAngle =
        Math.atan2(
            dy,
            dx
        );

    room.bot.angle =
        targetAngle;

    let moveX = 0;
    let moveY = 0;

    if (distance > 300) {

        moveX =
            Math.cos(
                targetAngle
            );

        moveY =
            Math.sin(
                targetAngle
            );

    } else if (
        distance < 170
    ) {

        moveX =
            -Math.cos(
                targetAngle
            );

        moveY =
            -Math.sin(
                targetAngle
            );

    } else {

        moveX =
            Math.cos(
                targetAngle +
                Math.PI / 2
            ) *
            0.45;

        moveY =
            Math.sin(
                targetAngle +
                Math.PI / 2
            ) *
            0.45;

    }

    const speed = 145;

    movePlayer(
        room.bot,
        moveX *
            speed *
            dt,

        moveY *
            speed *
            dt
    );

    room.bot.shooting =
        distance < 900;

    if (
        room.bot.shooting
    ) {

        shoot(
            room,
            room.bot
        );

    }

}

/* =========================================================
   UPDATE PLAYERS
========================================================= */

function updatePlayer(
    room,
    p,
    dt
) {

    if (
        !p.alive
    ) {

        if (
            p.respawnTimer > 0
        ) {

            p.respawnTimer -= dt;

        }

        if (
            p.respawnTimer <= 0
        ) {

            respawnPlayer(
                p
            );

        }

        return;

    }

    let dx = 0;
    let dy = 0;

    if (p.keys.w) {
        dy -= 1;
    }

    if (p.keys.s) {
        dy += 1;
    }

    if (p.keys.a) {
        dx -= 1;
    }

    if (p.keys.d) {
        dx += 1;
    }

    if (
        dx !== 0 ||
        dy !== 0
    ) {

        const length =
            Math.hypot(
                dx,
                dy
            );

        dx /= length;
        dy /= length;

        const speed = 260;

        movePlayer(
            p,
            dx *
                speed *
                dt,

            dy *
                speed *
                dt
        );

    }

    if (
        p.shootCooldown > 0
    ) {

        p.shootCooldown -= dt;

    }

    if (
        p.shooting
    ) {

        shoot(
            room,
            p
        );

    }

}

/* =========================================================
   BULLETS
========================================================= */

function updateBullets(
    room,
    dt
) {

    for (
        let i =
            room.bullets.length - 1;
        i >= 0;
        i--
    ) {

        const bullet =
            room.bullets[i];

        bullet.x +=
            bullet.vx *
            dt;

        bullet.y +=
            bullet.vy *
            dt;

        bullet.life -= dt;

        if (
            bullet.life <= 0 ||
            pointInsideWall(
                bullet.x,
                bullet.y
            ) ||
            bullet.x < 0 ||
            bullet.x > WORLD.width ||
            bullet.y < 0 ||
            bullet.y > WORLD.height
        ) {

            room.bullets.splice(
                i,
                1
            );

            continue;

        }

        const targets =
            allPlayers(room);

        let hit = false;

        for (
            const target
            of targets
        ) {

            if (
                target.id ===
                bullet.owner
            ) {
                continue;
            }

            if (
                !target.alive
            ) {
                continue;
            }

            const dx =
                target.x -
                bullet.x;

            const dy =
                target.y -
                bullet.y;

            const distance =
                Math.hypot(
                    dx,
                    dy
                );

            if (
                distance <= 24
            ) {

                target.hp -= 25;

                if (
                    target.hp <= 0
                ) {

                    target.hp = 0;

                    target.alive =
                        false;

                    target.respawnTimer =
                        1.2;

                    const killer =
                        targets.find(
                            p =>
                                p.id ===
                                bullet.owner
                        );

                    if (killer) {

                        if (
                            killer.id ===
                            "p1"
                        ) {

                            room.score.p1++;

                        } else {

                            room.score.p2++;

                        }

                    }

                    const winner =
                        room.score.p1 >=
                            MAX_SCORE
                            ? "p1"
                            : room.score.p2 >=
                              MAX_SCORE
                            ? "p2"
                            : null;

                    if (winner) {

                        room.started =
                            false;

                        room.gameOver =
                            true;

                        broadcast(
                            room,
                            {
                                type:
                                    "game_over",

                                winner:
                                    winner
                            }
                        );

                    }

                }

                hit = true;

                break;

            }

        }

        if (hit) {

            room.bullets.splice(
                i,
                1
            );

        }

    }

}

/* =========================================================
   STATE
========================================================= */

function getState(
    room
) {

    return {

        type:
            "state",

        players:
            allPlayers(room)
            .map(
                p => ({
                    id:
                        p.id,

                    name:
                        p.name,

                    x:
                        p.x,

                    y:
                        p.y,

                    angle:
                        p.angle,

                    hp:
                        p.hp,

                    alive:
                        p.alive
                })
            ),

        bullets:
            room.bullets
            .map(
                b => ({
                    x:
                        b.x,

                    y:
                        b.y
                })
            ),

        score: {
            p1:
                room.score.p1,

            p2:
                room.score.p2
        },

        started:
            room.started,

        lobby:
            room.players.size +
                (room.bot ? 1 : 0) <
            2

    };

}

/* =========================================================
   WEBSOCKET
========================================================= */

wss.on(
    "connection",
    ws => {

        let currentRoom = null;
        let currentPlayer = null;

        send(
            ws,
            {
                type:
                    "connected"
            }
        );

        ws.on(
            "message",
            raw => {

                let data;

                try {

                    data =
                        JSON.parse(
                            raw.toString()
                        );

                } catch {

                    return;

                }

                /* =========================================
                   CREATE ROOM
                ========================================= */

                if (
                    data.type ===
                    "create_room"
                ) {

                    if (
                        currentRoom
                    ) {
                        return;
                    }

                    const room =
                        createRoom();

                    const player =
                        createPlayer(
                            "p1",
                            data.name ||
                                "PLAYER 1"
                        );

                    player.ws =
                        ws;

                    room.players.set(
                        player.id,
                        player
                    );

                    currentRoom =
                        room;

                    currentPlayer =
                        player;

                    send(
                        ws,
                        {
                            type:
                                "room_created",

                            room:
                                room.code,

                            playerId:
                                player.id
                        }
                    );

                    return;

                }

                /* =========================================
                   JOIN ROOM
                ========================================= */

                if (
                    data.type ===
                    "join_room"
                ) {

                    const code =
                        String(
                            data.room ||
                            ""
                        )
                        .trim()
                        .toUpperCase();

                    const room =
                        rooms.get(code);

                    if (!room) {

                        send(
                            ws,
                            {
                                type:
                                    "error",

                                message:
                                    "Room ვერ მოიძებნა."
                            }
                        );

                        return;

                    }

                    if (
                        room.players.size >=
                        2
                    ) {

                        send(
                            ws,
                            {
                                type:
                                    "error",

                                message:
                                    "Room უკვე სავსეა."
                            }
                        );

                        return;

                    }

                    if (
                        room.gameOver
                    ) {

                        room.gameOver =
                            false;

                    }

                    if (room.bot) {

                        room.bot = null;

                        broadcast(
                            room,
                            {
                                type:
                                    "bot_left"
                            }
                        );

                    }

                    const player =
                        createPlayer(
                            "p2",
                            data.name ||
                                "PLAYER 2"
                        );

                    player.ws =
                        ws;

                    room.players.set(
                        player.id,
                        player
                    );

                    currentRoom =
                        room;

                    currentPlayer =
                        player;

                    send(
                        ws,
                        {
                            type:
                                "room_joined",

                            room:
                                room.code,

                            playerId:
                                player.id
                        }
                    );

                    if (
                        room.players.size >=
                        2
                    ) {

                        startGame(
                            room
                        );

                    }

                    return;

                }

                /* =========================================
                   ADD BOT
                ========================================= */

                if (
                    data.type ===
                    "add_bot"
                ) {

                    if (
                        !currentRoom ||
                        !currentPlayer
                    ) {
                        return;
                    }

                    if (
                        currentRoom.players.size >=
                        2
                    ) {
                        return;
                    }

                    if (
                        currentRoom.bot
                    ) {
                        return;
                    }

                    currentRoom.bot =
                        createPlayer(
                            "bot",
                            "BOT",
                            true
                        );

                    broadcast(
                        currentRoom,
                        {
                            type:
                                "bot_joined"
                        }
                    );

                    startGame(
                        currentRoom
                    );

                    return;

                }

                /* =========================================
                   INPUT
                ========================================= */

                if (
                    data.type ===
                    "input"
                ) {

                    if (
                        !currentPlayer
                    ) {
                        return;
                    }

                    if (
                        !currentRoom
                    ) {
                        return;
                    }

                    if (
                        typeof data.angle ===
                        "number"
                    ) {

                        currentPlayer.angle =
                            data.angle;

                    }

                    if (
                        data.keys
                    ) {

                        currentPlayer.keys = {

                            w:
                                !!data.keys.w,

                            a:
                                !!data.keys.a,

                            s:
                                !!data.keys.s,

                            d:
                                !!data.keys.d

                        };

                    }

                    currentPlayer.shooting =
                        !!data.shooting;

                    return;

                }

                /* =========================================
                   RESTART
                ========================================= */

                if (
                    data.type ===
                    "restart"
                ) {

                    if (
                        !currentRoom
                    ) {
                        return;
                    }

                    if (
                        currentRoom.players.size +
                        (currentRoom.bot
                            ? 1
                            : 0) >=
                        2
                    ) {

                        startGame(
                            currentRoom
                        );

                    }

                    return;

                }

            }
        );

        ws.on(
            "close",
            () => {

                if (
                    !currentRoom ||
                    !currentPlayer
                ) {
                    return;
                }

                const room =
                    currentRoom;

                room.players.delete(
                    currentPlayer.id
                );

                if (
                    room.bot
                ) {

                    room.bot = null;

                }

                room.started =
                    false;

                room.bullets = [];

                if (
                    room.players.size ===
                    0
                ) {

                    rooms.delete(
                        room.code
                    );

                } else {

                    broadcast(
                        room,
                        {
                            type:
                                "message",

                            message:
                                "მოთამაშე გავიდა."
                        }
                    );

                }

            }
        );

    }
);

/* =========================================================
   GAME LOOP
========================================================= */

setInterval(
    () => {

        const dt = 0.05;

        for (
            const room
            of rooms.values()
        ) {

            if (
                !room.started
            ) {
                continue;
            }

            for (
                const player
                of room.players.values()
            ) {

                updatePlayer(
                    room,
                    player,
                    dt
                );

            }

            updateBot(
                room,
                dt
            );

            updateBullets(
                room,
                dt
            );

            broadcast(
                room,
                getState(room)
            );

        }

    },
    50
);

/* =========================================================
   START
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            `RIVALS server running on port ${PORT}`
        );

    }
);
