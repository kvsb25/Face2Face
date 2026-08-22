const express = require('express');
const app = express();
const path = require('path');
// const WebSocket = require('ws');
const { STATIC_PATH } = require('../config.js').constants;
// const { checkRoomAvailability, pendingRequests, wssCall } = require('./utils.js');
const { createRoom, checkRoom } = require('./roomManager.js');
// const ws = new WebSocket('ws://localhost:3001');

app.use(express.json()); // to parse json data
app.use(express.urlencoded({ extended: true })); // to parse url encoded data
app.use(express.static(path.join(__dirname, "../../client"))); // to server static files

app.get('/', (req, res) => {
    // return res.send("html page where you can either create or join room");
    return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/home.html`));
})

app.route('/api/room')
    // join room: check existence and capacity; the actual join is counted
    // by the wsServer when the peer's WebSocket connects from the room page
    .get(async (req, res)=>{
        let room = req.query.roomId;

        const status = await checkRoom(room);

        if(!status){
            return res.status(500).send("some server issue, try again later");
        } else if(!status.exists){
            return res.status(404).send("the room doesn't exist");
        } else if(status.full){
            return res.status(409).send("the room is full");
        }
        return res.status(200).send({roomId : room});
    })
    // create room
    .post(async (req, res)=>{
        let room = await createRoom();
        if(!room){
            return res.status(500).send("Couldn't create room");
        }
        return res.status(200).send({roomId : room});
    })

// room page
// the reason this endpoint checks again for the room status is that this endpoint can be reached separately
//      someone can try to reach the room page without joining the room, hence redundant room status check is necessary
app.get('/room/:roomId', async (req, res) => {
    let room = req.params.roomId;
    const status = await checkRoom(room);
    console.log(`GET '/room/:roomId'; checkRoom(${room}): ` + JSON.stringify(status));
    if(!status){
        return res.redirect('/?error=server');
    } else if(!status.exists){
        return res.redirect('/?error=no_room');
    } else if(status.full){
        return res.redirect('/?error=room_full');
    } else {
        return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/room.html`));
    }
})

app.use((error, req, res, next)=>{
    // res.status(500).send('Something broke!')
    return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/error.html`));
})

app.listen(3000, () => { console.log("http listening at 3000") });

// ws to get updates from the WSS
// ws.addEventListener('message', (message) => {
//     const data = JSON.parse(message.data);

//     const { requestId, type, roomId } = data;
//     if (!requestId || !pendingRequests.has(requestId)) return;

//     const { resolve, reject } = pendingRequests.get(requestId);
//     pendingRequests.delete(requestId);

//     if (type === 'AVAILABLE' || type === 'CREATE_ROOM') {
//         resolve(roomId);
//     } else {
//         reject(type);
//     }
// });