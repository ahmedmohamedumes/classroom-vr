// server.js
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync, existsSync } from "fs";
import { Server } from "socket.io";
import express from "express";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static(join(__dirname, "public")));
app.use("/three", express.static(join(__dirname, "node_modules/three")));

const certPath = join(__dirname, "cert.pem");
const keyPath = join(__dirname, "key.pem");

let httpServer;
if (existsSync(certPath) && existsSync(keyPath)) {
  httpServer = createHttpsServer(
    { cert: readFileSync(certPath), key: readFileSync(keyPath) },
    app
  );
  console.log("🔒 HTTPS mode enabled");
} else {
  httpServer = createHttpServer(app);
  console.log("⚠️  HTTP mode (no cert/key found)");
}

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const players = {}; // id -> { position, rotation, name }

io.on("connection", (socket) => {
  console.log(`✅ Player connected: ${socket.id}`);

  // Initialize player
  players[socket.id] = {
    id: socket.id,
    position: { x: 0, y: 1.0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  };

  // Send current players to the new player
  socket.emit("currentPlayers", players);

  // Notify others of new player
  socket.broadcast.emit("newPlayer", players[socket.id]);

  // Handle player movement
  socket.on("playerMoved", (state) => {
    if (!players[socket.id]) return;
    players[socket.id].position = state.position;
    players[socket.id].rotation = state.rotation;

    // Broadcast to others
    socket.broadcast.emit("playerMoved", { id: socket.id, state });
  });

  // Chat message handler
  socket.on("chatMessage", (message) => {
    const data = { id: socket.id, message };
    console.log(`💬 ${socket.id}: ${message}`);
    io.emit("chatMessage", data);
  });

  // WebRTC signaling: offer/answer/ice-candidates
  socket.on('webrtc-offer', ({ to, offer }) => {
    if (!to || !offer) return;
    if (to === 'all') {
      // broadcast to everyone except sender
      socket.broadcast.emit('webrtc-offer', { from: socket.id, offer });
    } else {
      io.to(to).emit('webrtc-offer', { from: socket.id, offer });
    }
  });

  socket.on('webrtc-answer', ({ to, answer }) => {
    if (!to || !answer) return;
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });

  socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
    if (!to || !candidate) return;
    if (to === 'all') {
      socket.broadcast.emit('webrtc-ice-candidate', { from: socket.id, candidate });
    } else {
      io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log(`❌ Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit("playerDisconnected", socket.id);
  });
});

httpServer.listen(PORT, () => {
  const protocol = (existsSync(certPath) && existsSync(keyPath)) ? "https" : "http";
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`   Local:   ${protocol}://localhost:${PORT}`);
  console.log(`   Quest 3: ${protocol}://<your-pc-ip>:${PORT}  (find IP with: ipconfig)`);
});
