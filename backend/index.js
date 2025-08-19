import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
app.use(cors());
app.use(express.json()); // Middleware to parse JSON bodies

const server = createServer(app);

const io = new Server(server, {
    cors: {
        origin: [
            "https://videochater.netlify.app",
            "http://localhost:3000",
            "http://localhost:5173"
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

let rooms = {};

// --- Utility Functions for Cleaner Code ---

const findUserInRoom = (roomName, userId) => {
    return rooms[roomName]?.find(client => client.id === userId) || null;
};

const updateUserStatus = (roomName, userId, updates) => {
    const user = findUserInRoom(roomName, userId);
    if (user) {
        Object.assign(user, updates);
        return true;
    }
    return false;
};

const cleanupUser = (socket) => {
    if (!socket.room || !rooms[socket.room]) return;

    const disconnectingUser = findUserInRoom(socket.room, socket.id);
    if (!disconnectingUser) return;

    const partnerId = disconnectingUser.partner;

    // Remove user from the room
    rooms[socket.room] = rooms[socket.room].filter(client => client.id !== socket.id);
    
    // If the user was in a call, notify their partner and reset partner's status
    if (partnerId) {
        const partner = findUserInRoom(socket.room, partnerId);
        if (partner) {
            updateUserStatus(socket.room, partner.id, { busy: false, partner: null });
            io.to(partnerId).emit('call_ended', { message: 'The other user disconnected.' });
        }
    }

    const members = rooms[socket.room];
    if (members.length === 0) {
        delete rooms[socket.room];
        console.log(`Room ${socket.room} is now empty and has been deleted.`);
    } else {
        // Notify remaining members that a user has left
        socket.broadcast.to(socket.room).emit('user-left', {
            message: `${socket.username} left the room`,
            members
        });
    }

    console.log(`User ${socket.username} (${socket.id}) cleaned up from room ${socket.room}`);
};


// --- Socket Event Listeners ---

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('new-user', ({ formData }) => {
        try {
            console.log(`New user joining: ${formData.username} in room: ${formData.room}`);
            
            socket.room = formData.room;
            socket.username = formData.username;
            
            if (!rooms[socket.room]) {
                rooms[socket.room] = [];
            }
            
            // Prevent duplicate entries on reconnect
            rooms[socket.room] = rooms[socket.room].filter(client => client.id !== socket.id);
            
            rooms[socket.room].push({
                username: formData.username,
                id: socket.id,
                busy: false,
                partner: null,
            });
            
            socket.join(socket.room);
            
            const members = rooms[socket.room];
            socket.broadcast.to(socket.room).emit('user-joined', { members });
            socket.emit('welcome', { members });
            
        } catch (error) {
            console.error('Error in new-user event:', error);
            socket.emit('error-event', { message: 'Failed to join the room.' });
        }
    });

    socket.on('offer', (payload) => {
        try {
            const targetUser = findUserInRoom(socket.room, payload.target);
            if (targetUser && !targetUser.busy) {
                console.log(`Forwarding offer from ${socket.id} to ${payload.target}`);
                io.to(payload.target).emit('offer', payload);
            } else if (targetUser) {
                console.log(`User ${payload.target} is busy, notifying ${socket.id}`);
                socket.emit('userBusy', { message: `${targetUser.username} is busy.` });
            }
        } catch (error) {
            console.error('Error in offer event:', error);
        }
    });

    socket.on('answer', (payload) => {
        try {
            const caller = findUserInRoom(socket.room, payload.target);
            const callee = findUserInRoom(socket.room, socket.id);

            if (caller && callee) {
                console.log(`Establishing call between ${caller.username} and ${callee.username}`);
                updateUserStatus(socket.room, caller.id, { busy: true, partner: callee.id });
                updateUserStatus(socket.room, callee.id, { busy: true, partner: caller.id });
                
                io.to(payload.target).emit('answer', payload);
                
                // Notify everyone in the room of the status change
                io.to(socket.room).emit('user-status-update', { members: rooms[socket.room] });
            }
        } catch (error) {
            console.error('Error in answer event:', error);
        }
    });

    socket.on('ice-candidate', (payload) => {
        io.to(payload.target).emit('ice-candidate', payload);
    });

    socket.on('call_reject', ({ targetUser }) => {
        console.log(`Call rejected by ${socket.id} to ${targetUser}`);
        io.to(targetUser).emit('call_reject');
    });

    socket.on('call_canceled', ({ target }) => {
        if(target && target.id) {
            console.log(`Call to ${target.id} was canceled by the caller.`);
            io.to(target.id).emit('call_cancel');
        }
    });

    socket.on('call_ended', ({ target, currentUser }) => {
        console.log(`Call ended between ${currentUser} and ${target}`);
        updateUserStatus(socket.room, target, { busy: false, partner: null });
        updateUserStatus(socket.room, currentUser, { busy: false, partner: null });
        
        io.to(target).emit('call_ended');
        io.to(socket.room).emit('user-status-update', { members: rooms[socket.room] });
    });

    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}`);
        cleanupUser(socket);
    });
});

app.get("/", (req, res) => {
    res.send("Welcome to the video chat backend");
});

const PORT = process.env.PORT || 2000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});