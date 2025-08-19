import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
app.use(cors());

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://videochater.netlify.app",
    methods: ["GET", "POST"]
  }
});

let rooms = {};

io.on("connection", (socket) => {
  console.log("[SOCKET CONNECTED]", socket.id);

  socket.on('new-user', ({ id, formData }) => {
    console.log("[NEW USER]", formData.username, "in room", formData.room);
    socket.room = formData.room;
    socket.username = formData.username;

    if (!rooms[formData.room]) rooms[formData.room] = [];
    rooms[formData.room] = rooms[formData.room].filter(c => c.id !== socket.id);
    rooms[formData.room].push({ username: formData.username, id: socket.id, busy: false, partner: null });
    socket.join(formData.room);

    const members = rooms[formData.room];
    socket.broadcast.to(formData.room).emit('user-joined', { message: `${formData.username} joined`, members });
    io.to(id).emit('welcome', { message: `Welcome ${formData.username}`, members });
  });

  socket.on('offer', (payload) => {
    console.log("[OFFER] from", payload.caller.id, "to", payload.target);
    const targetUser = rooms[socket.room]?.find(c => c.id === payload.target);
    if (!targetUser?.busy) io.to(payload.target).emit('offer', payload);
    else io.to(payload.caller.id).emit('userBusy', { message: `${payload.target} is busy` });
  });

  socket.on('answer', (payload) => {
    console.log("[ANSWER] from", payload.caller.id, "to", payload.target);
    rooms[socket.room]?.forEach(c => { if (c.id === payload.caller.id || c.id === payload.target) c.busy = true });
    const caller = rooms[socket.room]?.find(c => c.id === payload.caller.id);
    const callee = rooms[socket.room]?.find(c => c.id === payload.target);
    caller.partner = callee?.id;
    callee.partner = caller?.id;
    io.to(payload.target).emit('answer', payload);
  });

  socket.on('ice-candidate', (payload) => {
    console.log("[ICE] from", socket.id, "to", payload.target, payload.route);
    io.to(payload.target).emit('ice-candidate', payload);
  });

  socket.on("disconnect", () => {
    console.log("[DISCONNECT]", socket.id);
    if (rooms[socket.room]) {
      let partner;
      rooms[socket.room].forEach(c => { if (c.id === socket.id) { partner = c.partner; c.partner = null; c.busy = false } });
      rooms[socket.room].forEach(c => { if (c.id === partner) { c.partner = null; c.busy = false } });
      rooms[socket.room] = rooms[socket.room].filter(c => c.id !== socket.id);
      const members = rooms[socket.room];
      if (rooms[socket.room].length === 0) delete rooms[socket.room];
      socket.to(socket.room).emit('user-left', { message: `${socket.username} left`, members });
    }
  });
});

app.get("/", (req, res) => res.send("Backend online"));

server.listen(2000, () => console.log("Server listening on 2000"));
