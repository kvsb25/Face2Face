const pc = new RTCPeerConnection(); // pc : peer connection
const ws = new WebSocket('ws://localhost:3001'); // ws : websocket connection
const urlParts = window.location.pathname.split('/');
const roomId = urlParts[urlParts.length - 1];
let localStream = null;
let receivedBuffers = [];
let fileSend = false;

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

function initDataChannel(dataChannel) {
  dataChannel.onopen = () => {
    messageBox.disable = false;
    sendMsgBtn.disable = false;
  };

  sendMsgBtn.addEventListener('click', () => {
    if (dataChannel && dataChannel.readyState === "open") {
      sendMessageHandler(dataChannel);
    } else {
      console.warn("Data channel is not open.");
    }
  });

  sendFileBtn.addEventListener('click', ()=>{
    if (dataChannel && dataChannel.readyState === "open") {
      sendFileHandler(dataChannel, fileSend);
    } else {
      console.warn("Data channel is not open.");
    }
  })

  dataChannel.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const { type, user, message, fileChunk } = data;
    if (type == 'message') {

      addChat(user, message);

    } else if (type == 'file' && fileSend == false) {

      if (fileChunk === "EOF" || data.EOF == true) {

        const fileName = receivedBuffers.shift();
        const blob = new Blob(receivedBuffers);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        console.log("download url: ", url);
        a.href = url;
        a.download = fileName;
        a.textContent = fileName;
        a.click();
        addChat(user, a.outerHTML);
        console.log('anchor tag outHTMl: ',a.outerHTML);
        receivedBuffers = [];

      } else {

        receivedBuffers.push(fileChunk);

      }
    }
  };

  dataChannel.onclose = () => {
    messageBox.disable = true;
    sendMsgBtn.disable = true;
  }
}


/************** Event Handlers **************/

/**** Peer connection handlers ****/
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

/**** Websocket Signaling server handlers ****/
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

        initDataChannel(dataChannel);

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

          initDataChannel(dataChannel);
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

/*** Window event handlers ***/
window.addEventListener('beforeunload', () => { // to disconnect before leaving the page
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  pc.close();
  ws.close();
});