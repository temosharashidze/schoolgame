const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_SCORE = 10;
const TICK = 50;
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
const W=MAP[0].length,H=MAP.length;

const server=http.createServer((req,res)=>{
  let file=req.url==="/" ? "/index.html" : req.url.split("?")[0];
  const safe=path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const filePath=path.join(__dirname,safe);
  fs.readFile(filePath,(err,data)=>{
    if(err){res.writeHead(404);res.end("Not found");return}
    const ext=path.extname(filePath);
    const type={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json"}[ext]||"application/octet-stream";
    res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"});
    res.end(data);
  });
});

const wss=new WebSocket.Server({server});
const rooms=new Map();
const clients=new Map();

function code(){let s="";const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";do{s="";for(let i=0;i<5;i++)s+=chars[Math.floor(Math.random()*chars.length)]}while(rooms.has(s));return s}
function blocked(x,y,r=.18){
  const points=[[x-r,y-r],[x+r,y-r],[x-r,y+r],[x+r,y+r]];
  return points.some(([px,py])=>{
    const mx=Math.floor(px),my=Math.floor(py);
    return mx<0||my<0||mx>=W||my>=H||MAP[my][mx]==="1";
  });
}
function movePlayer(p,dx,dy){
  const nx=p.x+dx,ny=p.y+dy;
  if(!blocked(nx,p.y))p.x=nx;
  if(!blocked(p.x,ny))p.y=ny;
}
function roomState(r){
  return {
    type:"state",
    players:[...r.players.values()].map(p=>({
      id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,kills:p.kills,alive:p.alive
    })),
    bullets:r.bullets.map(b=>({x:b.x,y:b.y})),
    score:{p1:r.players.get("p1")?.kills||0,p2:[...r.players.values()].find(p=>p.id!=="p1")?.kills||0}
  };
}
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function broadcast(r,obj){for(const p of r.players.values())send(p.ws,obj)}
function spawn(p){
  const spots=[[2,2],[13,11],[2,11],[13,2]];
  const s=spots[Math.floor(Math.random()*spots.length)];
  p.x=s[0]+.5;p.y=s[1]+.5;p.hp=100;p.alive=true;p.cool=0;
}
function addBot(r){
  if(r.bot)return;
  const bot={id:"bot",name:"BOT",ws:null,x:13.5,y:11.5,angle:Math.PI,hp:100,kills:0,alive:true,cool:0,bot:true};
  r.bot=bot;r.players.set("bot",bot);r.started=true;
  broadcast(r,{type:"bot_joined"});
  broadcast(r,roomState(r));
}
function removePlayer(ws){
  const c=clients.get(ws);if(!c)return;
  const r=c.room;if(r){
    r.players.delete(c.id);
    if(r.bot){r.players.delete("bot");r.bot=null}
    if(r.players.size===0)rooms.delete(r.code);
    else broadcast(r,{type:"message",message:"მოთამაშე გავიდა."});
  }
  clients.delete(ws);
}
function hitTestBullet(r,b){
  for(const p of r.players.values()){
    if(p.id===b.owner||!p.alive)continue;
    const d=Math.hypot(p.x-b.x,p.y-b.y);
    if(d<.34)return p;
  }
  return null;
}
function shoot(r,p){
  if(!p.alive||p.cool>0)return;
  p.cool=260;
  r.bullets.push({x:p.x+Math.cos(p.angle)*.35,y:p.y+Math.sin(p.angle)*.35,vx:Math.cos(p.angle)*.32,vy:Math.sin(p.angle)*.32,owner:p.id,life:1200});
}
function botThink(r,b){
  const targets=[...r.players.values()].filter(p=>p.id!=="bot"&&p.alive);
  if(!targets.length)return;
  const t=targets[0],dx=t.x-b.x,dy=t.y-b.y;
  const dist=Math.hypot(dx,dy);
  let desired=Math.atan2(dy,dx);
  let diff=desired-b.angle;
  while(diff>Math.PI)diff-=Math.PI*2;while(diff<-Math.PI)diff+=Math.PI*2;
  b.angle+=Math.max(-.09,Math.min(.09,diff));
  if(dist>3){
    const speed=.055;
    movePlayer(b,Math.cos(b.angle)*speed,Math.sin(b.angle)*speed);
  }
  if(dist<9 && Math.abs(diff)<.25)shoot(r,b);
}
wss.on("connection",ws=>{
  clients.set(ws,{id:null,room:null});
  send(ws,{type:"connected"});
  ws.on("message",raw=>{
    let d;try{d=JSON.parse(raw)}catch{return}
    const c=clients.get(ws);if(!c)return;

    if(d.type==="create_room"){
      const r={code:code(),players:new Map(),bullets:[],started:false,bot:null};
      const p={id:"p1",name:String(d.name||"PLAYER").slice(0,16),ws,x:2.5,y:2.5,angle:0,hp:100,kills:0,alive:true,cool:0,bot:false};
      r.players.set(p.id,p);rooms.set(r.code,r);c.id=p.id;c.room=r;
      send(ws,{type:"room_created",room:r.code,playerId:p.id});
      send(ws,roomState(r));
      return;
    }

    if(d.type==="join_room"){
      const r=rooms.get(String(d.room||"").toUpperCase());
      if(!r){send(ws,{type:"error",message:"Room ვერ მოიძებნა."});return}
      if(r.players.size>=2){send(ws,{type:"error",message:"Room უკვე სავსეა."});return}
      if(r.bot){r.players.delete("bot");r.bot=null}
      const p={id:"p2",name:String(d.name||"PLAYER 2").slice(0,16),ws,x:13.5,y:11.5,angle:Math.PI,hp:100,kills:0,alive:true,cool:0,bot:false};
      r.players.set(p.id,p);r.started=true;c.id=p.id;c.room=r;
      send(ws,{type:"room_joined",room:r.code,playerId:p.id});
      broadcast(r,{type:"message",message:"👥 მოთამაშეები მზად არიან!"});
      return;
    }

    if(d.type==="add_bot"){
      const r=c.room;if(!r||r.players.size>=2)return;
      addBot(r);return;
    }

    if(d.type==="input"){
      const r=c.room,p=r?.players.get(c.id);if(!r||!p||!p.alive)return;
      const k=d.keys||{};
      const speed=.11;
      let dx=0,dy=0;
      if(k.w){dx+=Math.cos(p.angle)*speed;dy+=Math.sin(p.angle)*speed}
      if(k.s){dx-=Math.cos(p.angle)*speed;dy-=Math.sin(p.angle)*speed}
      if(k.a){dx+=Math.cos(p.angle-Math.PI/2)*speed;dy+=Math.sin(p.angle-Math.PI/2)*speed}
      if(k.d){dx+=Math.cos(p.angle+Math.PI/2)*speed;dy+=Math.sin(p.angle+Math.PI/2)*speed}
      movePlayer(p,dx,dy);
      const md=Number(d.mouseDX)||0;
      p.angle+=md*.0025;
      if(d.shooting)shoot(r,p);
    }
  });
  ws.on("close",()=>removePlayer(ws));
});

setInterval(()=>{
  for(const r of rooms.values()){
    for(const p of r.players.values()){
      if(p.cool>0)p.cool-=TICK;
      if(p.bot)botThink(r,p);
    }
    for(let i=r.bullets.length-1;i>=0;i--){
      const b=r.bullets[i];
      b.x+=b.vx;b.y+=b.vy;b.life-=TICK;
      if(b.life<=0||blocked(b.x,b.y,.04)){r.bullets.splice(i,1);continue}
      const target=hitTestBullet(r,b);
      if(target){
        target.hp-=34;
        r.bullets.splice(i,1);
        if(target.ws)send(target.ws,{type:"message",message:"💥 HIT! HP -34"});
        const owner=r.players.get(b.owner);
        if(target.hp<=0){
          target.alive=false;
          if(owner)owner.kills++;
          if(owner && owner.kills>=MAX_SCORE){
            broadcast(r,{type:"game_over",winner:owner.id});
            for(const p of r.players.values())spawn(p);
            r.bullets=[];
            for(const p of r.players.values())p.kills=0;
          }else{
            setTimeout(()=>{if(r.players.has(target.id))spawn(target)},700);
          }
        }
      }
    }
    if(r.players.size)broadcast(r,roomState(r));
  }
},TICK);

server.listen(PORT,()=>console.log("RIVALS FPS server running on port "+PORT));
