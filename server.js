const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {

  let urlPath = decodeURIComponent(
    req.url.split("?")[0]
  );

  if (urlPath === "/") {
    urlPath = "/index.html";
  }

  // უსაფრთხო path
  const filePath = path.normalize(
    path.join(ROOT, urlPath)
  );

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {

    if (err || !stat.isFile()) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      res.end("404 - File not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    res.writeHead(200, {
      "Content-Type":
        MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });

    fs.createReadStream(filePath)
      .pipe(res);

  });

});

server.listen(PORT, "0.0.0.0", () => {

  console.log("");
  console.log("================================");
  console.log("       SCHOOLGAME SERVER");
  console.log("================================");
  console.log("");
  console.log("Server running on port:", PORT);
  console.log("");
  console.log("Main page:");
  console.log("http://localhost:" + PORT);
  console.log("");
  console.log("Minecraft is NOT used.");
  console.log("================================");
  console.log("");

});
