
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'GAME4.html'));
});

app.get('/GAME4.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'GAME4.html'));
});

const wss = new WebSocket.Server({ noServer: true });
const rooms = new Map();

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function getPlayers(room) {
  return [...room.players.values()].map(player => ({
    id: player.id,
    name: player.name,
    team: player.team,
    role: player.role
  }));
}

function broadcast(room, data, except = null) {
  if (!room) return;

  for (const player of room.players.values()) {
    if (player.ws !== except) {
      send(player.ws, data);
    }
  }
}

function updateRoom(room) {
  const players = getPlayers(room);

  broadcast(room, {
    type: 'roster',
    code: room.code,
    mode: room.mode,
    maxPlayers: room.maxPlayers,
    count: players.length,
    players
  });
}

function removePlayer(ws) {
  const code = ws.roomCode;
  if (!code) return;

  ws.roomCode = null;

  const room = rooms.get(code);
  if (!room) return;

  const playerId = ws.playerId;
  room.players.delete(playerId);

  if (room.players.size === 0) {
    rooms.delete(code);
    console.log('Room closed:', code);
    return;
  }

  if (room.hostId === playerId) {
    const nextPlayer = room.players.values().next().value;

    if (nextPlayer) {
      room.hostId = nextPlayer.id;
      nextPlayer.role = 'host';
    }
  }

  broadcast(room, {
    type: 'player-left',
    playerId,
    players: getPlayers(room)
  });

  updateRoom(room);
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.roomCode = null;
  ws.playerId = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  send(ws, {
    type: 'server-ready',
    version: 2
  });

  ws.on('message', raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || typeof msg !== 'object') return;

    // CREATE ROOM
    if (msg.type === 'create') {
      if (ws.roomCode) {
        return send(ws, {
          type: 'server-error',
          message: 'უკვე ხარ ოთახში'
        });
      }

      const code = String(msg.code || '').toUpperCase();
      const name = String(msg.name || 'Player').slice(0, 16) || 'Player';

      const mode = ['1v1', '3v3', '5v5'].includes(msg.mode)
        ? msg.mode
        : '1v1';

      const maxPlayers = {
        '1v1': 2,
        '3v3': 6,
        '5v5': 10
      }[mode];

      if (!/^[A-Z0-9]{6}$/.test(code)) {
        return send(ws, {
          type: 'server-error',
          message: 'Room Code უნდა შედგებოდეს 6 ასოსგან ან ციფრისგან'
        });
      }

      if (rooms.has(code)) {
        return send(ws, {
          type: 'server-error',
          message: 'ეს Room Code უკვე დაკავებულია'
        });
      }

      const id = makeId();

      const room = {
        code,
        hostId: id,
        mode,
        maxPlayers,
        players: new Map(),
        started: false,
        map: 'arena'
      };

      room.players.set(id, {
        id,
        ws,
        name,
        team: 0,
        role: 'host'
      });

      rooms.set(code, room);

      ws.roomCode = code;
      ws.playerId = id;

      send(ws, {
        type: 'room-created',
        code,
        playerId: id,
        name,
        mode,
        maxPlayers,
        count: 1,
        players: getPlayers(room)
      });

      updateRoom(room);

      console.log(`ROOM CREATED ${code} (${mode})`);
      return;
    }

    // JOIN ROOM
    if (msg.type === 'join') {
      if (ws.roomCode) {
        return send(ws, {
          type: 'server-error',
          message: 'უკვე ხარ ოთახში'
        });
      }

      const code = String(msg.code || '').toUpperCase();
      const name = String(msg.name || 'Player').slice(0, 16) || 'Player';
      const room = rooms.get(code);

      if (!room) {
        return send(ws, {
          type: 'room-not-found'
        });
      }

      if (room.started) {
        return send(ws, {
          type: 'room-started',
          message: 'თამაში უკვე დაწყებულია'
        });
      }

      if (room.players.size >= room.maxPlayers) {
        return send(ws, {
          type: 'room-full',
          maxPlayers: room.maxPlayers
        });
      }

      const id = makeId();
      const counts = [0, 0];

      for (const player of room.players.values()) {
        counts[player.team]++;
      }

      const team = counts[0] <= counts[1] ? 0 : 1;

      room.players.set(id, {
        id,
        ws,
        name,
        team,
        role: 'player'
      });

      ws.roomCode = code;
      ws.playerId = id;

      send(ws, {
        type: 'joined',
        code,
        playerId: id,
        name,
        mode: room.mode,
        maxPlayers: room.maxPlayers,
        count: room.players.size,
        players: getPlayers(room)
      });

      broadcast(room, {
        type: 'peer-joined',
        player: {
          id,
          name,
          team,
          role: 'player'
        },
        players: getPlayers(room)
      }, ws);

      broadcast(room, {
        type: 'player-joined',
        player: {
          id,
          name,
          team,
          role: 'player'
        },
        players: getPlayers(room)
      }, ws);

      updateRoom(room);

      console.log(
        `JOINED ${code}: ${room.players.size}/${room.maxPlayers}`
      );

      return;
    }

    const room = rooms.get(ws.roomCode);

    if (!room || !ws.playerId) return;

    const currentPlayer = room.players.get(ws.playerId);

    if (!currentPlayer) return;

    // UPDATE PLAYER NAME
    if (msg.type === 'hello') {
      currentPlayer.name =
        String(msg.name || 'Player').slice(0, 16) || 'Player';

      updateRoom(room);
      return;
    }

    // START MATCH
    if (msg.type === 'start') {
      if (ws.playerId !== room.hostId) {
        return send(ws, {
          type: 'server-error',
          message: 'თამაშის დაწყება მხოლოდ ოთახის შემქმნელს შეუძლია'
        });
      }

      if (room.players.size < room.maxPlayers) {
        return send(ws, {
          type: 'not-enough-players',
          count: room.players.size,
          maxPlayers: room.maxPlayers
        });
      }

      room.started = true;
      room.map = ['arena', 'field'].includes(msg.map)
        ? msg.map
        : 'arena';

      broadcast(room, {
        type: 'match-start',
        mode: room.mode,
        maxPlayers: room.maxPlayers,
        map: room.map,
        players: getPlayers(room)
      });

      return;
    }

    // OLD CLIENT RELAY
    if (msg.type === 'relay') {
      broadcast(room, {
        type: 'relay',
        from: ws.playerId,
        data: msg.data
      }, ws);

      return;
    }

    // PLAYER EVENTS
    if (
      msg.type === 'state' ||
      msg.type === 'hit' ||
      msg.type === 'round' ||
      msg.type === 'map' ||
      msg.type === 'event'
    ) {
      broadcast(room, {
        type: 'player-event',
        from: ws.playerId,
        playerId: ws.playerId,
        team: currentPlayer.team,
        event: msg
      }, ws);
    }
  });

  ws.on('close', () => removePlayer(ws));
  ws.on('error', () => removePlayer(ws));
});

function makeId() {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 9)
  );
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'SchoolGame 3D Multiplayer',
    rooms: rooms.size
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('==============================');
  console.log(' SCHOOLGAME 3D SERVER');
  console.log('==============================');
  console.log('Port:', PORT);
  console.log('Game: /GAME4.html');
  console.log('WebSocket: /ws');
});
