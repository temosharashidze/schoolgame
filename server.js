const http=require('http');
const fs=require('fs');
const path=require('path');
const WebSocket=require('ws');

const PORT=process.env.PORT||3000;
const MAX_PLAYERS=4;
const rooms=new Map();

const MAP_SIZE=28;
const blocks=new Map();

function key(x,y,z){return `${x},${y},${z}`}
for(let x=-14;x<14;x++)for(let z=-14;z<14;z++)blocks.set(key(x,0,z),'grass');

function randomCode(){
 let s='';
 const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 do{s='';for(let i=0;i<5;i++)s+=chars[Math.floor(Math.random()*chars.length)]}while(rooms.has(s));
 return s;
}
function send(ws,o){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o))}
function state(room){
 return [...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,slot:p.slot}));
}
function broadcast(room,o){for(const p of room.players.values())send(p.ws,o)}

const server=http.createServer((req,res)=>{
 let file=req.url==='/'?'/index.html':req.url;
 file=path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
 const fp=path.join(__dirname,file);
 if(!fp.startsWith(__dirname)||!fs.existsSync(fp)){res.writeHead(404);return res.end('Not found')}
 const ext=path.extname(fp);
 const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json'};
 res.writeHead(200,{'Content-Type':types[ext]||'text/plain'});
 fs.createReadStream(fp).pipe(res);
});
const wss=new WebSocket.Server({server});

wss.on('connection',ws=>{
 let me=null,room=null;
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==='create'){
    if(room)return;
    const code=randomCode();room={code,players:new Map(),added:[],removed:[]};rooms.set(code,room);
    me={id:cryptoId(),name:String(m.name||'Player').slice(0,14),x:-2.5,y:1.01,z:-2.5,yaw:0,slot:0,ws};
    room.players.set(me.id,me);ws.room=room;ws.me=me;
    send(ws,{type:'created',room:code,id:me.id});
    send(ws,{type:'world',added:[...blocks].map(([k,type])=>{const [x,y,z]=k.split(',').map(Number);return{x,y,z,type}}),removed:[]});
    broadcast(room,{type:'state',players:state(room)});
  }
  if(m.type==='join'){
    const code=String(m.room||'').toUpperCase(),r=rooms.get(code);
    if(!r)return send(ws,{type:'error',message:'ოთახი ვერ მოიძებნა'});
    if(r.players.size>=MAX_PLAYERS)return send(ws,{type:'error',message:'ოთახი სავსეა (4/4)'});
    room=r;me={id:cryptoId(),name:String(m.name||'Player').slice(0,14),x:2.5,y:1.01,z:2.5,yaw:Math.PI,slot:r.players.size,ws};
    r.players.set(me.id,me);ws.room=r;ws.me=me;
    send(ws,{type:'joined',room:code,id:me.id});
    send(ws,{type:'world',added:[...blocks].map(([k,type])=>{const [x,y,z]=k.split(',').map(Number);return{x,y,z,type}}),removed:[]});
    broadcast(r,{type:'state',players:state(r)});
  }
  if(!me||!room)return;
  if(m.type==='input'){
    me.x=Number.isFinite(m.x)?Math.max(-13.4,Math.min(13.4,m.x)):me.x;
    me.y=1.01;me.z=Number.isFinite(m.z)?Math.max(-13.4,Math.min(13.4,m.z)):me.z;
    me.yaw=Number.isFinite(m.yaw)?m.yaw:me.yaw;
  }
  if(m.type==='add'||m.type==='remove'){
    const x=Math.trunc(m.x),y=Math.trunc(m.y),z=Math.trunc(m.z);
    if(x<-14||x>=14||z<-14||z>=14||y<1||y>10)return;
    const k=key(x,y,z);
    if(m.type==='add'){
      if(blocks.has(k))return;
      blocks.set(k,String(m.block||'grass'));
      broadcast(room,{type:'world',added:[{x,y,z,type:blocks.get(k)}],removed:[]});
    }else{
      if(!blocks.has(k)||y===0)return;
      blocks.delete(k);
      broadcast(room,{type:'world',added:[],removed:[{x,y,z}]});
    }
  }
 });
 ws.on('close',()=>{
   if(room&&me){room.players.delete(me.id);broadcast(room,{type:'state',players:state(room)});if(room.players.size===0)rooms.delete(room.code)}
 });
});

function cryptoId(){return Math.random().toString(36).slice(2)+Date.now().toString(36)}
server.listen(PORT,()=>console.log(`BlockWorld 4 server listening on ${PORT}`));