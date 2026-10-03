const { PeerServer } = require("peer");

const PORT = process.env.PORT || 10000;

const server = PeerServer({
    port: PORT,
    path: "/schoolgame"
});

console.log("=================================");
console.log("   SCHOOLGAME 3D ONLINE SERVER");
console.log("=================================");
console.log("PORT:", PORT);
console.log("PATH: /schoolgame");

server.on("connection", (client) => {
    console.log("PLAYER CONNECTED:", client.getId());
});

server.on("disconnect", (client) => {
    console.log("PLAYER DISCONNECTED:", client.getId());
});
