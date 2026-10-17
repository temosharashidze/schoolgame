
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

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

app.get('/GAME6.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'GAME6.html'));
});

const wss = new WebSocket.Server({ noServer: true });

// არსებული GAME4 multiplayer
const rooms = new Map();

// X VS 0-ის ცალკე ონლაინ ოთახები
const xoRooms = new Map();

const xoWins = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function makeId() {
  return crypto.randomBytes(12).toString('hex');
}

function makeRoomCode() {
  let code;

  do {
    code = crypto.randomBytes(4)
      .toString('hex')
      .slice(0, 6)
      .toUpperCase();
  } while (xoRooms.has(code));

  return code;
}

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
  broadcast(room, {
    type: 'roster',
    code: room.code,
    mode: room.mode,
    maxPlayers: room.maxPlayers,
    count: room.players.size,
    players: getPlayers(room)
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

// ==========================================
// X VS 0 ONLINE FUNCTIONS
// ==========================================

function xoWinner(board) {
  for (const line of xoWins) {
    const [a, b, c] = line;

    if (
      board[a] &&
      board[a] === board[b] &&
      board[a] === board[c]
    ) {
      return {
        mark: board[a],
        cells: line
      };
    }
  }

  return null;
}

function xoSnapshot(room) {
  return {
    type: 'xo-state',
    code: room.code,
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    winningCells: room.winningCells,
    draw: room.draw,
    started: room.started,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      mark: p.mark
    }))
  };
}

function xoSendState(room) {
  const state = xoSnapshot(room);

  for (const player of room.players.values()) {
    send(player.ws, {
      ...state,
      playerId: player.id,
      myMark: player.mark
    });
  }
}

function xoBroadcast(room, data) {
  for (const player of room.players.values()) {
    send(player.ws, data);
  }
}

function xoRemovePlayer(ws) {
  const code = ws.xoRoomCode;
  if (!code) return;

  ws.xoRoomCode = null;

  const room = xoRooms.get(code);
  if (!room) return;

  room.players.delete(ws.xoPlayerId);
  ws.xoPlayerId = null;

  if (room.players.size === 0) {
    xoRooms.delete(code);
    console.log('X VS 0 room closed:', code);
    return;
  }

  // დარჩენილი მოთამაშე იმავე ოთახში რჩება
  // და შეუძლია ახალი მოწინააღმდეგის მოწვევა.
  room.board = Array(9).fill('');
  room.turn = 'X';
  room.winner = null;
  room.winningCells = [];
  room.draw = false;
  room.started = false;

  xoBroadcast(room, {
    type: 'xo-opponent-left',
    message: 'მოწინააღმდეგე გაითიშა. დაელოდე ახალ მოთამაშეს.'
  });

  xoSendState(room);
}

