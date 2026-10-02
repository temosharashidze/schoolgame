const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT =
    process.env.PORT || 3000;

const MAX_SCORE = 10;

const TICK_RATE = 30;

const ARENA_WIDTH = 1600;

const ARENA_HEIGHT = 900;

const PLAYER_SPEED = 260;

const SPRINT_SPEED = 390;

const BOT_SHOOT_DELAY = 520;

const PLAYER_SHOOT_DELAY = 150;

const BULLET_SPEED = 900;

const BULLET_DAMAGE = 34;

const rooms = new Map();

let nextBulletId = 1;


/* =========================================
   HTTP SERVER
========================================= */

const server =
    http.createServer(
        (req, res) => {

            let file =
                req.url === "/"
                    ? "/index.html"
                    : req.url;

            file =
                decodeURIComponent(
                    file.split("?")[0]
                );

            const filePath =
                path.join(
                    __dirname,
                    file
                );


            if (
                !filePath.startsWith(
                    __dirname
                )
            ) {

                res.writeHead(403);

                res.end("Forbidden");

                return;

            }


            fs.readFile(
                filePath,
                (err, data) => {

                    if (err) {

                        res.writeHead(
                            404,
                            {
                                "Content-Type":
                                    "text/plain; charset=utf-8"
                            }
                        );

                        res.end(
                            "404 Not Found"
                        );

                        return;

                    }


                    const ext =
                        path.extname(
                            filePath
                        ).toLowerCase();


                    const types = {

                        ".html":
                            "text/html; charset=utf-8",

                        ".js":
                            "text/javascript; charset=utf-8",

                        ".css":
                            "text/css; charset=utf-8",

                        ".json":
                            "application/json; charset=utf-8",

                        ".png":
                            "image/png",

                        ".jpg":
                            "image/jpeg",

                        ".jpeg":
                            "image/jpeg",

                        ".svg":
                            "image/svg+xml"

                    };


                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                types[ext] ||
                                "application/octet-stream"
                        }
                    );

                    res.end(data);

                }
            );

        }
    );


/* =========================================
   WEBSOCKET
========================================= */

const wss =
    new WebSocket.Server({
        server
    });


/* =========================================
   RANDOM ROOM
========================================= */

function randomRoom() {

    let room;

    do {

        room =
            Math.random()
                .toString(36)
                .substring(2, 7)
                .toUpperCase();

    } while (
        rooms.has(room)
    );

    return room;

}


/* =========================================
   PLAYER
========================================= */

function createPlayer(
    id,
    name,
    team
) {

    return {

        id,

        name,

        team,

        x:
            team === "p1"
                ? 250
                : 1350,

        y:
            450,

        angle:
            team === "p1"
                ? 0
                : Math.PI,

        hp: 100,

        alive: true,

        kills: 0,

        keys: {

            w: false,
            a: false,
            s: false,
            d: false,
            shift: false

        },

        shooting: false,

        lastShot: 0,

        isBot: false,

        ws: null

    };

}


/* =========================================
   BOT
========================================= */

function createBot() {

    const bot =
        createPlayer(
            "bot",
            "BOT",
            "p2"
        );

    bot.isBot = true;

    bot.x = 1350;

    bot.y = 450;

    bot.angle = Math.PI;

    bot.botNextShot =
        0;

    bot.botStrafe =
        1;

    bot.botNextStrafe =
        Date.now() + 1200;

    return bot;

}


/* =========================================
   ROOM
========================================= */

function createRoom(
    player
) {

    const code =
        randomRoom();


    const room = {

        code,

        players:
            new Map(),

        bullets:
            new Map(),

        score: {

            p1: 0,

            p2: 0

        },

        started: false,

        gameOver: false,

        respawnTimers: new Map(),

        bot: null

    };


    room.players.set(
        player.id,
        player
    );


    player.room =
        code;


    rooms.set(
        code,
        room
    );


    return room;

}


/* =========================================
   SEND
========================================= */

function send(
    ws,
    data
) {

    if (
        ws &&
        ws.readyState ===
        WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(
                data
            )
        );

    }

}


/* =========================================
   BROADCAST
========================================= */

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


/* =========================================
   RESET POSITIONS
========================================= */

