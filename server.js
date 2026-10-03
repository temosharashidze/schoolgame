const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'GAME4.html')));
app.get('/GAME4.html', (req, res) => res.sendFile(path.join(__dirname, 'GAME4.html')));
app.get('/health', (req, res) => res.json({ ok: true, service: 'SchoolGame 3D Online' }));

const wss = new WebSocket.Server({ noServer: true });
const rooms = new Map();

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.roomCode = null;
  ws.role = null;
  ws.playerName = 'Player';

  ws.on('pong', () => { ws.isAlive = true; });
  console.log('WS CONNECTED', ws._socket?.remoteAddress || '');
  send(ws, { type:'server-ready' });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'create') {
      const code = String(msg.code || '').toUpperCase();
      const name = String(msg.name || 'Player').slice(0, 16) || 'Player';
      if (!/^[A-Z0-9]{6}$/.test(code)) return send(ws, { type:'server-error', message:'არასწორი Room Code' });
      if (rooms.has(code)) return send(ws, { type:'server-error', message:'ეს Room Code უკვე დაკავებულია' });
      rooms.set(code, { host: ws, guest: null });
      ws.roomCode = code; ws.role = 'host'; ws.playerName = name;
      send(ws, { type:'room-created', code });
      console.log(`ROOM CREATED ${code} host=${name}`);
      return;
    }

    if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase();
      const name = String(msg.name || 'Player').slice(0, 16) || 'Player';
      const room = rooms.get(code);
      if (!room || !room.host || room.host.readyState !== WebSocket.OPEN) return send(ws, { type:'room-not-found' });
      if (room.guest && room.guest.readyState === WebSocket.OPEN) return send(ws, { type:'room-full' });
      room.guest = ws;
      ws.roomCode = code; ws.role = 'guest'; ws.playerName = name;
      send(ws, { type:'joined', name: room.host.playerName });
      send(room.host, { type:'peer-joined', name });
      console.log(`ROOM JOINED ${code} guest=${name}`);
      return;
    }

    if (msg.type === 'relay') {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const other = ws === room.host ? room.guest : room.host;
      if (other && other.readyState === WebSocket.OPEN) send(other, { type:'relay', data:msg.data });
    }
  });

  ws.on('close', () => {
    const code = ws.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (room.host === ws) {
      if (room.guest && room.guest.readyState === WebSocket.OPEN) {
        room.guest.roomCode = null;
        send(room.guest, { type:'peer-left' });
      }
      rooms.delete(code);
      console.log(`ROOM CLOSED ${code}`);
    } else if (room.guest === ws) {
      room.guest = null;
      if (room.host && room.host.readyState === WebSocket.OPEN) send(room.host, { type:'peer-left' });
      console.log(`GUEST LEFT ${code}`);
    }
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log(' SCHOOLGAME 3D ONLINE SERVER');
  console.log('=================================');
  console.log('HTTP:', PORT);
  console.log('GAME: /GAME4.html');
  console.log('WS: /ws');
});
