const maxClients = 2;
let rooms = {}; // { roomId1: [socket1, socket2], roomId2: [socket1, socket2]... }

const joinRoom = (room, socket) => {
    console.log(room);
    if(!Object.keys(rooms).includes(room)){
        console.log("in joinRoom wss: if room does not exist");
        rooms[room] = [];
        // rooms[room] = [socket];
        // socket.room = room;
        // socket.send(JSON.stringify({ type: "join-successful" }));
        // return;
    }

    if(rooms[room]?.length >= maxClients){
        console.log("in joinRoom wss: if room is full");
        console.log('room full');
        return; // emit an event for 'join-unsuccessful'
    }

    rooms[room].push(socket);
    socket.room = room;
    
    initiateOffer(room);
    
    console.log(`Room ${room} now has ${rooms[room].length} participants`);
    socket.send(JSON.stringify({ type: "join-successful" }));
}

const leaveRoom = (room, socket) => {
    if (rooms[room]) {
        rooms[room] = rooms[room].filter(peer => peer !== socket);
        if (rooms[room].length === 0) {
            delete rooms[room];
        }
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