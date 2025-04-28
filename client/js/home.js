const input = document.querySelector("#roomID");
const roomId = input.value;
const ws = new WebSocket('ws://localhost:3001');

ws.onmessage = (message) => {
    const data = JSON.parse(message);

    if (data.type == "ROOM_FULL") {

        // display error message : "Can't join room full"
        
    } else if (data.type == "AVAILABLE") {
        
        window.location.href = `/${roomId}`;
        
    } else if (data.type == "NO_ROOM") {
        
        // display error message: "No such room exists"
        
    } else if (data.type == "CREATE_ROOM") {
        
        if (data.roomId !== 'no_ID') {

            // redirect to the newly created room
            window.location.href = `/${data.roomId}`;
            
        } else {
            
            // display error message
            
        }
    }
}

ws.onerror = (error) => {
    console.error("Websocket error: " + error);
}

function joinRoomHandler1() {
    ws.send(JSON.stringify({ type: 'CHECK_ROOM', roomId }));
}

function createRoomHandler1() {
    ws.send(JSON.stringify({ type: 'CREATE_ROOM', roomId }));
}

window.addEventListener('beforeunload', () => {
    ws.close();
});

// unt-shunt script 
// const ws = new WebSocket('ws://localhost:3001');
// from the roomId input box 

// function joinRoomHandler() {
//     if (!ws) {
//         const ws = new WebSocket('ws://localhost:3001');
//     }

//     ws.onopen = () => {
//         ws.send(JSON.stringify({ type: 'CHECK_ROOM', roomId }));
//     }

//     ws.onmessage = (message) => {
//         const data = JSON.parse(message);
//         ws.close();
//         delete ws;

//         if (data.type == "ROOM_FULL") {

//             // display error message : "Can't join room full"

//         } else if (data.type == "AVAILABLE") {

//             window.location.href = `/${roomId}`

//         } else if (data.type == "NO_ROOM") {

//             // display error message: "No such room exists"

//         }
//     }

//     ws.onerror = (error) => {
//         console.error("Websocket error: " + error);
//     }
// }

// function createRoomHandler() {
//     if (!ws) {
//         const ws = new WebSocket('ws://localhost:3001');
//     }

//     ws.onopen = () => {
//         ws.send(JSON.stringify({ type: 'CREATE_ROOM', roomId }));
//     }

//     ws.onmessage = (message) => {
//         const data = JSON.parse(message);

//         if (/*data.type == "ROOM_ID"*/ data.type == "CREATE_ROOM") {
//             // disconnect from the WSS (Signaling server)
//             ws.close();
//             ws = null;
//             if (data.roomId !== 'no_ID') {
//                 // redirect to the newly created room
//                 window.location.href = `/${data.roomId}`;
//             } else {
//                 // display error message
//             }
//         }
//     }
// }