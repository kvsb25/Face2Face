const { ROOM_MANAGER_URL } = require('../config.js').constants;

// REST client for the roomManager service. The httpServer creates and checks
// rooms; the actual join/leave counting is done by the wsServer when a peer's
// WebSocket connects or disconnects (see server/wsServer/roomManager.js).

const createRoom = async () => {
    try {
        const response = await fetch(`${ROOM_MANAGER_URL}/api/rooms`, { method: 'POST' });
        if (!response.ok) return null;
        const data = await response.json();
        console.log("createRoom(): " + data.roomId);
        return data.roomId;
    } catch (err) {
        console.error("createRoom(): roomManager service unreachable: " + err);
        return null;
    }
}

// returns { exists, full } or null when the service is unreachable
const checkRoom = async (room) => {
    try {
        const response = await fetch(`${ROOM_MANAGER_URL}/api/rooms/${room}`);
        if (response.status === 404) return { exists: false, full: false };
        if (!response.ok) return null;
        const data = await response.json();
        return { exists: true, full: data.full };
    } catch (err) {
        console.error("checkRoom(): roomManager service unreachable: " + err);
        return null;
    }
}

module.exports = { createRoom, checkRoom };
