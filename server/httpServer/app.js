const express = require('express');
const app = express();
const path = require('path');
const {STATIC_PATH} = require('../config.js').constants;
const {checkRoomAvailability} = require('./utils.js');
const ws = new WebSocket('ws://localhost:3001');

app.use(express.json()); // to parse json data
app.use(express.urlencoded({extended:true})); // to parse url encoded data
app.use(express.static(path.join(__dirname, "../../client"))); 

app.get('/', (req, res)=>{
    // return res.send("html page where you can either create or join room");
    return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/home.html`));
})

app.get('/check', (req, res)=>{
    let {roomId} = req.params;
    checkRoomAvailability(roomId, ws)
        .then((roomId)=>{
            res.redirect(`/${roomId}`);
        })
        .catch((error)=>{
            res.status(400).send(error)
        })
})

app.get('/:id', (req, res)=>{
    return res.sendFile(path.join(__dirname, STATIC_PATH + `/html/room.html`));
    // return res.send("html page with the client side webRTC and websocket logic for video conferencing, chat etc.");
})

app.listen(3000, ()=>{console.log("http listening at 3000")});