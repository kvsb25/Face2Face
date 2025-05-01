const express = require('express');
const app = express();
const path = require('path');
const WebSocket = require('ws');
const { STATIC_PATH } = require('../config.js').constants;
const { checkRoomAvailability, pendingRequests, wssCall, createRoom } = require('./utils.js');
const ws = new WebSocket('ws://localhost:3001');

app.use(express.json()); // to parse json data
app.use(express.urlencoded({ extended: true })); // to parse url encoded data
app.use(express.static(path.join(__dirname, "../../client"))); // to server static files

app.get('/', (req, res) => {
    // return res.send("html page where you can either create or join room");
    return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/home.html`));
})

app.get('/api/room', async (req, res) => {
    let { roomId } = req.query;
    let response, err;
    await checkRoomAvailability(roomId, ws)
        .then((roomId) => {
            // return res.status(200).json({roomId});
            console.log("GET /api/room; roomId" + roomId);
            response = roomId;
        })
        .catch((error) => {
            // return res.status(400).send(error)
            console.log("GET /api/room; error: " + error);
            err = error;
        });

    if(response && !err){
        return res.status(200).json({roomId : response});
    } else if (!response && err) {
        return res.status(500).send(err);
    }
    // return res.status(200).send("nill");
    // wssCall(ws, {type: 'CHECK_ROOM2', roomId})
    //     .then((roomId)=>{
    //         res.redirect(`/${roomId}`);
    //     })
    //     .catch((error)=>{
    //         res.status(400).send(error)
    //     })
})

app.post('/api/room', async (req, res) => {
    let response, err;
    await createRoom(ws)
        .then((roomId)=>{
            // return res.status(200).json({roomId});
            console.log("POST /api/room; roomId: "+ roomId);
            response = roomId;
        })
        .catch((error)=>{
            // return res.status(400).send(error);
            console.log("POST /api/room; error: " + error);
            err = error;
        });

    if(response && !err){
        return res.status(200).json({roomId : response});
    } else if (!response && err) {
        return res.status(500).send(err);
    }
})

// app.route('/api/room')
//     .get((req, res)=>{})
//     .post((req, res)=>{})

// NOTE: anyone can access this url directly by typing in the url, this is a potential issue suppose there are 2 people in the room and a third person comes using the url hack... this should be taken care of in the WSS and here also
app.get('/:roomId', (req, res) => {
    let {roomId} = req.params;
    checkRoomAvailability(roomId, ws)
        .then((roomId)=>{
            return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/room.html`))
        })
        .catch((error)=>{
            return res.redirect('/');
        })
    // return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/room.html`));
    // return res.send("html page with the client side webRTC and websocket logic for video conferencing, chat etc.");
})

app.use((error, req, res, next)=>{
    console.error(error.stack);
    console.error(error);
    // res.status(500).send('Something broke!')
    return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/error.html`));
})

// ws to get updates from the WSS
ws.addEventListener('message', (message) => {
    const data = JSON.parse(message.data);

    const { requestId, type, roomId } = data;
    if (!requestId || !pendingRequests.has(requestId)) return;

    const { resolve, reject } = pendingRequests.get(requestId);
    pendingRequests.delete(requestId);

    if (type === 'AVAILABLE' || type === 'CREATE_ROOM') {
        resolve(roomId);
    } else {
        reject(type);
    }
});

app.listen(3000, () => { console.log("http listening at 3000") });