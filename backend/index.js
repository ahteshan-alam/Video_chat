import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors());

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://videochater.netlify.app", // your frontend
    methods: ["GET", "POST"],
  },
});

// Room structure: { roomId: [ {id, username, busy, partner} ] }
let rooms = {};

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // New user joins
  socket.on("new-user", ({ id, formData }) => {
    socket.room = formData.room;
    socket.username = formData.username;

    if (!rooms[socket.room]) rooms[socket.room] = [];

    // remove if exists already
    rooms[socket.room] = rooms[socket.room].filter((c) => c.id !== socket.id);

    rooms[socket.room].push({
      id: socket.id,
      username: formData.username,
      busy: false,
      partner: null,
    });

    socket.join(socket.room);
    const members = rooms[socket.room];

    // Notify others
    socket.broadcast
      .to(socket.room)
      .emit("user-joined", { message: `${formData.username} joined`, members });

    // Welcome the new user
    io.to(id).emit("welcome", {
      message: `${formData.username}, welcome to chat`,
      members,
    });

    console.log(`User ${formData.username} joined room ${socket.room}`);
  });

  // Caller sends offer
  socket.on("offer", (payload) => {
    const targetUser = rooms[socket.room]?.find(
      (c) => c.id === payload.target
    );

    if (targetUser && !targetUser.busy) {
      io.to(payload.target).emit("offer", payload);
    } else {
      io.to(payload.caller.id).emit("userBusy", {
        message: "User is busy in another call",
      });
    }
  });

  // Callee answers
  socket.on("answer", (payload) => {
    const { caller, target } = payload;

    // update caller + callee as busy
    rooms[socket.room]?.forEach((c) => {
      if (c.id === caller.id || c.id === target) {
        c.busy = true;
      }
      if (c.id === caller.id) c.partner = target;
      if (c.id === target) c.partner = caller.id;
    });

    io.to(target).emit("answer", payload);
  });

  // ICE candidate relay
  socket.on("ice-candidate", (payload) => {
    io.to(payload.target).emit("ice-candidate", payload);
  });

  // Call reject
  socket.on("call_reject", ({ targetUser, callee }) => {
    rooms[socket.room]?.forEach((c) => {
      if (c.id === targetUser || c.id === callee) {
        c.busy = false;
        c.partner = null;
      }
    });
    io.to(targetUser).emit("call_reject");
  });

  // Call canceled
  socket.on("call_canceled", ({ target, caller }) => {
    rooms[socket.room]?.forEach((c) => {
      if (c.id === caller || c.id === target.id) {
        c.busy = false;
        c.partner = null;
      }
    });
    io.to(target.id).emit("call_cancel");
  });

  // Call ended
  socket.on("call_ended", ({ target }) => {
    rooms[socket.room]?.forEach((c) => {
      if (c.id === target || c.id === socket.id) {
        c.busy = false;
        c.partner = null;
      }
    });
    io.to(target).emit("call_ended");
  });

  // Disconnect
  socket.on("disconnect", () => {
    if (!rooms[socket.room]) return;

    let partnerId = null;

    rooms[socket.room].forEach((c) => {
      if (c.id === socket.id) {
        partnerId = c.partner;
      }
    });

    // free partner if exists
    rooms[socket.room].forEach((c) => {
      if (c.id === partnerId) {
        c.busy = false;
        c.partner = null;
      }
    });

    // remove user
    rooms[socket.room] = rooms[socket.room].filter((c) => c.id !== socket.id);

    const members = rooms[socket.room];

    if (members.length === 0) {
      delete rooms[socket.room];
    }

    socket.to(socket.room).emit("user-left", {
      message: `${socket.username} left`,
      members,
    });

    console.log(`User ${socket.username} left room ${socket.room}`);
  });
});

app.get("/", (req, res) => {
  res.send("Welcome to the backend");
});

server.listen(2000, () => {
  console.log("Server running on port 2000");
});
