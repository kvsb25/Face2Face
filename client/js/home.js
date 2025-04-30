const selector = document.querySelector.bind(document);
const input = selector("#roomID");
const joinBtn = selector("#joinRoom");
const errorBox = selector(".error");
const loading = selector(".loading");
const createBtn = selector("#createRoom");
// const ws = new WebSocket('ws://localhost:3001');
axios.defaults.baseURL = 'http://localhost:3000/';

joinBtn.addEventListener('click', joinRoomHandler1)

createBtn.addEventListener('click', createRoomHandler1);

window.addEventListener('beforeunload', () => {
    ws.close();
});

function joinRoomHandler() {
    let roomId = input.value;
    ws.send(JSON.stringify({ type: 'CHECK_ROOM', roomId }));
    disableBtn(createBtn);
}

function joinRoomHandler1(){
    disableBtn(createBtn);
    let roomId = input.value;
    loading.style.display = 'block';
    axios.get(`api/room?roomId=${roomId}`)
        .then((response)=>{
            window.location.href = `/${response.data.roomId}`;
        })
        .catch((error)=>{
            loading.style.display = 'none';
            console.log("home.js error: "+error);
            errorBox.textContent = `can't join room: ${error.response?.data || 'some server issue'}`;
        })
}

function createRoomHandler() {
    ws.send(JSON.stringify({ type: 'CREATE_ROOM' }));
    disableBtn(joinBtn);
}

function createRoomHandler1() {
    disableBtn(joinBtn);
    axios.post(`/api/room`)
        .then((response)=>{
            window.location.href = `/${response.data.roomId}`;
        })
        .catch((error)=>{
            errorBox.textContent = `can't join room: ${error.response?.data || 'some server issue'}`;
        })
}

function disableBtn(btn){
    btn.disabled = true;
    setTimeout(()=>{
        btn.disabled = false;
    }, 1500);
}

// ws.onmessage = (message) => {
//     const data = JSON.parse(message.data);
//     console.log(data);
//     console.log(data.roomId);
//     console.log(typeof data.roomId);
//     if (data.type == "ROOM_FULL") {

//         // display error message : "Can't join room full"
//         errorBox.textContent = "Can't join, room is full";
        
//     } else if (data.type == "AVAILABLE") {
        
//         console.log('roomId in home.js: '+data.roomId)
//         window.location.href = `/${data.roomId}`;
        
//     } else if (data.type == "NO_ROOM") {
        
//         // display error message: "No such room exists"
//         errorBox.textContent = 'no such room exists';
        
//     } else if (data.type == "CREATE_ROOM") {
        
//         if (data.roomId !== 'no_ID') {

//             // redirect to the newly created room
//             window.location.href = `/${data.roomId}`;
            
//         } else {
            
//             // display error message
//             errorBox.textContent = 'Some issue at the server. Try again some time later!';
//         }
//     }
// }

// ws.onerror = (error) => {
//     console.error("Websocket error: " + error);
// }

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