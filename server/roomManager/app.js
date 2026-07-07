const express = require('express');
const app = express();

const maxClients = 2;
// { roomId -> live participant count }; incremented/decremented by the
// wsServer as peers actually connect and disconnect
const rooms = new Map();

app.use(express.json());

// create a room; participants start at 0 and are counted on ws join
app.post('/api/rooms', (req, res) => {
    const room = generateRandomString();
    rooms.set(room, 0);
    console.log(`POST /api/rooms; created ${room}`);
    return res.status(201).send({ roomId: room });
});

// check a room's existence and capacity
app.get('/api/rooms/:roomId', (req, res) => {
    const room = req.params.roomId;
    if (!rooms.has(room)) {
        return res.status(404).send("Room doesn't exist");
    }
    const participants = rooms.get(room);
    return res.status(200).send({ roomId: room, participants, full: participants >= maxClients });
});

// join a room
app.post('/api/rooms/:roomId/join', (req, res) => {
    const room = req.params.roomId;
    if (!rooms.has(room)) {
        return res.status(404).send("Room doesn't exist");
    }

    const userCount = rooms.get(room);
    if (userCount >= maxClients) {
        return res.status(409).send("Room is full");
    }

    rooms.set(room, userCount + 1);
    console.log(`POST /api/rooms/${room}/join; participants: ${rooms.get(room)}`);
    return res.status(200).send({ roomId: room, participants: rooms.get(room) });
});

// leave a room; the room itself is kept so its code stays valid
// (e.g. a lone participant reloading the page can rejoin)
app.post('/api/rooms/:roomId/leave', (req, res) => {
    const room = req.params.roomId;
    if (!rooms.has(room)) {
        return res.status(404).send("Room doesn't exist");
    }

    const userCount = Math.max(rooms.get(room) - 1, 0);
    rooms.set(room, userCount);
    console.log(`POST /api/rooms/${room}/leave; participants: ${userCount}`);
    return res.status(200).send({ roomId: room, participants: userCount });
});

function getRandomLetters(length) {
    let result = '';
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function generateRandomString() {
    let result = getRandomLetters(3) + '-' + getRandomLetters(3) + '-' + getRandomLetters(3);

    if (!(rooms.has(result))) {
        return result;
    } else {
        return generateRandomString();
    }
}

app.listen(3002, () => { console.log("roomManager listening at 3002") });
