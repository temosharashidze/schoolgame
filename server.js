const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_SCORE = 10;

const server = http.createServer((req, res) => {
    // მთავარი გვერდი უნდა იყოს index.html
    let file = req.url === "/" ? "/index.html" : req.url;

    file = decodeURIComponent(file);

    const filePath = path.join(__dirname, file);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });
            res.end("404 - File not found");
            return;
        }

        let contentType = "text/plain";

        if (file.endsWith(".html")) {
            contentType = "text/html; charset=utf-8";
        } else if (file.endsWith(".js")) {
            contentType = "application/javascript; charset=utf-8";
        } else if (file.endsWith(".css")) {
            contentType = "text/css; charset=utf-8";
        } else if (file.endsWith(".json")) {
            contentType = "application/json; charset=utf-8";
        } else if (file.endsWith(".png")) {
            contentType = "image/png";
        } else if (file.endsWith(".jpg") || file.endsWith(".jpeg")) {
            contentType = "image/jpeg";
        } else if (file.endsWith(".svg")) {
            contentType = "image/svg+xml";
        }

        res.writeHead(200, {
            "Content-Type": contentType
        });

        res.end(data);
    });
});

const wss = new WebSocket.Server({
    server
});

const rooms = new Map();

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
        bullets: [],
        bot: null,
        started: false,
        scores: {},
        lastUpdate: Date.now()
    };

    rooms.set(code, room);

    return room;
}

function broadcast(room, message) {
    const text = JSON.stringify(message);

    room.players.forEach(player => {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(text);
        }
    });

    if (room.bot && room.bot.ws && room.bot.ws.readyState === WebSocket.OPEN) {
        room.bot.ws.send(text);
    }
}

function getRoomState(room) {
    const players = [];

    room.players.forEach(player => {
        players.push({
            id: player.id,
            name: player.name,
            x: player.x,
            y: player.y,
            angle: player.angle,
            hp: player.hp
        });
    });

    if (room.bot) {
        players.push({
            id: room.bot.id,
            name: room.bot.name,
            x: room.bot.x,
            y: room.bot.y,
            angle: room.bot.angle,
            hp: room.bot.hp
        });
    }

    return {
        type: "state",
        room: room.code,
        started: room.started,
        lobby: room.players.size < 2 && !room.bot,
        players,
        bullets: room.bullets,
        scores: room.scores
    };
}

function sendState(room) {
    broadcast(room, getRoomState(room));
}

function addBot(room) {
    if (room.bot) return;
    if (room.players.size >= 2) return;

    room.bot = {
        id: "BOT",
        name: "BOT",
        x: 760,
        y: 400,
        angle: 0,
        hp: 100,
        ws: null
    };

    room.started = true;

    broadcast(room, {
        type: "bot_joined",
        name: "BOT"
    });

    sendState(room);
}

function removeBot(room) {
    if (!room.bot) return;

    room.bot = null;
    room.started = false;

    sendState(room);
}

function resetRound(room) {
    room.bullets = [];

    room.players.forEach((player, index) => {
        player.hp = 100;

        if (index === 0) {
            player.x = 350;
            player.y = 400;
        } else {
            player.x = 850;
            player.y = 400;
        }
    });

    if (room.bot) {
        room.bot.hp = 100;
        room.bot.x = 850;
        room.bot.y = 400;
    }

    sendState(room);
}

function startRoom(room) {
    if (room.started) return;

    const participantCount =
        room.players.size + (room.bot ? 1 : 0);

    if (participantCount < 2) return;

    room.started = true;

    broadcast(room, {
        type: "game_started"
    });

    resetRound(room);
}

function removeRoomIfEmpty(room) {
    if (room.players.size === 0 && !room.bot) {
        rooms.delete(room.code);
    }
}

