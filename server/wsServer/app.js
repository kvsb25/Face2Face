const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

const rooms = {}; // { roomId1: [socket11, socket12], roomId2: [socket21, socket22]... }
let roomId;

function generateRandomString() {
  function getRandomLetters(length) {
    let result = '';
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  // let result = getRandomLetters(3) + '-' + getRandomLetters(3) + '-' + getRandomLetters(3);

  // if(!rooms[result]) {
  //     return result;
  // } else {
  //     return generateRandomString();
  // }

  // Use a loop instead of recursion for scalability
  let maxAttempts = 100; // Set a reasonable limit
  let attempts = 0;

  while (attempts < maxAttempts) {
    const result = getRandomLetters(3) + '-' + getRandomLetters(3) + '-' + getRandomLetters(3);

    if (!rooms[result]) {
      return result;
    }

    attempts++;
  }

  return "no_ID";
}

wss.on('connection', (socket) => {
  socket.on('message', (message) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case "CREATE_ROOM":
        socket.send(JSON.stringify({ type: "CREATE_ROOM", roomId: generateRandomString() }));
        break;

      case "CHECK_ROOM":
        roomId = data.roomId;
        if (room[roomId]) {
          socket.send(JSON.stringify({ type: room[roomId].length < 2 ? "AVAILABLE" : "ROOM_FULL" }));
        } else {
          socket.send(JSON.stringify({ type: "NO_ROOM" }));
        }
        break;

      case "join-room":
        roomId = data.roomId;
        if (!rooms[roomId]) {
          rooms[roomId] = [];
        }
        rooms[roomId].push(socket);

        console.log(`Client joined room: ${roomId}`);

        socket.roomId = roomId; // save roomId in socket object

        socket.send(JSON.stringify({ type: "join-successful" }));

        // If there are exactly two peers, notify the first peer to create an offer
        if (rooms[roomId].length === 2) {
          rooms[roomId][0].send(JSON.stringify({ type: "ready-to-offer" }));
        }
        break;

      case "offer":
      case "answer":
      case "ice-candidate":
        // Relay offer/answer/ice-candidate to the other peer
        const room = rooms[socket.roomId];
        if (room) {
          room.forEach((peer) => {
            if (peer !== socket && peer.readyState === WebSocket.OPEN) {
              peer.send(message);
            }
          });
        }
        break;
    }
  });

  socket.on('close', () => {
    const roomId = socket.roomId;
    if (rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(peer => peer !== socket);
      if (rooms[roomId].length === 0) {
        delete rooms[roomId];
      }
    }
  });
});
