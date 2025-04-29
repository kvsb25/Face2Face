module.exports.checkRoomAvailability = (roomId, ws) => {
    ws.send(JSON.stringify({type: 'CHECK_ROOM2', roomId}));

    return new Promise((resolve, reject)=>{
        ws.onmessage = (message) =>{
            const data = JSON.parse(message.data);
            if(data.type == 'AVAILABLE') {
                resolve(data.roomId);
            } else {
                reject(data.type);
            }
        }
    })
}