wss.on("connection", ws => {
    let currentRoom = null;
    let currentPlayer = null;

    ws.send(
        JSON.stringify({
            type: "connected"
        })
    );

    ws.on("message", raw => {
        let data;

        try {
            data = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (data.type === "create_room") {
            if (currentRoom) return;

            const room = createRoom();

            const player = {
                id: "p_" + Math.random().toString(36).slice(2),
                name:
                    String(data.name || "Player")
                        .slice(0, 16),
                x: 350,
                y: 400,
                angle: 0,
                hp: 100,
                ws
            };

            room.players.set(player.id, player);
            room.scores[player.id] = 0;

            currentRoom = room;
            currentPlayer = player;

            ws.send(
                JSON.stringify({
                    type: "room_created",
                    room: room.code,
                    playerId: player.id
                })
            );

            sendState(room);

            return;
        }

        if (data.type === "join_room") {
            if (currentRoom) return;

            const code = String(data.room || "")
                .trim()
                .toUpperCase();

            const room = rooms.get(code);

            if (!room) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "ოთახი ვერ მოიძებნა"
                    })
                );
                return;
            }

            if (room.players.size >= 2) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "ოთახი უკვე სავსეა"
                    })
                );
                return;
            }

            if (room.bot) {
                room.bot = null;
            }

            const player = {
                id: "p_" + Math.random().toString(36).slice(2),
                name:
                    String(data.name || "Player")
                        .slice(0, 16),
                x: 850,
                y: 400,
                angle: Math.PI,
                hp: 100,
                ws
            };

            room.players.set(player.id, player);
            room.scores[player.id] = 0;

            currentRoom = room;
            currentPlayer = player;

            ws.send(
                JSON.stringify({
                    type: "room_joined",
                    room: room.code,
                    playerId: player.id
                })
            );

            if (room.players.size >= 2) {
                startRoom(room);
            } else {
                sendState(room);
            }

            return;
        }

        if (data.type === "add_bot") {
            if (!currentRoom || !currentPlayer) return;

            if (currentRoom.players.size >= 2) {
                return;
            }

            if (currentRoom.bot) {
                return;
            }

            addBot(currentRoom);

            return;
        }

        if (data.type === "input") {
            if (!currentRoom || !currentPlayer) return;

            if (!currentRoom.started) return;

            const dx = Number(data.dx) || 0;
            const dy = Number(data.dy) || 0;

            const speed = 6;

            currentPlayer.x += dx * speed;
            currentPlayer.y += dy * speed;

            currentPlayer.x = Math.max(
                40,
                Math.min(1160, currentPlayer.x)
            );

            currentPlayer.y = Math.max(
                40,
                Math.min(760, currentPlayer.y)
            );

            if (typeof data.angle === "number") {
                currentPlayer.angle = data.angle;
            }

            sendState(currentRoom);

            return;
        }

        if (data.type === "shoot") {
            if (!currentRoom || !currentPlayer) return;
            if (!currentRoom.started) return;

            const bullet = {
                id: "b_" + Math.random().toString(36).slice(2),
                owner: currentPlayer.id,
                x: currentPlayer.x,
                y: currentPlayer.y,
                angle:
                    typeof data.angle === "number"
                        ? data.angle
                        : currentPlayer.angle,
                speed: 14,
                life: 100
            };

            currentRoom.bullets.push(bullet);

            return;
        }

        if (data.type === "leave_room") {
            if (!currentRoom || !currentPlayer) return;

            const room = currentRoom;

            room.players.delete(currentPlayer.id);
            delete room.scores[currentPlayer.id];

            currentRoom = null;
            currentPlayer = null;

            if (room.bot) {
                removeBot(room);
            }

            sendState(room);
            removeRoomIfEmpty(room);

            return;
        }
    });

    ws.on("close", () => {
        if (!currentRoom || !currentPlayer) {
            return;
        }

        const room = currentRoom;

        room.players.delete(currentPlayer.id);
        delete room.scores[currentPlayer.id];

        if (room.bot) {
            room.bot = null;
        }

        room.started = false;
        room.bullets = [];

        sendState(room);

        removeRoomIfEmpty(room);
    });
});

setInterval(() => {
    rooms.forEach(room => {
        if (!room.started) return;

        const now = Date.now();
        const delta = Math.min(
            0.05,
            (now - room.lastUpdate) / 1000
        );

        room.lastUpdate = now;

        room.bullets.forEach(bullet => {
            bullet.x += Math.cos(bullet.angle) * bullet.speed;
            bullet.y += Math.sin(bullet.angle) * bullet.speed;
            bullet.life -= delta * 60;
        });

        room.bullets = room.bullets.filter(bullet => {
            if (bullet.life <= 0) return false;

            if (
                bullet.x < 0 ||
                bullet.x > 1200 ||
                bullet.y < 0 ||
                bullet.y > 800
            ) {
                return false;
            }

            let hit = false;

            room.players.forEach(player => {
                if (player.id === bullet.owner) return;
                if (player.hp <= 0) return;

                const dx = player.x - bullet.x;
                const dy = player.y - bullet.y;
                const distance = Math.sqrt(
                    dx * dx + dy * dy
                );

                if (distance < 24) {
                    player.hp -= 25;
                    hit = true;

                    if (player.hp <= 0) {
                        room.scores[bullet.owner] =
                            (room.scores[bullet.owner] || 0) + 1;

                        player.hp = 100;

                        if (
                            room.scores[bullet.owner] >=
                            MAX_SCORE
                        ) {
                            room.started = false;

                            broadcast(room, {
                                type: "game_over",
                                winner: bullet.owner,
                                scores: room.scores
                            });

                            setTimeout(() => {
                                if (
                                    rooms.has(room.code)
                                ) {
                                    resetRound(room);
                                }
                            }, 3000);
                        } else {
                            player.x =
                                player.x < 600
                                    ? 850
                                    : 350;
                            player.y = 400;
                        }
                    }
                }
            });

            if (room.bot && room.bot.hp > 0) {
                const dx = room.bot.x - bullet.x;
                const dy = room.bot.y - bullet.y;
                const distance = Math.sqrt(
                    dx * dx + dy * dy
                );

                if (distance < 24) {
                    room.bot.hp -= 25;
                    hit = true;

                    if (room.bot.hp <= 0) {
                        room.scores[bullet.owner] =
                            (room.scores[bullet.owner] || 0) + 1;

                        room.bot.hp = 100;
                        room.bot.x = 850;
                        room.bot.y = 400;

                        if (
                            room.scores[bullet.owner] >=
                            MAX_SCORE
                        ) {
                            room.started = false;

                            broadcast(room, {
                                type: "game_over",
                                winner: bullet.owner,
                                scores: room.scores
                            });

                            setTimeout(() => {
                                if (
                                    rooms.has(room.code)
                                ) {
                                    resetRound(room);
                                }
                            }, 3000);
                        }
                    }
                }
            }

            return !hit;
        });

        // მარტივი BOT AI
        if (room.bot && room.started) {
            const human = Array.from(
                room.players.values()
            )[0];

            if (human) {
                const dx = human.x - room.bot.x;
                const dy = human.y - room.bot.y;

                const distance = Math.sqrt(
                    dx * dx + dy * dy
                );

                if (distance > 120) {
                    room.bot.x +=
                        (dx / Math.max(distance, 1)) * 2.2;

                    room.bot.y +=
                        (dy / Math.max(distance, 1)) * 2.2;
                }

                room.bot.angle = Math.atan2(dy, dx);
            }
        }

        sendState(room);
    });
}, 50);

server.listen(PORT, () => {
    console.log(`SchoolGame server running on port ${PORT}`);
});
