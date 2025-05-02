const pc = new RTCPeerConnection();
const ws = new WebSocket('ws://localhost:3001');
const urlParts = window.location.pathname.split('/');
const roomId = urlParts[urlParts.length - 1];
let localStream = null;

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
        // Media already set up before joining
        break;

      case "ready-to-offer":
        console.log("Creating offer");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "offer", offer: pc.localDescription }));
        break;

      case "offer":
        console.log("Received offer");
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