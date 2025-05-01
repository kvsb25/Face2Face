const maxClients = 2;
let rooms = {};

const joinRoom = (room, socket) => {
    if(!Object.keys(rooms).includes(room)){
        rooms[room] = [socket];
        socket.room = room;
        socket.send(JSON.stringify({ type: "join-successful" }));
        return;
    }

    if(rooms[room]?.length >= maxClients){
        console.log('room full');
        return; // emit an event for 'join-unsuccessful'
    }

    rooms[room] = [socket];
    socket.room = room;
    socket.send(JSON.stringify({ type: "join-successful" }));

    initiateOffer(room);
}

const leaveRoom = (room, socket) => {}

function initiateOffer(room){
    if(rooms[room].length === 2){
        rooms[room][0].send(JSON.stringify({ type: "ready-to-offer" }));
        return;
    } else {
        return;
    }
}

module.exports = {joinRoom, leaveRoom};