const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_SCORE = 10;
const TICK = 50;
const MAP_W = 1600;
const MAP_H = 900;
const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 7;
const BOT_SPEED = 5.2;
const BULLET_SPEED = 22;
const BULLET_LIFE = 90;
const SHOOT_COOLDOWN = 180;

const WALLS = [
  {x:0,y:0,w:1600,h:35},
  {x:0,y:865,w:1600,h:35},
  {x:0,y:0,w:35,h:900},
  {x:1565,y:0,w:35,h:900},
  {x:650,y:100,w:300,h:35},
  {x:650,y:765,w:300,h:35},
  {x:770,y:300,w:60,h:300}
];

const rooms = new Map();

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(room, data) {
  for (const p of room.players.values()) if (p.ws) send(p.ws, data);
}
function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  do { s = ""; for(let i=0;i<5;i++) s += chars[Math.floor(Math.random()*chars.length)]; } while(rooms.has(s));
  return s;
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function normalizeAngle(a){while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a}
function circleRectHit(x,y,r,rect){
  const cx=clamp(x,rect.x,rect.x+rect.w),cy=clamp(y,rect.y,rect.y+rect.h);
  return Math.hypot(x-cx,y-cy)<r;
}
function blocked(x,y,r=PLAYER_RADIUS){
  for(const w of WALLS) if(circleRectHit(x,y,r,w)) return true;
  return false;
}
function movePlayer(p,dx,dy){
  const nx=p.x+dx;
  if(!blocked(nx,p.y)) p.x=clamp(nx,PLAYER_RADIUS+35,MAP_W-PLAYER_RADIUS-35);
  const ny=p.y+dy;
  if(!blocked(p.x,ny)) p.y=clamp(ny,PLAYER_RADIUS+35,MAP_H-PLAYER_RADIUS-35);
}
function clearLine(x1,y1,x2,y2){
  const steps=Math.ceil(Math.hypot(x2-x1,y2-y1)/12);
  for(let i=1;i<steps;i++){
    const t=i/steps,x=x1+(x2-x1)*t,y=y1+(y2-y1)*t;
    for(const w of WALLS) if(x>=w.x&&x<=w.x+w.w&&y>=w.y&&y<=w.y+w.h) return false;
  }
  return true;
}
function spawnPoint(slot){
  const points = slot===1 ? [
    {x:220,y:450},{x:250,y:300},{x:250,y:600}
  ] : [
    {x:1380,y:450},{x:1350,y:300},{x:1350,y:600}
  ];
  return points[Math.floor(Math.random()*points.length)];
}
function makePlayer(id,name,slot,ws,isBot=false){
  const sp=spawnPoint(slot);
  return {
    id,name:(name||"PLAYER").slice(0,16),ws,isBot,
    x:sp.x,y:sp.y,angle:slot===1?0:Math.PI,hp:100,alive:true,kills:0,
    input:{w:false,a:false,s:false,d:false,shift:false},
    shooting:false,lastShot:0,respawnAt:0
  };
}
function roomState(room){
  return {
    type:"state",
    players:[...room.players.values()].map(p=>({
      id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,alive:p.alive
    })),
    bullets:room.bullets.map(b=>({x:b.x,y:b.y,owner:b.owner})),
    score:{p1:room.score.p1,p2:room.score.p2}
  };
}
function startRoom(room){
  if(room.started) return;
  if(room.players.size<2) return;
  room.started=true;
  for(const p of room.players.values()) {p.hp=100;p.alive=true;p.respawnAt=0;}
  broadcast(room,{type:"message",message:"⚔️ MATCH STARTED!"});
}
function addBot(room){
  if(room.bot || room.players.size>=2) return;
  const bot=makePlayer("bot","BOT",2,null,true);
  room.bot=bot;room.players.set("bot",bot);
  startRoom(room);
  broadcast(room,{type:"bot_joined"});
}
function removeBot(room){
  if(!room.bot)return;
  room.players.delete("bot");room.bot=null;
}
function fire(room,p){
  const now=Date.now();
  if(!p.alive || now-p.lastShot<SHOOT_COOLDOWN) return;
  p.lastShot=now;
  const spread=p.isBot?0.035:0.008;
  const a=p.angle+(Math.random()-.5)*spread;
  room.bullets.push({x:p.x+Math.cos(a)*26,y:p.y+Math.sin(a)*26,vx:Math.cos(a)*BULLET_SPEED,vy:Math.sin(a)*BULLET_SPEED,owner:p.id,life:BULLET_LIFE});
}
function botThink(room,bot){
  const targets=[...room.players.values()].filter(p=>p.id!=="bot"&&p.alive);
  if(!targets.length){bot.shooting=false;return}
  let target=targets[0],best=Infinity;
  for(const p of targets){const d=Math.hypot(p.x-bot.x,p.y-bot.y);if(d<best){best=d;target=p}}
  const desired=Math.atan2(target.y-bot.y,target.x-bot.x);
  const diff=normalizeAngle(desired-bot.angle);
  bot.angle=normalizeAngle(bot.angle+clamp(diff,-0.09,0.09));
  bot.shooting=Math.abs(diff)<0.18 && clearLine(bot.x,bot.y,target.x,target.y);
  bot.input={w:false,a:false,s:false,d:false,shift:false};
  if(best>360) bot.input.w=true;
  else if(best<170) bot.input.s=true;
  else {
    const side=normalizeAngle(desired+Math.PI/2);
    if(Math.sin(Date.now()/450)>0) bot.input.a=true; else bot.input.d=true;
  }
}
function respawn(p,slot){
  const sp=spawnPoint(slot);
  p.x=sp.x;p.y=sp.y;p.hp=100;p.alive=true;p.respawnAt=0;
}
function scoreFor(room,id){
  if(id==="p1") room.score.p1++;
  else room.score.p2++;
}
function killPlayer(room,victim,attacker){
  victim.hp=0;victim.alive=false;victim.respawnAt=Date.now()+900;
  scoreFor(room,attacker);
  broadcast(room,{type:"message",message:`💥 ${attacker===victim.id?"":(room.players.get(attacker)?.name||"PLAYER")} გაიმარჯვა დუელში`});
  if(room.score.p1>=MAX_SCORE||room.score.p2>=MAX_SCORE){
    broadcast(room,{type:"game_over",winner:room.score.p1>=MAX_SCORE?"p1":"p2"});
    room.started=false;room.bullets=[];
    for(const p of room.players.values()) p.input={w:false,a:false,s:false,d:false,shift:false};
  }
}
function tick(){
  const now=Date.now();
  for(const room of rooms.values()){
    if(room.started){
      if(room.bot) botThink(room,room.bot);
      for(const p of room.players.values()){
        if(!p.alive){
          if(now>=p.respawnAt && room.score.p1<MAX_SCORE && room.score.p2<MAX_SCORE){
            respawn(p,p.id==="p1"?1:2);
          }
          continue;
        }
        let dx=0,dy=0;
        const speed=p.isBot?BOT_SPEED:(p.input.shift?PLAYER_SPEED*1.25:PLAYER_SPEED);
        if(p.input.w)dy-=1;if(p.input.s)dy+=1;if(p.input.a)dx-=1;if(p.input.d)dx+=1;
        if(dx||dy){const len=Math.hypot(dx,dy);movePlayer(p,dx/len*speed,dy/len*speed)}
        if(p.shooting) fire(room,p);
      }
      for(let i=room.bullets.length-1;i>=0;i--){
        const b=room.bullets[i];
        b.x+=b.vx;b.y+=b.vy;b.life--;
        let dead=b.life<=0||b.x<0||b.x>MAP_W||b.y<0||b.y>MAP_H;
        for(const w of WALLS) if(b.x>=w.x&&b.x<=w.x+w.w&&b.y>=w.y&&b.y<=w.y+w.h){dead=true;break}
        if(!dead){
          for(const p of room.players.values()){
            if(!p.alive||p.id===b.owner)continue;
            if(Math.hypot(p.x-b.x,p.y-b.y)<PLAYER_RADIUS+7){
              p.hp-=34;dead=true;
              if(p.ws) send(p.ws,{type:"message",message:"💥 HIT!"});
              if(p.hp<=0)killPlayer(room,p,b.owner);
              break;
            }
          }
        }
        if(dead)room.bullets.splice(i,1);
      }
    }
    broadcast(room,roomState(room));
  }
}
setInterval(tick,TICK);

