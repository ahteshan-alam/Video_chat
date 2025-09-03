
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'
const app = express()
app.use(cors())
const server = createServer(app)

const io = new Server(server, {
    cors: {
        origin: "https://videochater.netlify.app",
        methods: ["GET", "POST"]
    }
})

let rooms = {};
io.on("connection", (socket) => {
    socket.on('new-user', ({ id, formData }) => {
        socket.room = formData.room
        socket.username = formData.username
        if (!rooms[formData.room]) {
            rooms[formData.room] = []
        }
        rooms[formData.room] = rooms[formData.room].filter(client => client.id !== socket.id)
        rooms[formData.room].push({ username: formData.username, id: socket.id, busy: false, partner: null })
        socket.join(formData.room)
        const members = rooms[formData.room]

        socket.broadcast.to(formData.room).emit('user-joined', { message: `${formData.username} joined the room`, members })
        io.to(id).emit('welcome', { message: `${formData.username} welcome to chat`, members })


    })
    socket.on('offer', (payload) => {
        const room = rooms[socket.room];
        if (!room) return;
        const targetUser = rooms[socket.room]?.find(client => client.id === payload.target)

        if (targetUser && !targetUser.busy) {
            io.to(payload.target).emit('offer', payload)
        }
        else {
            io.to(payload.caller.id).emit('userBusy', { message: `${payload.target} is busy in another call` })
        }

    })
    socket.on('answer', (payload) => {
        const room = rooms[socket.room];
        if (!room) return;
        rooms[socket.room].forEach(client => { if (client.id === payload.caller.id || client.id === payload.target) { client.busy = true } })
        const caller = rooms[socket.room]?.find(client => client.id === payload.caller.id)
        const callee = rooms[socket.room]?.find(client => client.id === payload.target)
        if (caller && callee){
            rooms[socket.room].forEach(client => { if (client.id === payload.caller.id) client.partner = callee.id })
            rooms[socket.room].forEach(client => { if (client.id === payload.target) client.partner = caller.id })
            console.log(caller, callee)
            io.to(payload.target).emit('answer', payload)
        }
       
    })
    socket.on('ice-candidate', (payload) => {
        io.to(payload.target).emit('ice-candidate', payload)
    })
    socket.on('call_reject', ({ targetUser, callee }) => {
        console.log('call reject')
        rooms[socket.room]?.find(client => { if (client.id === targetUser) { client.busy = false, client.partner = null } })
        rooms[socket.room]?.find(client => { if (client.id === callee) { client.busy = false, client.partner = null } })
        io.to(targetUser).emit('call_declined')
    })
    socket.on('call_canceled', ({ target, caller }) => {
        console.log(target.username)
        rooms[socket.room]?.find(client => { if (client.id === caller) { client.busy = false, client.partner = null } })
        rooms[socket.room]?.find(client => { if (client.id === target.id) { client.busy = false, client.partner = null } })
        io.to(target.id).emit('call_cancel')
    })
    socket.on('call_ended', ({ target}) => {
        const room = rooms[socket.room];
        if (!room) return;
        
        rooms[socket.room].forEach(client =>{if( client.id === target){ client.partner=null,client.busy=false}});
       
        rooms[socket.room].forEach(client =>{if( client.id === socket.id){ client.partner=null,client.busy=false}});
        io.to(target).emit('call_ended')
    })


    socket.on("disconnect", () => {
        const room = rooms[socket.room];
        if (!room) return;
        const disconnectingUser = room.find(client => client.id === socket.id);
        if (!disconnectingUser) return;

        if(disconnectingUser.partner){
            const partner=room.find(client=> client.id===disconnectingUser.partner)

            if(partner){
                partner.partner=null
               partner.busy=false
               io.to(partner.id).emit('call_ended');
            }
        }
        rooms[socket.room] = rooms[socket.room].filter(client => client.id !== socket.id)
        const members = rooms[socket.room]
        socket.to(socket.room).emit('user-left', { message: `${socket.username} left the room`, members })
        if (rooms[socket.room].length === 0){
                delete rooms[socket.room]
        }




        
        
    })




})


app.get("/", (req, res) => {
    res.send("welcome to the backend")
})


server.listen(2000, () => {
    console.log("server online at 2000")
})