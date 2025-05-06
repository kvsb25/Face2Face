# Face2Face

Face2Face is a real-time video conferencing and file-sharing application leveraging WebRTC and WebSockets. The platform allows users to join or create rooms for seamless video communication and data exchange.

## Features
- **Video Conferencing:** Real-time video and audio communication using WebRTC.
- **File Sharing:** Send files securely within a room.
- **Room Management:** Create or join rooms with a maximum limit of participants.
- **Error Handling:** Comprehensive error management and user feedback.

## Getting Started

### Prerequisites
- Node.js (v14 or above)
- npm (Node Package Manager)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/kvsb25/Face2Face.git
   cd Face2Face
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

1. **Start the WebSocket Server**:
   Navigate to the `server/wsServer` directory and run:
   ```bash
   node app.js
   ```
   The WebSocket server listens on port `3001`.

2. **Start the HTTP Server**:
   Navigate to the `server/httpServer` directory and run:
   ```bash
   node app.js
   ```
   The HTTP server listens on port `3000`.

3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Code Structure
- **Client**: Contains the frontend code for the application.
  - `client/js/home.js` - Handles homepage logic for room creation and joining.
  - `client/js/room.js` - Manages room-specific WebRTC and WebSocket logic.
  - `client/js/roomFrontend.js` - Implements file-sharing and chat features.

- **Server**:
  - `server/wsServer/app.js` - WebSocket server for signaling.
  - `server/wsServer/roomManager.js` - Manages room creation and joining logic.
  - `server/httpServer/app.js` - HTTP server for serving the frontend and REST APIs.
  - `server/httpServer/utils.js` - Utility functions for room availability checks and other features.

## Environment Variables
If applicable, set up a `.env` file in the root directory with the following variables:
- `PORT` - HTTP server port (default: 3000).
- `WS_PORT` - WebSocket server port (default: 3001).

## Contributing
Contributions, issues, and feature requests are welcome!

## License
This project is licensed under the MIT License. See the `LICENSE` file for more details.

## Acknowledgments
- [WebRTC](https://webrtc.org/)
- [Node.js](https://nodejs.org/)