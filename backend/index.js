import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import twilio from 'twilio';

// --- Twilio Configuration ---
// Your Account SID and Auth Token are loaded from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// Initialize the Twilio client, but only if credentials are provided
const client = (accountSid && authToken) ? twilio(accountSid, authToken) : null;
if (!client) {
    console.warn("Twilio credentials not found in environment variables. TURN server will be unavailable, using public STUN only.");
}

const app = express();
app.use(cors());
const server = createServer(app);

const io = new Server(server, {
    cors: {
        origin: "https://videochater.netlify.app", // Your deployed frontend URL
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
});

// --- New Endpoint to Securely Fetch Twilio ICE Servers ---
app.get('/get-ice-servers', async (req, res) => {
    if (!client) {
        // Provide public STUN servers as a fallback if Twilio is not configured
        return res.json({ 
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] 
        });
    }
    try {
        const token = await client.tokens.create();
        res.json({ iceServers: token.iceServers });
    } catch (error) {
        console.error("Failed to get ICE servers from Twilio:", error);
        res.status(500).json({ error: 'Failed to get ICE servers' });
    }
});

let rooms = {};

// --- Socket.IO Connection Logic ---
io.on("connection", (socket) => {
    socket.on('new-user', ({ id, formData }) => {
        socket.room = formData.room;
        socket.username = formData.username;
        if (!rooms[socket.room]) {
            rooms[socket.room] = [];
        }
        rooms[socket.room] = rooms[socket.room].filter(client => client.id !== socket.id);
        rooms[socket.room].push({ username: formData.username, id: socket.id, busy: false, partner: null });
        socket.join(formData.room);
        
        const members = rooms[socket.room];
        socket.broadcast.to(formData.room).emit('user-joined', { members });
        io.to(id).emit('welcome', { members });
    });

    socket.on('offer', (payload) => {
        const targetUser = rooms[socket.room]?.find(client => client.id === payload.target);
        if (targetUser && !targetUser.busy) {
            io.to(payload.target).emit('offer', payload);
        } else if (targetUser) {
            io.to(payload.caller.id).emit('userBusy');
        }
    });

    socket.on('answer', (payload) => {
        const room = rooms[socket.room];
        if (room) {
            const caller = room.find(client => client.id === payload.caller.id);
            const callee = room.find(client => client.id === payload.target);
            if (caller) {
                caller.busy = true;
                caller.partner = callee?.id;
            }
            if (callee) {
                callee.busy = true;
                callee.partner = caller?.id;
            }
        }
        io.to(payload.target).emit('answer', payload);
    });

    socket.on('ice-candidate', (payload) => {
        io.to(payload.target).emit('ice-candidate', payload);
    });

    socket.on('call_reject', ({ targetUser }) => {
        io.to(targetUser).emit('call_reject');
    });

    socket.on('call_canceled', ({ target }) => {
        if(target && target.id) io.to(target.id).emit('call_cancel');
    });

    socket.on('call_ended', ({ target, currentUser }) => {
        const room = rooms[socket.room];
        if (room) {
            const client1 = room.find(c => c.id === target);
            const client2 = room.find(c => c.id === currentUser);
            if (client1) {
                client1.busy = false;
                client1.partner = null;
            }
            if (client2) {
                client2.busy = false;
                client2.partner = null;
            }
        }
        io.to(target).emit('call_ended');
    });

    socket.on("disconnect", () => {
        if (!socket.room || !rooms[socket.room]) return;

        let partnerId;
        const disconnectingUser = rooms[socket.room].find(client => client.id === socket.id);
        if (disconnectingUser) {
            partnerId = disconnectingUser.partner;
        }

        rooms[socket.room] = rooms[socket.room].filter(client => client.id !== socket.id);

        if (partnerId) {
            const partner = rooms[socket.room].find(client => client.id === partnerId);
            if (partner) {
                partner.busy = false;
                partner.partner = null;
            }
            io.to(partnerId).emit('call_ended');
        }

        const members = rooms[socket.room];
        if (members.length === 0) {
            delete rooms[socket.room];
        } else {
            socket.to(socket.room).emit('user-left', { members });
        }
    });
});

app.get("/", (req, res) => {
    res.send("Welcome to the video chat backend");
});

const PORT = process.env.PORT || 2000;
server.listen(PORT, () => {
    console.log(`Server online at ${PORT}`);
});