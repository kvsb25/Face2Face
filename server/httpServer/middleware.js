const { checkRoomAvailability } = require("./utils")

const setSocket = (ws) => {
    return function (req, res, next) {
        req.ws = ws;
        next();
    }
}

module.exports = {checkRoom}