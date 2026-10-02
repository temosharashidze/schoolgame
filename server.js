const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const MAX_SCORE = 10;
const TICK = 50;

/* =========================================
   MAP
========================================= */

const MAP = [
    "1111111111111111",
    "1000000000000001",
    "1000110001100001",
    "1000000000000001",
    "1011001110011001",
    "1000000000000001",
    "1000010000100001",
    "1000010000100001",
    "1000000000000001",
    "1011001110011001",
    "1000000000000001",
    "1000110001100001",
    "1000000000000001",
    "1111111111111111"
];

const MAP_W = MAP[0].length;
const MAP_H = MAP.length;


/* =========================================
   HTTP SERVER
========================================= */

const server = http.createServer((req, res) => {

    let file =
        req.url === "/"
            ? "/index.html"
            : req.url.split("?")[0];

    const safe =
        path
            .normalize(file)
            .replace(/^(\.\.[\/\\])+/, "");

    const filePath =
        path.join(__dirname, safe);

    fs.readFile(filePath, (error, data) => {

        if (error) {

            res.writeHead(404, {
                "Content-Type":
                    "text/plain; charset=utf-8"
            });

            res.end("Not found");

            return;
        }

        const extension =
            path.extname(filePath).toLowerCase();

        const contentType = {

            ".html":
                "text/html; charset=utf-8",

            ".js":
                "text/javascript; charset=utf-8",

            ".json":
                "application/json; charset=utf-8",

            ".css":
                "text/css; charset=utf-8"

        }[extension] ||
        "application/octet-stream";

        res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "no-store"
        });

        res.end(data);

    });

});


/* =========================================
   WEBSOCKET
========================================= */

const wss =
    new WebSocket.Server({
        server
    });

const rooms = new Map();
const clients = new Map();


/* =========================================
   ROOM CODE
========================================= */

function createRoomCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let result;

    do {

        result = "";

        for (let i = 0; i < 5; i++) {

            result +=
                chars[
                    Math.floor(
                        Math.random() *
                        chars.length
                    )
                ];

        }

    } while (rooms.has(result));

    return result;
}


/* =========================================
   WALL COLLISION
========================================= */

function blocked(x, y, radius = 0.18) {

    const points = [
        [x - radius, y - radius],
        [x + radius, y - radius],
        [x - radius, y + radius],
        [x + radius, y + radius]
    ];

    return points.some(([px, py]) => {

        const mx = Math.floor(px);
        const my = Math.floor(py);

        if (
            mx < 0 ||
            my < 0 ||
            mx >= MAP_W ||
            my >= MAP_H
        ) {
            return true;
        }

        return MAP[my][mx] === "1";
    });
}


/* =========================================
   MOVEMENT
========================================= */

function movePlayer(player, dx, dy) {

    const nextX =
        player.x + dx;

    const nextY =
        player.y + dy;

    if (
        !blocked(
            nextX,
            player.y,
            0.20
        )
    ) {
        player.x = nextX;
    }

    if (
        !blocked(
            player.x,
            nextY,
            0.20
        )
    ) {
        player.y = nextY;
    }
}


/* =========================================
   SPAWN
========================================= */

function spawnPlayer(player) {

    const spots = [
        {
            x: 2.5,
            y: 2.5,
            angle: 0
        },
        {
            x: 13.5,
            y: 11.5,
            angle: Math.PI
        },
        {
            x: 2.5,
            y: 11.5,
            angle: 0
        },
        {
            x: 13.5,
            y: 2.5,
            angle: Math.PI
        }
    ];

    const spot =
        spots[
            Math.floor(
                Math.random() *
                spots.length
            )
        ];

    player.x = spot.x;
    player.y = spot.y;
    player.angle = spot.angle;

    player.hp = 100;
    player.alive = true;
    player.cooldown = 0;
    player.shooting = false;

    player.keys = {
        w: false,
        a: false,
        s: false,
        d: false
    };
}


/* =========================================
   SEND
========================================= */

function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(data)
        );
    }
}


/* =========================================
   BROADCAST
========================================= */

