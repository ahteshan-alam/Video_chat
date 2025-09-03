import 'dotenv/config';
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from 'uuid';

const app = express();
const port = 5000;
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://chatterbocs.netlify.app",
    methods: ["GET", "POST"]
  }
});

let rooms = {};
const userData = new Map();

app.use(cors());

app.get("/", (req, res) => {
  res.send("welcome");
});

io.on("connection", (socket) => {
  socket.on("join-room", ({ username, room }) => {
    if (socket.currRoom) {
      socket.leave(socket.currRoom);
    }
    socket.join(room);
    socket.username = username;
    userData.set(socket.id, { username, room });
    rooms[room] = (rooms[room] || []).filter(c => c.id !== socket.id);
    rooms[room].push({ username: username, id: socket.id });
    socket.to(room).emit("user-joined", {
      message: `${username} joined the chat`,
      type: "notification",
      id: uuidv4(),
      clients: rooms[room]
    });
    socket.emit("welcome", {
      type: "notification",
      message: `welcome to the room ${username}`,
      id: uuidv4(),
      clients: rooms[room]
    });
  });

  socket.on("message", ({ message, username }) => {
    const user = userData.get(socket.id);
    if (!user || !user.room) return;
    io.to(user.room).emit("send-message", {
      message,
      username,
      type: "message",
      id: uuidv4(),
      time: new Date().toISOString(),
      userId: socket.id
    });
  });

  socket.on("typing", ({ username, room }) => {
    if (username === "") {
      socket.to(room).emit("user-typing", { message: "" });
    } else {
      socket.to(room).emit("user-typing", { message: `${username} is typing ...` });
    }
  });

  socket.on("disconnect", () => {
    const user = userData.get(socket.id);
    if (!user || !user.room) return;
    const { room, username } = user;
    rooms[room] = (rooms[room] || []).filter(c => c.id !== socket.id);
    if (rooms[room].length === 0) {
      delete rooms[room];
    }
    socket.to(room).emit("user-left", {
      message: `${username} left the chat`,
      type: "notification",
      id: uuidv4(),
      clients: rooms[room]
    });
    userData.delete(socket.id);
  });
});

server.listen(port, () => {
  console.log("server online at 5000");
});