// ==========================================
// WEBSOCKET CONNECTION
// ==========================================

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
  ws.xoRoomCode = null;
  ws.xoPlayerId = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  send(ws, {
    type: 'server-ready',
    version: 3
  });

  ws.on('message', raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || typeof msg !== 'object') return;

    // ======================================
    // X VS 0: CREATE ROOM
    // ======================================

    if (msg.type === 'xo-create') {
      if (ws.roomCode || ws.xoRoomCode) {
        return send(ws, {
          type: 'xo-error',
          message: 'ჯერ დატოვე არსებული ოთახი.'
        });
      }

      const code = makeRoomCode();
      const id = makeId();

      const room = {
        code,
        players: new Map(),
        board: Array(9).fill(''),
        turn: 'X',
        winner: null,
        winningCells: [],
        draw: false,
        started: false
      };

      room.players.set(id, {
        id,
        ws,
        name: String(msg.name || 'Player')
          .trim().slice(0, 16) || 'Player',
        mark: 'X'
      });

      xoRooms.set(code, room);

      ws.xoRoomCode = code;
      ws.xoPlayerId = id;

      console.log('X VS 0 room created:', code);

      xoSendState(room);
      return;
    }

    // ======================================
    // X VS 0: JOIN ROOM
    // ======================================

    if (msg.type === 'xo-join') {
      if (ws.roomCode || ws.xoRoomCode) {
        return send(ws, {
          type: 'xo-error',
          message: 'ჯერ დატოვე არსებული ოთახი.'
        });
      }

      const code = String(msg.code || '')
        .trim().toUpperCase();

      const room = xoRooms.get(code);

      if (!room) {
        return send(ws, {
          type: 'xo-error',
          message: 'ოთახი ვერ მოიძებნა. შეამოწმე კოდი.'
        });
      }

      if (room.players.size >= 2) {
        return send(ws, {
          type: 'xo-error',
          message: 'ოთახი უკვე სავსეა.'
        });
      }

      const id = makeId();

      room.players.set(id, {
        id,
        ws,
        name: String(msg.name || 'Player')
          .trim().slice(0, 16) || 'Player',
        mark: '0'
      });

      ws.xoRoomCode = code;
      ws.xoPlayerId = id;

      room.started = true;

      console.log('X VS 0 player joined:', code);

      xoSendState(room);
      return;
    }

    // ======================================
    // X VS 0: GAME ACTIONS
    // ======================================

    if (
      msg.type === 'xo-move' ||
      msg.type === 'xo-reset' ||
      msg.type === 'xo-leave'
    ) {
      const room = xoRooms.get(ws.xoRoomCode);
      const player = room &&
        room.players.get(ws.xoPlayerId);

      if (!room || !player) {
        return send(ws, {
          type: 'xo-error',
          message: 'ონლაინ ოთახში არ ხარ.'
        });
      }

      if (msg.type === 'xo-leave') {
        xoRemovePlayer(ws);
        send(ws, { type: 'xo-left' });
        return;
      }

      if (msg.type === 'xo-reset') {
        if (room.players.size !== 2) {
          return send(ws, {
            type: 'xo-error',
            message: 'ახალი თამაშისთვის ორი მოთამაშეა საჭირო.'
          });
        }

        room.board = Array(9).fill('');
        room.turn = 'X';
        room.winner = null;
        room.winningCells = [];
        room.draw = false;
        room.started = true;

        xoSendState(room);
        return;
      }

      // მხოლოდ ორი მოთამაშის მქონე აქტიურ ოთახში
      // შეიძლება სვლის გაკეთება.
      if (
        !room.started ||
        room.players.size !== 2 ||
        room.winner ||
        room.draw
      ) {
        return;
      }

      const index = Number(msg.index);

      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index > 8
      ) {
        return;
      }

      // სერვერი ამოწმებს სვლის რიგს და ცარიელ უჯრას.
      if (
        player.mark !== room.turn ||
        room.board[index] !== ''
      ) {
        return;
      }

      room.board[index] = player.mark;

      const result = xoWinner(room.board);

      if (result) {
        room.winner = result.mark;
        room.winningCells = result.cells;
      } else if (room.board.every(cell => cell !== '')) {
        room.draw = true;
      } else {
        room.turn = room.turn === 'X' ? '0' : 'X';
      }

      xoSendState(room);
      return;
    }

    // ======================================
    // EXISTING GAME4 MULTIPLAYER
    // ======================================

    if (msg.type === 'create') {
      if (ws.roomCode || ws.xoRoomCode) {
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
      console.log(`GAME4 ROOM CREATED ${code} (${mode})`);
      return;
    }

    if (msg.type === 'join') {
      if (ws.roomCode || ws.xoRoomCode) {
        return send(ws, {
          type: 'server-error',
          message: 'უკვე ხარ ოთახში'
        });
      }

      const code = String(msg.code || '').toUpperCase();
      const name = String(msg.name || 'Player').slice(0, 16) || 'Player';
      const room = rooms.get(code);

      if (!room) {
        return send(ws, { type: 'room-not-found' });
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
        player: { id, name, team, role: 'player' },
        players: getPlayers(room)
      }, ws);

      broadcast(room, {
        type: 'player-joined',
        player: { id, name, team, role: 'player' },
        players: getPlayers(room)
      }, ws);

      updateRoom(room);

      console.log(`GAME4 JOINED ${code}: ${room.players.size}/${room.maxPlayers}`);
      return;
    }

    const room = rooms.get(ws.roomCode);

    if (!room || !ws.playerId) return;

    const currentPlayer = room.players.get(ws.playerId);
    if (!currentPlayer) return;

    if (msg.type === 'hello') {
      currentPlayer.name =
        String(msg.name || 'Player').slice(0, 16) || 'Player';

      updateRoom(room);
      return;
    }

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

    if (msg.type === 'relay') {
      broadcast(room, {
        type: 'relay',
        from: ws.playerId,
        data: msg.data
      }, ws);

      return;
    }

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

  ws.on('close', () => {
    xoRemovePlayer(ws);
    removePlayer(ws);
  });

  ws.on('error', () => {
    xoRemovePlayer(ws);
    removePlayer(ws);
  });
});

// WebSocket keep-alive
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

wss.on('close', () => clearInterval(heartbeat));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'GAMEXO / SchoolGame 3D Multiplayer',
    game4Rooms: rooms.size,
    xoRooms: xoRooms.size
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('==============================');
  console.log(' GAMEXO MULTIPLAYER SERVER');
  console.log('==============================');
  console.log('Port:', PORT);
  console.log('Game4: /GAME4.html');
  console.log('Game6: /GAME6.html');
  console.log('WebSocket: /ws');
});