function broadcast(room, data) {

    for (
        const player of
        room.players.values()
    ) {

        if (player.ws) {
            send(player.ws, data);
        }
    }
}


/* =========================================
   ROOM STATE
========================================= */

function roomState(room) {

    const players =
        [...room.players.values()]
            .map(player => ({

                id: player.id,
                name: player.name,

                x: player.x,
                y: player.y,

                angle: player.angle,

                hp: player.hp,

                kills: player.kills,

                alive: player.alive,

                bot: !!player.bot

            }));

    const p1 =
        room.players.get("p1");

    const rival =
        [...room.players.values()]
            .find(
                p => p.id !== "p1"
            );

    return {

        type: "state",

        room: room.code,

        started: room.started,

        lobby:
            room.players.size < 2,

        players,

        bullets:
            room.bullets.map(
                bullet => ({
                    x: bullet.x,
                    y: bullet.y
                })
            ),

        score: {

            p1:
                p1
                    ? p1.kills
                    : 0,

            p2:
                rival
                    ? rival.kills
                    : 0

        }

    };
}


/* =========================================
   BOT
========================================= */

function addBot(room) {

    if (!room) {
        return;
    }

    if (room.bot) {
        return;
    }

    if (room.players.size >= 2) {
        return;
    }

    const bot = {

        id: "bot",

        name: "BOT",

        ws: null,

        x: 13.5,
        y: 11.5,

        angle: Math.PI,

        hp: 100,

        kills: 0,

        alive: true,

        cooldown: 0,

        shooting: false,

        bot: true,

        keys: {
            w: false,
            a: false,
            s: false,
            d: false
        }

    };

    room.bot = bot;

    room.players.set(
        "bot",
        bot
    );

    room.started = true;

    broadcast(room, {
        type: "bot_joined",
        message: "🤖 BOT შეუერთდა თამაშს!"
    });

    broadcast(
        room,
        roomState(room)
    );
}


/* =========================================
   REMOVE CLIENT
========================================= */

function removeClient(ws) {

    const client =
        clients.get(ws);

    if (!client) {
        return;
    }

    const room =
        client.room;

    if (room) {

        room.players.delete(
            client.id
        );

        /*
         * თუ მოთამაშე გავიდა და BOT იყო,
         * BOT-იც იშლება.
         */

        if (room.bot) {

            room.players.delete("bot");

            room.bot = null;
        }

        /*
         * ოთახში აღარავინ დარჩა
         */

        if (
            room.players.size === 0
        ) {

            rooms.delete(
                room.code
            );

        } else {

            room.started = false;

            broadcast(room, {
                type: "message",
                message:
                    "მოთამაშე გავიდა."
            });

            broadcast(
                room,
                roomState(room)
            );
        }
    }

    clients.delete(ws);
}


/* =========================================
   SHOOT
========================================= */

function shoot(room, player) {

    if (!player) {
        return;
    }

    if (!player.alive) {
        return;
    }

    if (player.cooldown > 0) {
        return;
    }

    player.cooldown = 250;

    const directionX =
        Math.cos(player.angle);

    const directionY =
        Math.sin(player.angle);

    room.bullets.push({

        x:
            player.x +
            directionX * 0.35,

        y:
            player.y +
            directionY * 0.35,

        vx:
            directionX * 0.38,

        vy:
            directionY * 0.38,

        owner:
            player.id,

        life: 1300

    });
}


/* =========================================
   BOT AI
========================================= */

function botThink(room, bot) {

    const targets =
        [...room.players.values()]
            .filter(
                player =>
                    player.id !== "bot" &&
                    player.alive
            );

    if (
        targets.length === 0
    ) {
        return;
    }

    const target =
        targets[0];

    const dx =
        target.x - bot.x;

    const dy =
        target.y - bot.y;

    const distance =
        Math.hypot(dx, dy);

    const desiredAngle =
        Math.atan2(dy, dx);

    let difference =
        desiredAngle -
        bot.angle;

    while (
        difference > Math.PI
    ) {
        difference -=
            Math.PI * 2;
    }

    while (
        difference < -Math.PI
    ) {
        difference +=
            Math.PI * 2;
    }

    bot.angle +=
        Math.max(
            -0.12,
            Math.min(
                0.12,
                difference
            )
        );

    /*
     * მოძრაობა
     */

    if (distance > 3) {

        const speed = 0.065;

        movePlayer(
            bot,
            Math.cos(bot.angle) * speed,
            Math.sin(bot.angle) * speed
        );
    }

    /*
     * სროლა
     */

    if (
        distance < 10 &&
        Math.abs(difference) < 0.30
    ) {

        shoot(
            room,
            bot
        );
    }
}


