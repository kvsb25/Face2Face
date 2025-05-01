const express = require('express');
const app = express();
const path = require('path');
// const WebSocket = require('ws');
const { STATIC_PATH } = require('../config.js').constants;
// const { checkRoomAvailability, pendingRequests, wssCall } = require('./utils.js');
const { createRoom, joinRoom, rooms } = require('./roomManager.js');
// const ws = new WebSocket('ws://localhost:3001');

app.use(express.json()); // to parse json data
app.use(express.urlencoded({ extended: true })); // to parse url encoded data
app.use(express.static(path.join(__dirname, "../../client"))); // to server static files

app.get('/', (req, res) => {
    // return res.send("html page where you can either create or join room");
    return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/home.html`));
})

// app.get('/api/room', async (req, res) => {
//     let { roomId } = req.query;
//     let response, err;
//     await checkRoomAvailability(roomId, ws)
//         .then((roomId) => {
//             // return res.status(200).json({roomId});
//             console.log("GET /api/room; roomId" + roomId);
//             response = roomId;
//         })
//         .catch((error) => {
//             // return res.status(400).send(error)
//             console.log("GET /api/room; error: " + error);
//             err = error;
//         });

//     if(response && !err){
//         return res.status(200).json({roomId : response});
//     } else if (!response && err) {
//         return res.status(500).send(err);
//     }
//     // return res.status(200).send("nill");
//     // wssCall(ws, {type: 'CHECK_ROOM2', roomId})
//     //     .then((roomId)=>{
//     //         res.redirect(`/${roomId}`);
//     //     })
//     //     .catch((error)=>{
//     //         res.status(400).send(error)
//     //     })
// })

// app.post('/api/room', async (req, res) => {
//     let response, err;
//     await createRoom(ws)
//         .then((roomId)=>{
//             // return res.status(200).json({roomId});
//             console.log("POST /api/room; roomId: "+ roomId);
//             response = roomId;
//         })
//         .catch((error)=>{
//             // return res.status(400).send(error);
//             console.log("POST /api/room; error: " + error);
//             err = error;
//         });

//     if(response && !err){
//         return res.status(200).json({roomId : response});
//     } else if (!response && err) {
//         return res.status(500).send(err);
//     }
// })

app.route('/api/room')
    // join room 
    .get((req, res)=>{
        let room = req.query.roomId;

        const result = joinRoom(room);

        if(result){
            return res.status(200).send({roomId : room});
        } else {
            return res.status(400).send("Either the room doesn't exist or the room is full");
        }
    })
    // create room
    .post((req, res)=>{
        let room = createRoom();
        return res.status(200).send({roomId : room});
    })

app.get('/room/:roomId', (req, res) => {
    let room = req.params.roomId;
    console.log("GET '/:roomId'; rooms.get(room) : " + rooms.get(room));
    if(rooms.get(room) && rooms.get(room) <= 2){
        return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/room.html`));
    } else {
        throw new Error;
    }
    // checkRoomAvailability(roomId, ws)
    //     .then((roomId)=>{
    //         return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/room.html`))
    //     })
    //     .catch((error)=>{
    //         return res.redirect('/');
    //     })
    // return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/room.html`));
    // return res.send("html page with the client side webRTC and websocket logic for video conferencing, chat etc.");
})

app.use((error, req, res, next)=>{
    // res.status(500).send('Something broke!')
    return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/error.html`));
})

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

app.listen(3000, () => { console.log("http listening at 3000") });