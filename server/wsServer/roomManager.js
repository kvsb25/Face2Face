const WebSocket = require('ws');
const { ROOM_MANAGER_URL } = require('../config.js').constants;

const maxClients = 2;
let rooms = {}; // { roomId1: [socket1, socket2], roomId2: [socket1, socket2]... }

const joinRoom = (room, socket) => {
    console.log(room);
    if(!Object.keys(rooms).includes(room)){
        console.log("in joinRoom wss: if room does not exist");
        rooms[room] = [];
    }

    if(rooms[room]?.length >= maxClients){
        console.log("in joinRoom wss: if room is full");
        console.log('room full');
        socket.send(JSON.stringify({ type: "join-unsuccessful" }));
        return;
    }

    rooms[room].push(socket);
    socket.room = room;

    // report the join to the roomManager service
    notifyRoomManager(room, 'join');

    initiateOffer(room);

    console.log(`Room ${room} now has ${rooms[room].length} participants`);
    socket.send(JSON.stringify({ type: "join-successful" }));
}

const leaveRoom = (room, socket) => {
    // guard: only leave once, and only if this socket is actually in the room
    if (!room || !rooms[room] || !rooms[room].includes(socket)) return;

    rooms[room] = rooms[room].filter(peer => peer !== socket);
    socket.room = null;

    if (rooms[room].length === 0) {
        delete rooms[room];
    } else {
        // tell the remaining peer that the other side left
        rooms[room].forEach((peer) => {
            if (peer.readyState === WebSocket.OPEN) {
                peer.send(JSON.stringify({ type: "peer-left" }));
            }
        });
    }

    // report the leave to the roomManager service
    notifyRoomManager(room, 'leave');
}

async function notifyRoomManager(room, action) {
    try {
        const response = await fetch(`${ROOM_MANAGER_URL}/api/rooms/${room}/${action}`, { method: 'POST' });
        if (!response.ok) {
            console.error(`notifyRoomManager(${room}, ${action}): service responded ${response.status}`);
        }
    } catch (err) {
        console.error(`notifyRoomManager(${room}, ${action}): roomManager service unreachable: ` + err);
    }
}

function initiateOffer(room){
    if(rooms[room].length === 2){
        console.log('rooms[room][0] ',rooms[room][0] );
        rooms[room][0].send(JSON.stringify({ type: "ready-to-offer" }));
        return;
    } else {
        return;
    }
}

module.exports = {joinRoom, leaveRoom, rooms};