/* =========================================
   CREATE ROOM
========================================= */

function createRoom(ws, data) {

    const client =
        clients.get(ws);

    if (!client) {
        return;
    }

    /*
     * თუ უკვე ოთახშია,
     * ძველ ოთახს აღარ ვქმნით.
     */

    if (client.room) {

        send(ws, {
            type: "room_created",
            room: client.room.code,
            playerId: client.id
        });

        send(ws, {
            type: "created",
            room: client.room.code,
            playerId: client.id
        });

        send(
            ws,
            roomState(client.room)
        );

        return;
    }

    const code =
        createRoomCode();

    const room = {

        code,

        players:
            new Map(),

        bullets: [],

        started: false,

        bot: null
    };

    const player = {

        id: "p1",

        name:
            String(
                data.name ||
                "PLAYER"
            ).slice(0, 16),

        ws,

        x: 2.5,
        y: 2.5,

        angle: 0,

        hp: 100,

        kills: 0,

        alive: true,

        cooldown: 0,

        shooting: false,

        bot: false,

        keys: {
            w: false,
            a: false,
            s: false,
            d: false
        }
    };

    room.players.set(
        "p1",
        player
    );

    rooms.set(
        code,
        room
    );

    client.id = "p1";
    client.room = room;

    console.log(
        "ROOM CREATED:",
        code,
        "PLAYER:",
        player.name
    );

    /*
     * ძველი GAME3
     */

    send(ws, {
        type: "room_created",
        room: code,
        playerId: "p1"
    });

    /*
     * ახალი GAME3
     */

    send(ws, {
        type: "created",
        room: code,
        playerId: "p1"
    });

    /*
     * დამატებითი ინფორმაცია
     */

    send(ws, {
        type: "message",
        message:
            "✅ Match შეიქმნა! Room: " + code
    });

    send(
        ws,
        roomState(room)
    );
}


/* =========================================
   JOIN ROOM
========================================= */

function joinRoom(ws, data) {

    const client =
        clients.get(ws);

    if (!client) {
        return;
    }

    const code =
        String(
            data.room ||
            data.code ||
            ""
        )
        .trim()
        .toUpperCase();

    const room =
        rooms.get(code);

    if (!room) {

        send(ws, {
            type: "error",
            message:
                "Room ვერ მოიძებნა: " +
                code
        });

        return;
    }

    if (
        room.players.size >= 2
    ) {

        send(ws, {
            type: "error",
            message:
                "Room უკვე სავსეა."
        });

        return;
    }

    /*
     * თუ BOT იყო,
     * რეალური მოთამაშე ანაცვლებს.
     */

    if (room.bot) {

        room.players.delete("bot");

        room.bot = null;
    }

    const player = {

        id: "p2",

        name:
            String(
                data.name ||
                "PLAYER 2"
            ).slice(0, 16),

        ws,

        x: 13.5,
        y: 11.5,

        angle: Math.PI,

        hp: 100,

        kills: 0,

        alive: true,

        cooldown: 0,

        shooting: false,

        bot: false,

        keys: {
            w: false,
            a: false,
            s: false,
            d: false
        }
    };

    room.players.set(
        "p2",
        player
    );

    room.started = true;

    client.id = "p2";
    client.room = room;

    console.log(
        "PLAYER JOINED:",
        player.name,
        "ROOM:",
        room.code
    );

    send(ws, {
        type: "room_joined",
        room: room.code,
        playerId: "p2"
    });

    send(ws, {
        type: "joined",
        room: room.code,
        playerId: "p2"
    });

    broadcast(room, {
        type: "message",
        message:
            "👥 2 მოთამაშე მზად არის!"
    });

    broadcast(
        room,
        roomState(room)
    );
}


