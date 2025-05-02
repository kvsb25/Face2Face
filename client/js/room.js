const pc = new RTCPeerConnection();
const ws = new WebSocket('ws://localhost:3001');
const urlParts = window.location.pathname.split('/');
const roomId = urlParts[urlParts.length - 1];
let userName;
let localStream = null;

const messageBox = document.querySelector('#message');
const sendMsgBtn = document.querySelector('#send-message');
const chatBox = document.querySelector('#chat-box');

async function setupMediaAndConnection() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    
    const localVideo = document.getElementById('self-video');
    localVideo.srcObject = localStream;
    
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "join-room", roomId }));
    }
  } catch (err) {
    console.error('Error setting up media:', err);
  }
}

pc.addEventListener('connectionstatechange', () => {
  console.log("Connection state:", pc.connectionState);
  if (pc.connectionState === 'connected') {
    console.log("Peer connection successfully established!");
  } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
    console.log("Connection lost or failed, may need to reconnect");
  }
});

pc.oniceconnectionstatechange = () => {
  console.log("ICE state:", pc.iceConnectionState);
};

pc.onicecandidate = (event) => {
  if (event.candidate) {
    ws.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate }));
  }
};

pc.ontrack = (event) => {
  console.log("Remote track received:", event.streams);
  const remoteVideo = document.getElementById('remote-video');
  remoteVideo.srcObject = event.streams[0];
};

ws.onopen = () => {
  console.log("WebSocket connected");
  setupMediaAndConnection();
};

ws.onclose = (event) => {
  console.log("WebSocket closed:", event.code, event.reason);
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

// Handle incoming messages
ws.onmessage = async (message) => {
  let data;
  try {
    if (typeof message.data === 'string') {
      data = JSON.parse(message.data);
    } else if (message.data instanceof Blob) {
      const textData = await message.data.text();
      data = JSON.parse(textData);
    }
  } catch (err) {
    console.error("Error parsing message:", err);
    return;
  }

  console.log(`Received message type: ${data.type}`);
  
  try {
    switch (data.type) {
      case "join-successful":
        console.log("Successfully joined room");
        break;

      // caller creates offer  
      case "ready-to-offer":
        console.log("Creating offer");
        userName = "user1";

        const dataChannel = pc.createDataChannel("myChannel");
        dataChannel.onopen = () => console.log("Data channel open");
        dataChannel.onmessage = (event) => console.log("Received:", event.data);
        dataChannel.onclose = () => {}

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "offer", offer: pc.localDescription }));
        break;

      // callee receives offer  
      case "offer":
        console.log("Received offer");
        userName = "user2";

        pc.ondatachannel = (event) => {
          const dataChannel = event.channel;
          dataChannel.onopen = () => console.log("Data channel open");
          dataChannel.onmessage = (event) => console.log("Received:", event.data);
          dataChannel.onclose = (event) => {}
        };

        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", answer: pc.localDescription }));
        break;

      case "answer":
        console.log("Received answer");
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        break;

      case "ice-candidate":
        console.log("Received ICE candidate");
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        break;

      default:
        console.log('Unknown message type:', data.type);
    }
  } catch (err) {
    console.error(`Error handling message type ${data.type}:`, err);
  }
};

window.addEventListener('beforeunload', () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  pc.close();
  ws.close();
});

function sendMessageHandler(dataChannel, event){
  const message = messageBox.textContent;

  const payload = {
    user: userName,
    message
  }

  dataChannel.send(JSON.stringify(payload));
}

function receiveMessageHandler(user, message){
  // create html element with #chat
  // add innerHtml
}

// add eventlisteners to sendMsgBtn and messageBox