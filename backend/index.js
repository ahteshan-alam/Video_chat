import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors());

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["https://videochater.netlify.app", "http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST"],
  },
});

const rooms = {}; // room => [{ id, username, busy, partner }]

const getMembers = (room) => rooms[room] || [];
const setMembers = (room, arr) => (rooms[room] = arr);

io.on("connection", (socket) => {
  socket.room = null;
  socket.username = null;

  const safeEmit = (to, evt, payload) => {
    try {
      io.to(to).emit(evt, payload);
    } catch {}
  };

  socket.on("new-user", ({ id, formData }) => {
    const { room, username } = formData || {};
    if (!room || !username) return;

    socket.room = room;
    socket.username = username;

    if (!rooms[room]) rooms[room] = [];

    // Prevent duplicates for same socket.id
    rooms[room] = rooms[room].filter((c) => c.id !== socket.id);
    rooms[room].push({ username, id: socket.id, busy: false, partner: null });

    socket.join(room);
    const members = getMembers(room);

    socket.broadcast.to(room).emit("user-joined", {
      message: `${username} joined`,
      members,
    });
    safeEmit(id, "welcome", { message: `${username} welcome`, members });
  });

  socket.on("offer", (payload) => {
    const room = socket.room;
    if (!room || !rooms[room]) return;

    const { target, sdp, caller } = payload || {};
    if (!target || !sdp || !caller) return;

    if (target === socket.id) {
      // self-call guard
      safeEmit(caller.id, "userBusy", { message: "Cannot call yourself" });
      return;
    }

    const targetUser = rooms[room].find((c) => c.id === target);
    if (!targetUser) {
      safeEmit(caller.id, "userBusy", { message: `User not found or left` });
      return;
    }

    if (targetUser.busy) {
      safeEmit(caller.id, "userBusy", { message: `${target} is busy in another call` });
      return;
    }

    io.to(target).emit("offer", payload);
  });

  socket.on("answer", (payload) => {
    const room = socket.room;
    if (!room || !rooms[room]) return;

    const { caller, target, sdp } = payload || {};
    if (!caller || !target || !sdp) return;

    // mark both users busy + partner
    rooms[room].forEach((c) => {
      if (c.id === caller.id || c.id === target) c.busy = true;
    });

    const callerClient = rooms[room].find((c) => c.id === caller.id);
    const calleeClient = rooms[room].find((c) => c.id === target);

    if (callerClient && calleeClient) {
      callerClient.partner = calleeClient.id;
      calleeClient.partner = callerClient.id;
    }

    safeEmit(target, "answer", payload);
  });

  socket.on("ice-candidate", (payload) => {
    const { target, route } = payload || {};
    if (!target || !route) return;
    safeEmit(target, "ice-candidate", payload);
  });

  socket.on("call_reject", ({ targetUser, callee }) => {
    const room = socket.room;
    if (!room || !rooms[room]) return;

    rooms[room].forEach((c) => {
      if (c.id === targetUser || c.id === callee) {
        c.busy = false;
        c.partner = null;
      }
    });

    safeEmit(targetUser, "call_reject");
  });

  socket.on("call_canceled", ({ target, caller }) => {
    const room = socket.room;
    if (!room || !rooms[room]) return;
    if (!target || !caller) return;

    rooms[room].forEach((c) => {
      if (c.id === caller || c.id === target.id) {
        c.busy = false;
        c.partner = null;
      }
    });

    if (target?.id) safeEmit(target.id, "call_cancel");
  });

  socket.on("call_ended", ({ target }) => {
    const room = socket.room;
    if (!room || !rooms[room]) return;

    const me = socket.id;

    rooms[room].forEach((c) => {
      if (c.id === target || c.id === me) {
        c.partner = null;
        c.busy = false;
      }
    });

    if (target) safeEmit(target, "call_ended");
  });

  socket.on("disconnect", () => {
    const room = socket.room;
    if (!room || !rooms[room]) return;

    // free partner (if any) and tell them call ended
    let partner = null;
    rooms[room].forEach((c) => {
      if (c.id === socket.id) {
        partner = c.partner;
        c.partner = null;
        c.busy = false;
      }
    });

    if (partner) {
      const p = rooms[room].find((c) => c.id === partner);
      if (p) {
        p.partner = null;
        p.busy = false;
        safeEmit(partner, "call_ended");
      }
    }

    // remove user
    rooms[room] = rooms[room].filter((c) => c.id !== socket.id);
    const members = getMembers(room);

    if (rooms[room].length === 0) delete rooms[room];

    socket.to(room).emit("user-left", {
      message: `${socket.username} left the room`,
      members,
    });
  });
});

app.get("/", (_req, res) => {
  res.send("welcome to the backend");
});

const PORT = process.env.PORT || 2000;
server.listen(PORT, () => {
  console.log("server online at", PORT);
});