/* =========================================
   WEBSOCKET CONNECTION
========================================= */

wss.on(
    "connection",
    ws => {

        console.log(
            "WebSocket connected"
        );

        clients.set(ws, {
            id: null,
            room: null
        });

        send(ws, {
            type: "connected"
        });


        ws.on(
            "message",
            raw => {

                let data;

                try {

                    data =
                        JSON.parse(raw);

                } catch {

                    return;
                }

                const client =
                    clients.get(ws);

                if (!client) {
                    return;
                }


                /* =================================
                   CREATE
                ================================= */

                /*
                 * ორივეს ვიღებთ:
                 *
                 * create
                 * create_room
                 */

                if (
                    data.type === "create" ||
                    data.type === "create_room"
                ) {

                    createRoom(
                        ws,
                        data
                    );

                    return;
                }


                /* =================================
                   JOIN
                ================================= */

                if (
                    data.type === "join" ||
                    data.type === "join_room"
                ) {

                    joinRoom(
                        ws,
                        data
                    );

                    return;
                }


                /* =================================
                   ADD BOT
                ================================= */

                if (
                    data.type === "add_bot"
                ) {

                    const room =
                        client.room;

                    if (!room) {

                        send(ws, {
                            type: "error",
                            message:
                                "ჯერ შექმენი ან შეუერთდი Match-ს."
                        });

                        return;
                    }

                    if (
                        room.players.size >= 2
                    ) {

                        send(ws, {
                            type: "error",
                            message:
                                "Room უკვე სავსეა."
                        });

                        return;
                    }

                    addBot(room);

                    return;
                }


                /* =================================
                   INPUT
                ================================= */

                if (
                    data.type === "input"
                ) {

                    const room =
                        client.room;

                    if (!room) {
                        return;
                    }

                    const player =
                        room.players.get(
                            client.id
                        );

                    if (
                        !player ||
                        !player.alive
                    ) {
                        return;
                    }

                    const input =
                        data.keys || {};

                    player.keys = {

                        w: !!input.w,
                        a: !!input.a,
                        s: !!input.s,
                        d: !!input.d

                    };

                    const mouseDX =
                        Number(
                            data.mouseDX
                        );

                    if (
                        Number.isFinite(
                            mouseDX
                        )
                    ) {

                        player.angle +=
                            Math.max(
                                -80,
                                Math.min(
                                    80,
                                    mouseDX
                                )
                            ) * 0.0032;
                    }

                    player.shooting =
                        !!data.shooting;

                    return;
                }

            }
        );


        ws.on(
            "close",
            () => {

                console.log(
                    "WebSocket disconnected"
                );

                removeClient(ws);

            }
        );


        ws.on(
            "error",
            error => {

                console.log(
                    "WebSocket error:",
                    error.message
                );

            }
        );

    }
);


/* =========================================
   GAME LOOP
========================================= */

