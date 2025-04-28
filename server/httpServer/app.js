const express = require('express');
const app = express();

app.use(express.json()); // to parse json data
app.use(express.urlencoded({extended:true})); // to parse url encoded data
app.use(express.static(path.join(__dirname, "../client")));

// app.use('/api/v1', router);

app.get('/', (req, res)=>{
    // return res.send("html page where you can either create or join room");
    return res.sendFile(path.join(__dirname, '../../../client/html', 'index.html'));
})

app.get('/:id', (req, res)=>{
    return res.send("html page with the client side webRTC and websocket logic for video conferencing, chat etc.");
})

app.listen(3000, ()=>{console.log("http listening at 3000")});