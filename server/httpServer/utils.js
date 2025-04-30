const { v4: uuidv4 } = require('uuid'); // Use uuid to generate unique request IDs
const pendingRequests = new Map();

const checkRoomAvailability = (roomId, ws) => {
    const requestId = uuidv4(); // Unique ID for this request

    const payload = {
        type: 'CHECK_ROOM2',
        roomId,
        requestId,
    };

    ws.send(JSON.stringify(payload));

    return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });

        // Optional: timeout cleanup
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject('TIMEOUT');
            }
        }, 5000); // 5s timeout
    });
};

const createRoom = (ws) => {
    const requestId = uuidv4();

    const payload = {
        type: 'CREATE_ROOM2',
        requestId,
    };

    ws.send(JSON.stringify(payload));

    return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });

        // Optional: timeout cleanup
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject('TIMEOUT');
            }
        }, 5000); // 5s timeout
    });
}

const wssCall = (ws, payload) => {
    const requestId = uuidv4();

    payload.requestId = requestId;
    
    ws.send(JSON.stringify(payload));

    return new Promise((resolve, reject)=>{
        pendingRequests.set(requestId, { resolve, reject });

        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject('TIMEOUT');
            }
        }, 5000);
    })
}

// module.exports.pendingRequests = pendingRequests;

module.exports = {checkRoomAvailability, createRoom, wssCall, pendingRequests};