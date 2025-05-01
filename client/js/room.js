const pc = new RTCPeerConnection();
const ws = new WebSocket('ws://localhost:3001');
// roomId from the url params
const urlParts = window.location.pathname.split('/');
const roomId = urlParts[urlParts.length - 1];

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "join-room", roomId }));
}

// When we find a new ICE candidate, send it to signaling server
pc.onicecandidate = (event) => {
  if (event.candidate) {
    ws.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate }));
  }
};

// When a remote media track is received
pc.ontrack = (event) => {
  const remoteVideo = document.getElementById('remote-video');
  remoteVideo.srcObject = event.streams[0];
};

// Handle incoming signaling messages
ws.onmessage = async (message) => {
  const data = JSON.parse(message.data);

  switch (data.type) {
    case "join-successful":
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          // Display your own video
          const localVideo = document.getElementById('self-video');
          localVideo.srcObject = stream;

          // Add your media tracks to the peer connection
          stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
          });
        });
      break;

    // creates offer, if selected as an offerer by the signaling server): on ready-to-offer create an offer and send the offer to the signaling server
    case "ready-to-offer":
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          ws.send(JSON.stringify({ type: "offer", offer: pc.localDescription }));
        });
      break;

    case "offer":
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: "answer", answer: pc.localDescription }));
      break;

    case "answer":
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      break;

    case "ice-candidate":
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.error('Error adding received ice candidate', e);
      }
      break;

    default:
      console.log('Unknown message type:', data.type);
  }
};