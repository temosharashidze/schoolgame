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

            res.writeHead(404);
            res.end("Not found");

            return;
        }

        const extension =
            path.extname(filePath);

        const contentType = {

            ".html":
                "text/html; charset=utf-8",

            ".js":
                "text/javascript; charset=utf-8",

            ".json":
                "application/json",

            ".css":
                "text/css; charset=utf-8",

            ".png":
                "image/png",

            ".jpg":
                "image/jpeg",

            ".svg":
                "image/svg+xml"

        }[extension] ||
        "application/octet-stream";

        res.writeHead(
            200,
            {
                "Content-Type": contentType,
                "Cache-Control": "no-store"
            }
        );

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

function isWall(x, y) {

    const mx = Math.floor(x);
    const my = Math.floor(y);

    if (
        mx < 0 ||
        my < 0 ||
        mx >= MAP_W ||
        my >= MAP_H
    ) {
        return true;
    }

    return MAP[my][mx] === "1";
}


function blocked(
    x,
    y,
    radius = 0.20
) {

    const points = [

        [x - radius, y - radius],
        [x + radius, y - radius],
        [x - radius, y + radius],
        [x + radius, y + radius],

        [x, y - radius],
        [x, y + radius],
        [x - radius, y],
        [x + radius, y]

    ];

    return points.some(
        ([px, py]) =>
            isWall(px, py)
    );
}


/* =========================================
   SAFE MOVEMENT
========================================= */

function movePlayer(
    player,
    dx,
    dy
) {

    if (!player) {
        return;
    }

    const nextX =
        player.x + dx;

    const nextY =
        player.y + dy;


    /* X */

    if (
        !blocked(
            nextX,
            player.y,
            0.20
        )
    ) {

        player.x = nextX;
    }


    /* Y */

    if (
        !blocked(
            player.x,
            nextY,
            0.20
        )
    ) {

        player.y = nextY;
    }


    /* დამატებითი დაცვა */

    if (
        blocked(
            player.x,
            player.y,
            0.20
        )
    ) {

        player.x =
            Math.max(
                1.25,
                Math.min(
                    MAP_W - 1.25,
                    player.x
                )
            );

        player.y =
            Math.max(
                1.25,
                Math.min(
                    MAP_H - 1.25,
                    player.y
                )
            );
    }
}


/* =========================================
   SPAWN POINTS
========================================= */

const PLAYER_SPAWNS = [

    {
        x: 2.5,
        y: 2.5,
        angle: 0
    },

    {
        x: 13.5,
        y: 11.5,
        angle: Math.PI
    }

];


const BOT_SPAWN = {

    /*
       BOT ყოველთვის მარცხენა მხარეს
       იწყებს.
    */

    x: 2.5,
    y: 11.5,
    angle: 0
};


/* =========================================
   SPAWN PLAYER
========================================= */

function spawnPlayer(player) {

    let spot;

    if (player.bot) {

        spot = BOT_SPAWN;

    } else {

        spot =
            PLAYER_SPAWNS[
                player.id === "p2"
                    ? 1
                    : 0
            ];
    }

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

    /*
       ბოტის ვიზუალისთვის
       ყოველთვის მიწაზეა.
    */

    player.z = 0;
    player.verticalVelocity = 0;
    player.grounded = true;
}


/* =========================================
   SEND
========================================= */

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


/* =========================================
   BROADCAST
========================================= */