function resetPositions(
    room
) {

    for (
        const player
        of room.players.values()
    ) {

        player.hp =
            100;

        player.alive =
            true;

        player.lastShot =
            0;

        player.shooting =
            false;


        if (
            player.team === "p1"
        ) {

            player.x =
                250;

            player.y =
                450;

            player.angle =
                0;

        } else {

            player.x =
                1350;

            player.y =
                450;

            player.angle =
                Math.PI;

        }

    }


    room.bullets.clear();

}


/* =========================================
   START
========================================= */

function startMatch(
    room
) {

    room.started =
        true;

    room.gameOver =
        false;

    room.score.p1 =
        0;

    room.score.p2 =
        0;

    resetPositions(
        room
    );


    broadcast(
        room,
        {
            type:
                "message",

            message:
                "🔥 MATCH STARTED"
        }
    );

}


/* =========================================
   ADD BOT
========================================= */

function addBot(
    room
) {

    if (
        room.players.size >= 2
    ) {

        return;

    }


    if (
        room.bot
    ) {

        return;

    }


    const bot =
        createBot();


    bot.room =
        room.code;


    room.bot =
        bot;


    room.players.set(
        bot.id,
        bot
    );


    startMatch(
        room
    );


    broadcast(
        room,
        {
            type:
                "bot_joined"
        }
    );

}


/* =========================================
   REMOVE BOT
========================================= */

function removeBot(
    room
) {

    if (
        !room.bot
    ) {

        return;

    }


    room.players.delete(
        "bot"
    );


    room.bot =
        null;


    room.started =
        false;

    room.gameOver =
        false;

    room.bullets.clear();


    broadcast(
        room,
        {
            type:
                "bot_left"
        }
    );

}


/* =========================================
   PLAYER MOVEMENT
========================================= */

function movePlayer(
    player,
    dt
) {

    if (
        !player.alive
    ) {

        return;

    }


    let forward = 0;

    let right = 0;


    if (
        player.keys.w
    ) {

        forward += 1;

    }


    if (
        player.keys.s
    ) {

        forward -= 1;

    }


    if (
        player.keys.d
    ) {

        right += 1;

    }


    if (
        player.keys.a
    ) {

        right -= 1;

    }


    if (
        forward === 0 &&
        right === 0
    ) {

        return;

    }


    const length =
        Math.hypot(
            forward,
            right
        );


    forward /=
        length;

    right /=
        length;


    const speed =
        player.keys.shift
            ? SPRINT_SPEED
            : PLAYER_SPEED;


    const angle =
        player.angle;


    const dx =
        Math.cos(angle) *
        forward -
        Math.sin(angle) *
        right;


    const dy =
        Math.sin(angle) *
        forward +
        Math.cos(angle) *
        right;


    player.x +=
        dx *
        speed *
        dt;


    player.y +=
        dy *
        speed *
        dt;


    player.x =
        Math.max(
            45,
            Math.min(
                ARENA_WIDTH - 45,
                player.x
            )
        );


    player.y =
        Math.max(
            45,
            Math.min(
                ARENA_HEIGHT - 45,
                player.y
            )
        );

}


/* =========================================
   BOT AI
========================================= */

function updateBot(
    room,
    bot,
    now,
    dt
) {

    if (
        !bot.alive
    ) {

        return;

    }


    const target =
        [...room.players.values()]
            .find(
                p =>
                    p.id !== "bot" &&
                    p.alive
            );


    if (!target) {

        return;

    }


    const dx =
        target.x -
        bot.x;


    const dy =
        target.y -
        bot.y;


    const distance =
        Math.hypot(
            dx,
            dy
        );


    bot.angle =
        Math.atan2(
            dy,
            dx
        );


    /*
       BOT MOVEMENT
    */

    bot.keys.w =
        distance > 380;


    bot.keys.s =
        distance < 180;


    if (
        now >=
        bot.botNextStrafe
    ) {

        bot.botStrafe *=
            -1;

        bot.botNextStrafe =
            now + 1000 +
            Math.random() * 1000;

    }


    bot.keys.a =
        distance < 700 &&
        bot.botStrafe < 0;


    bot.keys.d =
        distance < 700 &&
        bot.botStrafe > 0;


    bot.keys.shift =
        distance > 600;


    movePlayer(
        bot,
        dt
    );


    /*
       BOT SHOOTING
    */

    if (
        distance < 1000 &&
        now >= bot.botNextShot
    ) {

        shoot(
            room,
            bot,
            bot.angle,
            now
        );


        bot.botNextShot =
            now +
            BOT_SHOOT_DELAY +
            Math.random() * 180;

    }

}


