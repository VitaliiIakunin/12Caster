// client/src/App.tsx
import React, { useState, useRef, useEffect } from "react";
import { useWebSocket } from "./hooks/useWebSocket";

const WS_URL = "ws://localhost:8080";

const App = () => {
  const { 
    isConnected, 
    messages, 
    sendMessage, 
    startAudioStreaming,
    stopAudioStreaming,
    isAudioEnabled,
    startVideoStreaming,
    stopVideoStreaming,
    isVideoEnabled,
    connectedUsers,
    userAudioStates,
    userVideoStates
  } = useWebSocket(WS_URL);
  
  const [input, setInput] = useState("");
  const [username, setUsername] = useState("");
  const [isUsernameSet, setIsUsernameSet] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());  

  const handleSetUsername = () => {
    if (username.trim()) {
      sendMessage({ type: "set_username", username: username.trim() });
      setIsUsernameSet(true);
    }
  };

  const handleSendMessage = () => {
    if (input.trim()) {
      sendMessage({ type: "chat", text: input.trim() });
      setInput("");
    }
  };

  const toggleAudio = () => {
    if (isAudioEnabled) {
      stopAudioStreaming();
    } else {
      startAudioStreaming();
    }
  };

  const toggleVideo = () => {
    if (isVideoEnabled) {
      stopVideoStreaming();
    } else {
      startVideoStreaming(localVideoRef);
    }
  };

  return (
    <div>
      <h1>12Caster Chat</h1>
      {!isUsernameSet ? (
        <div>
          <input
            type="text"
            placeholder="Enter username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSetUsername()}
          />
          <button onClick={handleSetUsername}>Set Username</button>
        </div>
      ) : (
        <div>
          <div>
            <span>Status: {isConnected ? "Connected" : "Disconnected"}</span>
            <span style={{ marginLeft: "10px" }}>
              Users online: {connectedUsers.length}
            </span>
            <button onClick={toggleAudio} style={{ marginLeft: "10px" }}>
              {isAudioEnabled ? "🔇 Mute Audio" : "🔊 Enable Audio"}
            </button>
            <button onClick={toggleVideo} style={{ marginLeft: "10px" }}>
              {isVideoEnabled ? "📷 Disable Video" : "📷 Enable Video"}
            </button>
          </div>
          
          {/* Локальное видео */}
          <div style={{ margin: '10px 0' }}>
            <h3>Your Video</h3>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '200px', height: '150px', border: '1px solid #ccc' }}
            />
          </div>
          
          {/* Доска подключенных пользователей */}
          <div style={{ margin: '10px 0' }}>
            <h3>Connected Users ({connectedUsers.length})</h3>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {connectedUsers.map((user) => {
                const hasAudioEnabled = userAudioStates.some(s => s.userId === user.userId && s.isAudioEnabled);
                const hasVideoEnabled = userVideoStates.some(s => s.userId === user.userId && s.isVideoEnabled);

                return (
                  <div 
                    key={user.userId} 
                    style={{ 
                      border: hasAudioEnabled ? '2px solid #00ffddff' : 'none', 
                      borderRadius: '8px', 
                      padding: '10px', 
                      backgroundColor: '#f8f9fa',
                      minWidth: '120px',
                      textAlign: 'center',
                      transition: 'border 0.3s ease',
                      position: 'relative'
                    }}
                  >
                    {hasVideoEnabled ? (
                      <div>
                        <video
                          ref={(el) => {
                            if (el) {
                              remoteVideoRefs.current.set(user.userId, el);
                            }
                          }}
                          autoPlay
                          playsInline
                          muted
                          style={{ width: '100%', height: 'auto', maxHeight: '150px' }}
                        />
                        <div style={{ fontWeight: 'bold', color: '#28a745', marginTop: '5px' }}>
                          {user.username}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontWeight: 'bold', color: '#28a745' }}>
                          {user.username}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {hasAudioEnabled ? '🎙️ Audio On' : 'Online'}
                        </div>
                      </div>
                    )}
                    {hasAudioEnabled && (
                      <div style={{
                        position: 'absolute',
                        top: '5px',
                        right: '5px',
                        width: '10px',
                        height: '10px',
                        backgroundColor: '#007bff',
                        borderRadius: '50%'
                      }}></div>
                    )}
                  </div>
                );
              })}
              {connectedUsers.length === 0 && (
                <div style={{ color: '#666', fontStyle: 'italic' }}>
                  No users connected
                </div>
              )}
            </div>
          </div>
          
          <div style={{ height: "200px", overflowY: "auto", border: "1px solid #ccc", padding: "10px", margin: "10px 0" }}>
            {messages.map((msg, index) => (
              <div key={index}>
                {msg.type === "system" && (
                  <i>{msg.message}</i>
                )}
                {msg.type === "chat" && (
                  <>
                  <strong>{msg.username}:</strong>
                  <div>{msg.text}</div>
                  </>
                )}
                {msg.type === "username_accepted" && (
                  <i>Username set to: {msg.username}</i>
                )}
              </div>
            ))}
          </div>
          <div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Type a message..."
            />
            <button onClick={handleSendMessage}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;