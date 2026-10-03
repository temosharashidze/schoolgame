const express = require("express");
const path = require("path");
const { ExpressPeerServer } = require("peer");

const app = express();

const PORT = process.env.PORT || 10000;

// ===============================
// GAME FILES
// ===============================

app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "GAME4.html"));
});

// ===============================
// PEERJS ONLINE SERVER
// ===============================

const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log("=================================");
    console.log("   SCHOOLGAME 3D ONLINE SERVER");
    console.log("=================================");
    console.log("Server running on port:", PORT);
    console.log("Game: /GAME4.html");
    console.log("PeerJS: /schoolgame");
});

const peerServer = ExpressPeerServer(httpServer, {
    path: "/"
});

app.use("/schoolgame", peerServer);

peerServer.on("connection", (client) => {
    console.log("PLAYER CONNECTED:", client.getId());
});

peerServer.on("disconnect", (client) => {
    console.log("PLAYER DISCONNECTED:", client.getId());
});
