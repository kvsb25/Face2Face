const maxClients = 2;
const rooms = new Map();

const createRoom = () => {
    let room = generateRandomString();
    rooms.set(room,1);
    console.log("createRoom(): "+rooms.get(room));
    return room;
}

const joinRoom = (room) => {
    let userCount = rooms.get(room);
    console.log("joinRoomA: "+rooms.get(room));
    console.log("joinRoomB: "+userCount);
    if(rooms.has(room) && (userCount < maxClients)){
        userCount++;
        rooms.set(room, userCount);
        return true;
    } else {
        return false;
    }

}

const checkRoom = (room) => {
    return rooms.has(room)
}

function getRandomLetters(length) {
    let result = '';
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function generateRandomString() {
    let result = getRandomLetters(3) + '-' + getRandomLetters(3) + '-' + getRandomLetters(3);

    if(!(rooms.has(result))) {
        return result;
    } else {
        return generateRandomString();
    }
}  

module.exports = {createRoom, joinRoom, rooms};