const { PeerServer } = require("peer");

const server = PeerServer({
    port: 9000,
    path: "/schoolgame"
});

console.log("=================================");
console.log("   SCHOOLGAME 3D ONLINE SERVER");
console.log("=================================");
console.log("Server running on port 9000");
console.log("Path: /schoolgame");

server.on("connection", (client) => {
    console.log("PLAYER CONNECTED:", client.getId());
});

server.on("disconnect", (client) => {
    console.log("PLAYER DISCONNECTED:", client.getId());
});