function broadcast(room, data) {

    for (
        const player of
        room.players.values()
    ) {

        if (player.ws) {

            send(
                player.ws,
                data
            );
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

                /*
                   ახალი grounded მონაცემები
                */

                z:
                    player.z || 0,

                grounded:
                    player.grounded !== false,

                bot:
                    !!player.bot

            }));


    const p1 =
        room.players.get("p1");

    const rival =
        [...room.players.values()]
            .find(
                p =>
                    p.id !== "p1"
            );


    return {

        type: "state",

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

    /*
       მხოლოდ ერთი BOT
    */

    if (room.bot) {
        return;
    }

    /*
       1v1-ში მეორე მოთამაშის ადგილი
       BOT-ს უჭირავს.
    */

    if (room.players.size >= 2) {
        return;
    }


    const bot = {

        id: "bot",

        name: "BOT",

        ws: null,

        x: BOT_SPAWN.x,
        y: BOT_SPAWN.y,

        angle: BOT_SPAWN.angle,

        hp: 100,

        kills: 0,

        alive: true,

        cooldown: 0,

        shooting: false,

        bot: true,

        /*
           მიწაზე
        */

        z: 0,

        verticalVelocity: 0,

        grounded: true,

        /*
           მოძრაობის მდგომარეობა
        */

        keys: {

            w: false,
            a: false,
            s: false,
            d: false

        },

        aiTimer: 0,
        strafeTimer: 0,
        strafeDirection: 1
    };


    room.bot = bot;

    room.players.set(
        "bot",
        bot
    );


    room.started = true;


    broadcast(
        room,
        {
            type: "bot_joined"
        }
    );


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
           თუ მოთამაშე გავიდა,
           BOT-ს ვტოვებთ მხოლოდ მაშინ,
           თუ ოთახში მთავარი მოთამაშე ისევ არის.
        */

        if (
            room.bot &&
            room.players.has("p1")
        ) {

            room.players.delete("bot");

            room.bot = null;
        }


        if (
            room.players.size === 0
        ) {

            rooms.delete(
                room.code
            );

        } else {

            broadcast(
                room,
                {
                    type: "message",
                    message:
                        "მოთამაშე გავიდა."
                }
            );

            broadcast(
                room,
                roomState(room)
            );
        }
    }


    clients.delete(ws);
}


/* =========================================
   LINE OF SIGHT
========================================= */

function hasLineOfSight(
    fromX,
    fromY,
    toX,
    toY
) {

    const dx =
        toX - fromX;

    const dy =
        toY - fromY;

    const distance =
        Math.hypot(dx, dy);

    if (distance <= 0.1) {
        return true;
    }


    const steps =
        Math.ceil(
            distance / 0.12
        );


    for (
        let i = 1;
        i < steps;
        i++
    ) {

        const t =
            i / steps;

        const x =
            fromX + dx * t;

        const y =
            fromY + dy * t;


        if (
            isWall(x, y)
        ) {

            return false;
        }
    }


    return true;
}


/* =========================================
   SHOOT
========================================= */

function shoot(room, player) {

    if (!player.alive) {
        return;
    }


    if (player.cooldown > 0) {
        return;
    }


    player.cooldown = 250;


    const directionX =
        Math.cos(
            player.angle
        );

    const directionY =
        Math.sin(
            player.angle
        );


    room.bullets.push({

        x:
            player.x +
            directionX * 0.38,

        y:
            player.y +
            directionY * 0.38,

        vx:
            directionX * 0.38,

        vy:
            directionY * 0.38,

        owner:
            player.id,

        life:
            1300
    });
}


/* =========================================
   BOT AI
========================================= */

