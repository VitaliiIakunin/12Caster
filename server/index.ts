// server/index.ts
import { WebSocketServer, WebSocket } from 'ws';

type ChatMessage = {
  type: 'chat';
  username: string;
  text: string;
  timestamp: number;
};

type SystemMessage = {
  type: 'system';
  message: string;
  timestamp: number;
};

type ConnectedUser = {
  userId: string;
  username: string;
  ws: WebSocket;
};

type UserAudioState = {
  userId: string;
  isAudioEnabled: boolean;
};

type UserVideoState = {
  userId: string;
  isVideoEnabled: boolean;
};

const userAudioConnections: Map<string, Set<string>> = new Map(); // userId -> set of connected user IDs

type OfferMessage = {
  type: 'webrtc_offer';
  targetUserId: string;
  offer: any;
};

type AnswerMessage = {
  type: 'webrtc_answer';
  targetUserId: string;
  answer: any;
};

type ICECandidateMessage = {
  type: 'webrtc_ice_candidate';
  targetUserId: string;
  candidate: any;
};

function broadcastAudioConnection(
  userId: string,
  connectedUserId: string,
  isConnected: boolean
) {
  const msg = {
    type: 'audio_connection_update',
    userId,
    connectedUserId,
    isConnected,
  };
  broadcast(msg);
}

type AudioOfferMessage = {
  type: 'audio_webrtc_offer';
  targetUserId: string;
  offer: any;
};

type AudioAnswerMessage = {
  type: 'audio_webrtc_answer';
  targetUserId: string;
  answer: any;
};

type AudioICECandidateMessage = {
  type: 'audio_webrtc_ice_candidate';
  targetUserId: string;
  candidate: any;
};

const MAX_CLIENTS = 200;
const clients: Map<WebSocket, { username: string; userId: string }> = new Map();
const connectedUsers: Map<string, ConnectedUser> = new Map();
const userAudioStates: Map<string, UserAudioState> = new Map();
const userVideoStates: Map<string, UserVideoState> = new Map();

const wss = new WebSocketServer({ port: 8080 });

// Helper: broadcast to all clients except optionally one
function broadcast(msg: object, exceptWs?: WebSocket) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== exceptWs) {
      client.send(data);
    }
  });
}

// Helper: send message to specific client
function sendToClient(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// Helper: generate unique ID
function generateUserId(): string {
  return Math.random().toString(36).substr(2, 9);
}

// Helper: broadcast user list to all clients
function broadcastUserList() {
  const userList = Array.from(connectedUsers.values()).map((user) => ({
    userId: user.userId,
    username: user.username,
  }));
  broadcast({
    type: 'user_list',
    users: userList,
  });
}

function broadcastAudioStates() {
  const states = Array.from(userAudioStates.values());
  broadcast({
    type: 'audio_states',
    states,
  });
}

function broadcastVideoStates() {
  const states = Array.from(userVideoStates.values());
  broadcast({
    type: 'video_states',
    states,
  });
}

wss.on('connection', (ws: WebSocket) => {
  console.log('New client connected');

  if (wss.clients.size > MAX_CLIENTS) {
    sendToClient(ws, {
      type: 'error',
      message: 'Server full. Try again later.',
    });
    ws.close();
    return;
  }

  // Request username immediately after connection
  sendToClient(ws, { type: 'request_username' });
  const userList = Array.from(connectedUsers.values()).map((user) => ({
    userId: user.userId,
    username: user.username,
  }));
  sendToClient(ws, {
    type: 'user_list',
    users: userList,
  });

  ws.on('message', (message: Buffer, isBinary: boolean) => {
    if (!isBinary) {
      let data: any;
      try {
        data = JSON.parse(message.toString());
      } catch {
        sendToClient(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      if (data.type === 'set_username') {
        if (
          typeof data.username === 'string' &&
          data.username.trim().length > 0
        ) {
          const userId = generateUserId();
          const username = data.username.trim();

          clients.set(ws, { username, userId });
          connectedUsers.set(userId, { userId, username, ws });

          // Send acceptance to client
          sendToClient(ws, {
            type: 'username_accepted',
            username,
            userId,
          });

          // Notify all other clients about new user
          broadcast(
            {
              type: 'system',
              message: `${username} joined the chat.`,
              timestamp: Date.now(),
            },
            ws
          );

          // Send updated user list to all clients
          broadcastUserList();

          // Send current audio/video states to new user
          broadcastAudioStates();
          broadcastVideoStates();
        } else {
          sendToClient(ws, { type: 'error', message: 'Invalid username' });
        }
        return;
      }

      if (data.type === 'chat') {
        const clientInfo = clients.get(ws) || {
          username: 'Anonymous',
          userId: '',
        };
        const chatMsg: ChatMessage = {
          type: 'chat',
          username: clientInfo.username,
          text: data.text || '',
          timestamp: Date.now(),
        };
        broadcast(chatMsg);
        return;
      }

      if (data.type === 'audio_enabled') {
        const clientInfo = clients.get(ws);
        if (clientInfo) {
          userAudioStates.set(clientInfo.userId, {
            userId: clientInfo.userId,
            isAudioEnabled: true,
          });
          broadcastAudioStates();
        }
        return;
      }

      if (data.type === 'audio_disabled') {
        const clientInfo = clients.get(ws);
        if (clientInfo) {
          userAudioStates.set(clientInfo.userId, {
            userId: clientInfo.userId,
            isAudioEnabled: false,
          });
          broadcastAudioStates();
        }
        return;
      }

      if (data.type === 'video_enabled') {
        const clientInfo = clients.get(ws);
        if (clientInfo) {
          userVideoStates.set(clientInfo.userId, {
            userId: clientInfo.userId,
            isVideoEnabled: true,
          });
          broadcastVideoStates();
        }
        return;
      }

      if (data.type === 'video_disabled') {
        const clientInfo = clients.get(ws);
        if (clientInfo) {
          userVideoStates.set(clientInfo.userId, {
            userId: clientInfo.userId,
            isVideoEnabled: false,
          });
          broadcastVideoStates();
        }
        return;
      }

      // WebRTC signaling (в server/index.ts)
      if (
        data.type === 'webrtc_offer' ||
        data.type === 'webrtc_answer' ||
        data.type === 'webrtc_ice_candidate'
      ) {
        const targetUser = connectedUsers.get(data.targetUserId);
        if (targetUser && targetUser.ws.readyState === WebSocket.OPEN) {
          // Add sender info to message
          const senderInfo = clients.get(ws);
          if (senderInfo) {
            const messageWithSender = {
              ...data,
              senderUserId: senderInfo.userId,
              senderUsername: senderInfo.username,
            };
            targetUser.ws.send(JSON.stringify(messageWithSender));
          }
        }
        return;
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    const clientInfo = clients.get(ws);
    if (clientInfo) {
      broadcast(
        {
          type: 'system',
          message: `${clientInfo.username} left the chat.`,
          timestamp: Date.now(),
        },
        ws
      );

      // Remove user from connected list
      connectedUsers.delete(clientInfo.userId);

      // Update user list for all clients
      broadcastUserList();
      userAudioStates.delete(clientInfo.userId);
      userVideoStates.delete(clientInfo.userId);
      broadcastAudioStates();
      broadcastVideoStates();

      const userId = clientInfo.userId;
      userAudioConnections.delete(userId);
    }

    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

console.log('WebSocket server is running on ws://localhost:8080');