setInterval(
    () => {

        for (
            const room of
            rooms.values()
        ) {

            /*
             * PLAYERS
             */

            for (
                const player of
                room.players.values()
            ) {

                if (
                    player.cooldown > 0
                ) {

                    player.cooldown -=
                        TICK;
                }


                /*
                 * BOT
                 */

                if (player.bot) {

                    botThink(
                        room,
                        player
                    );

                    continue;
                }


                if (
                    !player.alive
                ) {
                    continue;
                }


                const keys =
                    player.keys || {};

                const speed =
                    0.105;

                let dx = 0;
                let dy = 0;


                /*
                 * W
                 */

                if (keys.w) {

                    dx +=
                        Math.cos(
                            player.angle
                        ) * speed;

                    dy +=
                        Math.sin(
                            player.angle
                        ) * speed;
                }


                /*
                 * S
                 */

                if (keys.s) {

                    dx -=
                        Math.cos(
                            player.angle
                        ) * speed;

                    dy -=
                        Math.sin(
                            player.angle
                        ) * speed;
                }


                /*
                 * A
                 */

                if (keys.a) {

                    dx +=
                        Math.cos(
                            player.angle -
                            Math.PI / 2
                        ) * speed;

                    dy +=
                        Math.sin(
                            player.angle -
                            Math.PI / 2
                        ) * speed;
                }


                /*
                 * D
                 */

                if (keys.d) {

                    dx +=
                        Math.cos(
                            player.angle +
                            Math.PI / 2
                        ) * speed;

                    dy +=
                        Math.sin(
                            player.angle +
                            Math.PI / 2
                        ) * speed;
                }


                /*
                 * NORMALIZE
                 */

                const length =
                    Math.hypot(
                        dx,
                        dy
                    );

                if (
                    length > speed
                ) {

                    dx =
                        dx /
                        length *
                        speed;

                    dy =
                        dy /
                        length *
                        speed;
                }


                /*
                 * MOVE
                 */

                movePlayer(
                    player,
                    dx,
                    dy
                );


                /*
                 * SHOOT
                 */

                if (
                    player.shooting
                ) {

                    shoot(
                        room,
                        player
                    );
                }

            }


            /*
             * BULLETS
             */

            for (
                let i =
                    room.bullets.length - 1;

                i >= 0;

                i--
            ) {

                const bullet =
                    room.bullets[i];

                bullet.x +=
                    bullet.vx;

                bullet.y +=
                    bullet.vy;

                bullet.life -=
                    TICK;


                /*
                 * WALL
                 */

                if (
                    bullet.life <= 0 ||
                    blocked(
                        bullet.x,
                        bullet.y,
                        0.04
                    )
                ) {

                    room.bullets.splice(
                        i,
                        1
                    );

                    continue;
                }


                /*
                 * HIT
                 */

                let target = null;

                for (
                    const player of
                    room.players.values()
                ) {

                    if (
                        player.id ===
                        bullet.owner
                    ) {
                        continue;
                    }

                    if (
                        !player.alive
                    ) {
                        continue;
                    }

                    const distance =
                        Math.hypot(
                            player.x -
                            bullet.x,

                            player.y -
                            bullet.y
                        );

                    if (
                        distance < 0.45
                    ) {

                        target =
                            player;

                        break;
                    }
                }


                if (!target) {
                    continue;
                }


                target.hp -= 34;


                room.bullets.splice(
                    i,
                    1
                );


                /*
                 * HIT MESSAGE
                 */

                if (
                    target.ws
                ) {

                    send(
                        target.ws,
                        {
                            type: "message",
                            message:
                                "💥 HIT! HP -34"
                        }
                    );
                }


                const shooter =
                    room.players.get(
                        bullet.owner
                    );


                /*
                 * KILL
                 */

                if (
                    target.hp <= 0
                ) {

                    target.hp = 0;
                    target.alive = false;


                    if (shooter) {

                        shooter.kills++;
                    }


                    /*
                     * WIN
                     */

                    if (
                        shooter &&
                        shooter.kills >=
                        MAX_SCORE
                    ) {

                        broadcast(
                            room,
                            {
                                type:
                                    "game_over",

                                winner:
                                    shooter.id
                            }
                        );

                        room.bullets = [];


                        for (
                            const player of
                            room.players.values()
                        ) {

                            player.kills = 0;

                            spawnPlayer(
                                player
                            );
                        }

                    } else {

                        /*
                         * RESPAWN
                         */

                        setTimeout(
                            () => {

                                if (
                                    room.players.has(
                                        target.id
                                    )
                                ) {

                                    spawnPlayer(
                                        target
                                    );
                                }

                            },
                            800
                        );
                    }

                }

            }


            /*
             * SEND STATE
             */

            if (
                room.players.size > 0
            ) {

                broadcast(
                    room,
                    roomState(room)
                );
            }

        }

    },
    TICK
);


/* =========================================
   START
========================================= */

server.listen(
    PORT,
    () => {

        console.log(
            "================================="
        );

        console.log(
            "RIVALS FPS SERVER RUNNING"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "================================="
        );

    }
);