function botThink(
    room,
    bot
) {

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

        bot.shooting = false;

        return;
    }


    /*
       1v1 — ყოველთვის ერთი მოთამაშე
    */

    const target =
        targets[0];


    const dx =
        target.x - bot.x;

    const dy =
        target.y - bot.y;


    const distance =
        Math.hypot(
            dx,
            dy
        );


    const desiredAngle =
        Math.atan2(
            dy,
            dx
        );


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


    /*
       კამერის მსგავსი რბილი მოტრიალება
    */

    bot.angle +=
        Math.max(
            -0.10,
            Math.min(
                0.10,
                difference
            )
        );


    /*
       მოძრაობა

       BOT დადის იგივე პრინციპით,
       როგორც მოთამაშე.
    */

    const speed = 0.075;


    let forward = 0;
    let side = 0;


    /*
       თუ შორსაა — წინ მიდის.
    */

    if (
        distance > 2.5
    ) {

        forward = 1;

    }


    /*
       თუ ძალიან ახლოსაა,
       გვერდულად მოძრაობს.
    */

    if (
        distance <= 2.5
    ) {

        forward = -0.15;

    }


    /*
       პერიოდული strafe
    */

    bot.strafeTimer -= TICK;

    if (
        bot.strafeTimer <= 0
    ) {

        bot.strafeTimer =
            700 +
            Math.random() * 1000;

        bot.strafeDirection *= -1;
    }


    side =
        bot.strafeDirection *
        0.35;


    /*
       WASD-ის მსგავსი მოძრაობა
    */

    let dxMove =
        Math.cos(bot.angle) *
        forward *
        speed;

    let dyMove =
        Math.sin(bot.angle) *
        forward *
        speed;


    dxMove +=
        Math.cos(
            bot.angle + Math.PI / 2
        ) *
        side *
        speed;


    dyMove +=
        Math.sin(
            bot.angle + Math.PI / 2
        ) *
        side *
        speed;


    /*
       თუ წინ კედელია,
       მიმართულებას ვცვლით.
    */

    if (
        blocked(
            bot.x + dxMove,
            bot.y,
            0.20
        ) ||
        blocked(
            bot.x,
            bot.y + dyMove,
            0.20
        )
    ) {

        bot.strafeDirection *= -1;

        dxMove =
            Math.cos(
                bot.angle + Math.PI / 2
            ) *
            bot.strafeDirection *
            speed;

        dyMove =
            Math.sin(
                bot.angle + Math.PI / 2
            ) *
            bot.strafeDirection *
            speed;
    }


    movePlayer(
        bot,
        dxMove,
        dyMove
    );


    /*
       სროლა მხოლოდ მაშინ,
       როცა ხედავს მოთამაშეს.
    */

    const visible =
        hasLineOfSight(
            bot.x,
            bot.y,
            target.x,
            target.y
        );


    if (
        distance < 9 &&
        visible &&
        Math.abs(difference) < 0.22
    ) {

        bot.shooting = true;

        shoot(
            room,
            bot
        );

    } else {

        bot.shooting = false;
    }


    /*
       BOT ყოველთვის მიწაზეა.
    */

    bot.z = 0;
    bot.verticalVelocity = 0;
    bot.grounded = true;
}


/* =========================================
   CONNECTION
========================================= */

