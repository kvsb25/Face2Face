const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3001 });
const {joinRoom, leaveRoom, rooms} = require('./roomManager.js');

wss.on('connection', (socket) => {
  socket.binaryType = 'arraybuffer';
  socket.on('message', (message) => {
    console.log(`typeof message: ${typeof message}`);
    const data = JSON.parse(message);
    console.log('data: ', data);
    
    if (data.type == 'join-room') {
      
      let room = data.roomId;
      console.log("roomId: ", room);
      joinRoom(room, socket);

    } else if (['offer', 'answer', 'ice-candidate'].includes(data.type)) {
      try{
        const room = rooms[socket.room];
        if (room) {
          room.forEach((peer) => {
            if (peer !== socket && peer.readyState === WebSocket.OPEN) {
              peer.send(JSON.stringify(data));
            }
          });
        }
      }catch(err){console.error(err)}
    }
  })
  
  socket.on('close', () => {
    const room = socket.room;
    // if (rooms[room]) {
    //   rooms[room] = rooms[room].filter(peer => peer !== socket);
    //   if (rooms[room].length === 0) {
    //     delete rooms[room];
    //   }
    // }
    leaveRoom(room, socket);
  });
});