const server=http.createServer((req,res)=>{
  let reqPath=(req.url||"/").split("?")[0];
  if(reqPath==="/")reqPath="/index.html";
  const safe=path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, "");
  const file=path.join(__dirname,safe);
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});res.end("Not found");return}
    const ext=path.extname(file).toLowerCase();
    const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
    res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-store"});
    res.end(data);
  });
});
const wss=new WebSocket.Server({server});

wss.on("connection",(ws)=>{
  let currentRoom=null,currentPlayer=null;
  send(ws,{type:"connected"});
  ws.on("message",raw=>{
    let d;try{d=JSON.parse(raw.toString())}catch{return}
    if(d.type==="create_room"){
      if(currentRoom)return;
      const code=randomCode();
      const room={code,players:new Map(),bullets:[],score:{p1:0,p2:0},started:false,bot:null};
      const p=makePlayer("p1",d.name||"PLAYER 1",1,ws,false);
      room.players.set("p1",p);rooms.set(code,room);currentRoom=room;currentPlayer=p;
      send(ws,{type:"room_created",room:code,playerId:"p1"});
      broadcast(room,roomState(room));
      return;
    }
    if(d.type==="join_room"){
      const code=String(d.room||"").toUpperCase();const room=rooms.get(code);
      if(!room){send(ws,{type:"error",message:"Room ვერ მოიძებნა."});return}
      if(room.started||room.players.size>=2){send(ws,{type:"error",message:"Room უკვე დაწყებულია."});return}
      if(room.bot)removeBot(room);
      const p=makePlayer("p2",d.name||"PLAYER 2",2,ws,false);
      room.players.set("p2",p);currentRoom=room;currentPlayer=p;
      send(ws,{type:"room_joined",room:code,playerId:"p2"});
      startRoom(room);broadcast(room,roomState(room));return;
    }
    if(d.type==="add_bot"){
      if(!currentRoom||!currentPlayer)return;
      if(currentRoom.players.size<2&&!currentRoom.bot)addBot(currentRoom);
      return;
    }
    if(d.type==="input"){
      if(!currentPlayer||!currentRoom||!currentRoom.started)return;
      const k=d.keys||{};
      currentPlayer.input={w:!!k.w,a:!!k.a,s:!!k.s,d:!!k.d,shift:!!k.shift};
      if(Number.isFinite(d.angle))currentPlayer.angle=normalizeAngle(d.angle);
      currentPlayer.shooting=!!d.shooting;return;
    }
    if(d.type==="reload")return;
  });
  ws.on("close",()=>{
    if(!currentRoom||!currentPlayer)return;
    const room=currentRoom;
    room.players.delete(currentPlayer.id);
    if(currentPlayer.id==="p1"&&room.players.has("p2")){
      const p=room.players.get("p2");p.id="p1";p.name=p.name;room.players.delete("p2");room.players.set("p1",p);
    }
    if(room.bot&&room.players.size<2){removeBot(room)}
    room.started=room.players.size>=2;
    if(room.players.size===0)rooms.delete(room.code);else broadcast(room,roomState(room));
  });
});

server.listen(PORT,()=>console.log(`RIVALS server running on port ${PORT}`));