wss.on(
    "connection",
    ws => {

        clients.set(
            ws,
            {
                id: null,
                room: null
            }
        );


        send(
            ws,
            {
                type: "connected"
            }
        );


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
                   CREATE ROOM
                ================================= */

                if (
                    data.type ===
                    "create_room" ||
                    data.type ===
                    "create"
                ) {

                    /*
                       ძველი ოთახი თუ არსებობს,
                       აღარ შევქმნათ მეორე.
                    */

                    if (client.room) {

                        send(
                            ws,
                            {
                                type:
                                    "room_created",

                                room:
                                    client.room.code,

                                playerId:
                                    client.id
                            }
                        );

                        return;
                    }


                    const room = {

                        code:
                            createRoomCode(),

                        players:
                            new Map(),

                        bullets:
                            [],

                        started:
                            false,

                        bot:
                            null
                    };


                    const player = {

                        id: "p1",

                        name:
                            String(
                                data.name ||
                                "PLAYER"
                            )
                            .slice(0, 16),

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

                        z: 0,

                        verticalVelocity: 0,

                        grounded: true,

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
                        room.code,
                        room
                    );


                    client.id = "p1";
                    client.room = room;


                    send(
                        ws,
                        {

                            type:
                                "room_created",

                            room:
                                room.code,

                            playerId:
                                "p1"
                        }
                    );


                    /*
                       დამატებით ვაგზავნით
                       რამდენიმე ფორმატს,
                       რომ GAME3-ის ძველი
                       კოდიც იმუშაოს.
                    */

                    send(
                        ws,
                        {

                            type:
                                "created",

                            room:
                                room.code,

                            playerId:
                                "p1"
                        }
                    );


                    send(
                        ws,
                        roomState(room)
                    );


                    return;
                }


                /* =================================
                   JOIN ROOM
                ================================= */

                if (
                    data.type ===
                    "join_room" ||
                    data.type ===
                    "join"
                ) {

                    const code =
                        String(
                            data.room ||
                            data.code ||
                            ""
                        )
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


                    /*
                       თუ BOT იყო,
                       ადამიანი მის ადგილს იკავებს.
                    */

                    if (room.bot) {

                        room.players.delete(
                            "bot"
                        );

                        room.bot = null;
                    }


                    const player = {

                        id: "p2",

                        name:
                            String(
                                data.name ||
                                "PLAYER 2"
                            )
                            .slice(0, 16),

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

                        z: 0,

                        verticalVelocity: 0,

                        grounded: true,

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


                    send(
                        ws,
                        {

                            type:
                                "room_joined",

                            room:
                                room.code,

                            playerId:
                                "p2"
                        }
                    );


                    send(
                        ws,
                        {

                            type:
                                "joined",

                            room:
                                room.code,

                            playerId:
                                "p2"
                        }
                    );


                    broadcast(
                        room,
                        {

                            type:
                                "message",

                            message:
                                "👥 1v1 დაიწყო!"
                        }
                    );


                    broadcast(
                        room,
                        {

                            type:
                                "started"
                        }
                    );


                    broadcast(
                        room,
                        roomState(room)
                    );


                    return;
                }


                /* =================================
                   ADD BOT
                ================================= */

                if (
                    data.type ===
                    "add_bot"
                ) {

                    const room =
                        client.room;


                    if (!room) {
                        return;
                    }


                    /*
                       მხოლოდ ერთი BOT.
                    */

                    if (
                        room.bot ||
                        room.players.size >= 2
                    ) {

                        return;
                    }


                    addBot(room);

                    return;
                }


                /* =================================
                   INPUT
                ================================= */

                if (
                    data.type ===
                    "input"
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
                        data.keys ||
                        {};


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
                            ) *
                            0.0032;
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

                removeClient(ws);
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

            /* =================================
               PLAYERS
            ================================= */

            for (
                const player of
                room.players.values()
            ) {

                if (
                    player.cooldown > 0
                ) {

                    player.cooldown -=
                        TICK;

                    if (
                        player.cooldown < 0
                    ) {

                        player.cooldown = 0;
                    }
                }


                /*
                   BOT
                */

                if (player.bot) {

                    if (player.alive) {

                        botThink(
                            room,
                            player
                        );
                    }

                    continue;
                }


                /*
                   PLAYER
                */

                if (!player.alive) {
                    continue;
                }


                const keys =
                    player.keys ||
                    {};


                const speed = 0.105;


                let dx = 0;
                let dy = 0;


                /* W */

                if (keys.w) {

                    dx +=
                        Math.cos(
                            player.angle
                        ) *
                        speed;

                    dy +=
                        Math.sin(
                            player.angle
                        ) *
                        speed;
                }


                /* S */

                if (keys.s) {

                    dx -=
                        Math.cos(
                            player.angle
                        ) *
                        speed;

                    dy -=
                        Math.sin(
                            player.angle
                        ) *
                        speed;
                }


                /* A */

                if (keys.a) {

                    dx +=
                        Math.cos(
                            player.angle -
                            Math.PI / 2
                        ) *
                        speed;

                    dy +=
                        Math.sin(
                            player.angle -
                            Math.PI / 2
                        ) *
                        speed;
                }


                /* D */

                if (keys.d) {

                    dx +=
                        Math.cos(
                            player.angle +
                            Math.PI / 2
                        ) *
                        speed;

                    dy +=
                        Math.sin(
                            player.angle +
                            Math.PI / 2
                        ) *
                        speed;
                }


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


                movePlayer(
                    player,
                    dx,
                    dy
                );


                /*
                   PLAYER SHOOT
                */

                if (
                    player.shooting
                ) {

                    shoot(
                        room,
                        player
                    );
                }


                /*
                   Player always grounded
                   for this version.
                */

                player.z = 0;
                player.verticalVelocity = 0;
                player.grounded = true;
            }


            /* =================================
               BULLETS
            ================================= */

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
                   WALL
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
                   HIT
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


                if (
                    target.ws
                ) {

                    send(
                        target.ws,
                        {
                            type:
                                "message",

                            message:
                                "💥 HIT! HP -34"
                        }
                    );
                }


                const shooter =
                    room.players.get(
                        bullet.owner
                    );


                if (
                    target.hp <= 0
                ) {

                    target.hp = 0;

                    target.alive = false;


                    if (shooter) {

                        shooter.kills++;
                    }


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


                                    broadcast(
                                        room,
                                        roomState(room)
                                    );
                                }

                            },
                            800
                        );
                    }
                }
            }


            /*
               STATE
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
   START SERVER
========================================= */

server.listen(
    PORT,
    () => {

        console.log(
            "RIVALS FPS server running on port " +
            PORT
        );

    }
);