/* =========================================
   SHOOT
========================================= */

function shoot(
    room,
    player,
    angle,
    now
) {

    if (
        !player.alive
    ) {

        return;

    }


    const cooldown =
        player.isBot
            ? BOT_SHOOT_DELAY
            : PLAYER_SHOOT_DELAY;


    if (
        now -
        player.lastShot <
        cooldown
    ) {

        return;

    }


    player.lastShot =
        now;


    const bullet = {

        id:
            nextBulletId++,

        owner:
            player.id,

        x:
            player.x +
            Math.cos(angle) *
            30,

        y:
            player.y +
            Math.sin(angle) *
            30,

        vx:
            Math.cos(angle) *
            BULLET_SPEED,

        vy:
            Math.sin(angle) *
            BULLET_SPEED,

        life:
            1.5

    };


    room.bullets.set(
        bullet.id,
        bullet
    );

}


/* =========================================
   BULLET UPDATE
========================================= */

function updateBullets(
    room,
    dt
) {

    for (
        const [
            id,
            bullet
        ]
        of room.bullets
    ) {

        bullet.x +=
            bullet.vx *
            dt;


        bullet.y +=
            bullet.vy *
            dt;


        bullet.life -=
            dt;


        if (
            bullet.life <= 0 ||
            bullet.x < 0 ||
            bullet.x > ARENA_WIDTH ||
            bullet.y < 0 ||
            bullet.y > ARENA_HEIGHT
        ) {

            room.bullets.delete(
                id
            );

            continue;

        }


        /*
           PLAYER COLLISION
        */

        for (
            const target
            of room.players.values()
        ) {

            if (
                !target.alive ||
                target.id ===
                bullet.owner
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
                distance <= 32
            ) {

                room.bullets.delete(
                    id
                );


                target.hp -=
                    BULLET_DAMAGE;


                const shooter =
                    room.players.get(
                        bullet.owner
                    );


                if (
                    shooter &&
                    !shooter.isBot
                ) {

                    send(
                        shooter.ws,
                        {
                            type:
                                "hit"
                        }
                    );

                }


                if (
                    !target.isBot
                ) {

                    send(
                        target.ws,
                        {
                            type:
                                "damaged"
                        }
                    );

                }


                if (
                    target.hp <= 0
                ) {

                    killPlayer(
                        room,
                        shooter,
                        target
                    );

                }


                break;

            }

        }

    }

}


/* =========================================
   KILL
========================================= */

function killPlayer(
    room,
    killer,
    victim
) {

    if (
        !victim.alive
    ) {

        return;

    }


    victim.alive =
        false;

    victim.hp =
        0;


    if (
        killer
    ) {

        killer.kills++;

        if (
            killer.team ===
            "p1"
        ) {

            room.score.p1++;

        } else {

            room.score.p2++;

        }

    }


    if (
        room.score.p1 >=
        MAX_SCORE ||
        room.score.p2 >=
        MAX_SCORE
    ) {

        room.gameOver =
            true;

        room.started =
            false;


        const winner =
            room.score.p1 >=
            MAX_SCORE
                ? "p1"
                : "p2";


        broadcast(
            room,
            {
                type:
                    "game_over",

                winner:
                    winner
            }
        );


        return;

    }


    const timer =
        setTimeout(
            () => {

                if (
                    room.gameOver
                ) {

                    return;

                }


                victim.hp =
                    100;

                victim.alive =
                    true;


                if (
                    victim.team ===
                    "p1"
                ) {

                    victim.x =
                        250;

                    victim.y =
                        450;

                    victim.angle =
                        0;

                } else {

                    victim.x =
                        1350;

                    victim.y =
                        450;

                    victim.angle =
                        Math.PI;

                }

            },
            900
        );


    room.respawnTimers.set(
        victim.id,
        timer
    );

}


/* =========================================
   ROOM STATE
========================================= */

function roomState(
    room
) {

    return {

        type:
            "state",

        players:
            [...room.players.values()]
                .map(
                    p => ({

                        id:
                            p.id,

                        name:
                            p.name,

                        team:
                            p.team,

                        x:
                            p.x,

                        y:
                            p.y,

                        hp:
                            p.hp,

                        alive:
                            p.alive,

                        angle:
                            p.angle

                    })
                ),

        bullets:
            [...room.bullets.values()]
                .map(
                    b => ({

                        id:
                            b.id,

                        x:
                            b.x,

                        y:
                            b.y

                    })
                ),

        score:
            room.score,

        started:
            room.started,

        lobby:
            room.players.size < 2

    };

}


/* =========================================
   CONNECTION
========================================= */

wss.on(
    "connection",
    ws => {

        let currentRoom =
            null;

        let currentPlayer =
            null;


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


                /* CREATE */

                if (
                    data.type ===
                    "create_room"
                ) {

                    if (
                        currentRoom
                    ) {

                        return;

                    }


                    const player =
                        createPlayer(
                            "p1",
                            String(
                                data.name ||
                                "PLAYER 1"
                            ).slice(
                                0,
                                16
                            ),
                            "p1"
                        );


                    player.ws =
                        ws;


                    const room =
                        createRoom(
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


                    broadcast(
                        room,
                        roomState(room)
                    );


                    return;

                }


                /* JOIN */

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
                        rooms.get(
                            code
                        );


                    if (
                        !room
                    ) {

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
                        room.players.size >= 2
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
                        room.bot
                    ) {

                        removeBot(
                            room
                        );

                    }


                    const player =
                        createPlayer(
                            "p2",
                            String(
                                data.name ||
                                "PLAYER 2"
                            ).slice(
                                0,
                                16
                            ),
                            "p2"
                        );


                    player.ws =
                        ws;


                    player.room =
                        room.code;


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


                    startMatch(
                        room
                    );


                    broadcast(
                        room,
                        roomState(room)
                    );


                    return;

                }


                /* BOT */

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


                    addBot(
                        currentRoom
                    );


                    broadcast(
                        currentRoom,
                        roomState(
                            currentRoom
                        )
                    );


                    return;

                }


                /* INPUT */

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
                                !!data.keys.d,

                            shift:
                                !!data.keys.shift

                        };

                    }


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


                /* RESTART */

                if (
                    data.type ===
                    "restart_match"
                ) {

                    if (
                        currentRoom &&
                        currentRoom.players.size >= 2
                    ) {

                        startMatch(
                            currentRoom
                        );


                        broadcast(
                            currentRoom,
                            roomState(
                                currentRoom
                            )
                        );

                    }

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

                    room.players.delete(
                        "bot"
                    );

                    room.bot =
                        null;

                }


                room.started =
                    false;

                room.gameOver =
                    false;

                room.bullets.clear();


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
                        roomState(room)
                    );

                }

            }
        );

    }
);


/* =========================================
   GAME LOOP
========================================= */

let lastTick =
    Date.now();


setInterval(
    () => {

        const now =
            Date.now();


        const dt =
            Math.min(
                .05,
                (now -
                lastTick) /
                1000
            );


        lastTick =
            now;


        for (
            const room
            of rooms.values()
        ) {

            if (
                room.started &&
                !room.gameOver
            ) {

                for (
                    const player
                    of room.players.values()
                ) {

                    if (
                        player.isBot
                    ) {

                        updateBot(
                            room,
                            player,
                            now,
                            dt
                        );

                    } else {

                        movePlayer(
                            player,
                            dt
                        );


                        if (
                            player.shooting
                        ) {

                            shoot(
                                room,
                                player,
                                player.angle,
                                now
                            );

                        }

                    }

                }


                updateBullets(
                    room,
                    dt
                );

            }


            broadcast(
                room,
                roomState(room)
            );

        }

    },
    1000 /
    TICK_RATE
);


/* =========================================
   START SERVER
========================================= */

server.listen(
    PORT,
    () => {

        console.log(
            `RIVALS server running on port ${PORT}`
        );

    }
);
