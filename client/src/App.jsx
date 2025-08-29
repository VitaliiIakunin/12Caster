import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';

const initialServerUrl = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3000';

export default function App() {
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [roomId, setRoomId] = useState('room-1');
  const [displayName, setDisplayName] = useState('Guest');
  const [connected, setConnected] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const socketRef = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const peerIdRef = useRef(null);

  const localAudioProducerRef = useRef(null);
  const localVideoProducerRef = useRef(null);
  const localVideoRef = useRef(null);

  const producerIdToPeerIdRef = useRef(new Map());
  const [remoteMedia, setRemoteMedia] = useState([]); // [{ producerId, consumerId, peerId, kind, stream }]

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      try { localAudioProducerRef.current?.close(); } catch {}
      try { localVideoProducerRef.current?.close(); } catch {}
      try { sendTransportRef.current?.close(); } catch {}
      try { recvTransportRef.current?.close(); } catch {}
      try { socketRef.current?.disconnect(); } catch {}
    };
  }, []);

  async function joinRoom() {
    setError('');
    setJoining(true);
    try {
      const socket = io(serverUrl, { transports: ['websocket'] });
      socketRef.current = socket;

      const { peerId, rtpCapabilities, error: joinError } = await emitAsync(socket, 'join', { roomId, displayName });
      if (joinError) throw new Error(joinError);
      peerIdRef.current = peerId;

      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      deviceRef.current = device;

      // Create transports
      const sendInfo = await emitAsync(socket, 'createTransport', { direction: 'send' });
      if (sendInfo.error) throw new Error(sendInfo.error);
      const sendTransport = device.createSendTransport(sendInfo);
      wireTransportConnection(sendTransport, socket);
      wireTransportProduction(sendTransport, socket);
      sendTransportRef.current = sendTransport;

      const recvInfo = await emitAsync(socket, 'createTransport', { direction: 'recv' });
      if (recvInfo.error) throw new Error(recvInfo.error);
      const recvTransport = device.createRecvTransport(recvInfo);
      wireTransportConnection(recvTransport, socket);
      recvTransportRef.current = recvTransport;

      // Pre-consume existing producers
      const { producerIds, error: gpError } = await emitAsync(socket, 'getProducers', {});
      if (gpError) throw new Error(gpError);
      for (const producerId of producerIds) {
        await consumeProducer(producerId);
      }

      // Listen for new producers
      socket.on('new-producer', async ({ producerId, kind, peerId }) => {
        producerIdToPeerIdRef.current.set(producerId, peerId);
        await consumeProducer(producerId);
      });

      // Peer left -> drop media
      socket.on('peer-left', ({ peerId }) => {
        setRemoteMedia((prev) => prev.filter((m) => m.peerId !== peerId));
      });

      // Remote producer pause/resume events
      socket.on('producer-paused', ({ producerId }) => {
        // Just visual hint; media will stall automatically
        // Could add overlay
      });
      socket.on('producer-resumed', ({ producerId }) => {
        // Remove overlay if implemented
      });

      setConnected(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setJoining(false);
    }
  }

  function wireTransportConnection(transport, socket) {
    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        const res = await emitAsync(socket, 'connectTransport', { transportId: transport.id, dtlsParameters });
        if (res?.error) throw new Error(res.error);
        callback();
      } catch (err) {
        errback(err);
      }
    });
  }

  function wireTransportProduction(sendTransport, socket) {
    sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
      try {
        const res = await emitAsync(socket, 'produce', { transportId: sendTransport.id, kind, rtpParameters, appData });
        if (res?.error) throw new Error(res.error);
        callback({ id: res.id });
      } catch (err) {
        errback(err);
      }
    });
  }

  async function consumeProducer(producerId) {
    const socket = socketRef.current;
    const device = deviceRef.current;
    const recvTransport = recvTransportRef.current;
    if (!socket || !device || !recvTransport) return;
    try {
      const res = await emitAsync(socket, 'consume', { producerId, rtpCapabilities: device.rtpCapabilities });
      if (res?.error) throw new Error(res.error);
      const consumer = await recvTransport.consume({ id: res.id, producerId: res.producerId, kind: res.kind, rtpParameters: res.rtpParameters });
      const stream = new MediaStream([consumer.track]);
      const peerId = producerIdToPeerIdRef.current.get(producerId) || 'peer';
      setRemoteMedia((prev) => ([...prev, { producerId, consumerId: consumer.id, peerId, kind: res.kind, stream }]));
      await emitAsync(socket, 'resumeConsumer', { consumerId: consumer.id });
    } catch (err) {
      console.error('consume error', err);
    }
  }

  async function startMic() {
    const device = deviceRef.current;
    const sendTransport = sendTransportRef.current;
    if (!device || !sendTransport) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    const producer = await sendTransport.produce({ track });
    localAudioProducerRef.current = producer;
  }

  async function stopMic() {
    const socket = socketRef.current;
    const producer = localAudioProducerRef.current;
    if (!producer) return;
    try {
      await emitAsync(socket, 'pauseProducer', { producerId: producer.id });
    } catch {}
    try { producer.track.stop(); } catch {}
    try { producer.close(); } catch {}
    localAudioProducerRef.current = null;
  }

  async function startCamera() {
    const sendTransport = sendTransportRef.current;
    if (!sendTransport) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const track = stream.getVideoTracks()[0];
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = new MediaStream([track]);
      localVideoRef.current.muted = true;
      localVideoRef.current.play().catch(() => {});
    }
    const encodings = [
      { rid: 'q', maxBitrate: 150_000 },
      { rid: 'h', maxBitrate: 600_000 },
      { rid: 'f', maxBitrate: 1_200_000 }
    ];
    const codecOptions = { videoGoogleStartBitrate: 800 };
    const producer = await sendTransport.produce({ track, encodings, codecOptions, appData: { mediaTag: 'cam' } });
    localVideoProducerRef.current = producer;
  }

  async function stopCamera() {
    const socket = socketRef.current;
    const producer = localVideoProducerRef.current;
    if (!producer) return;
    try { await emitAsync(socket, 'pauseProducer', { producerId: producer.id }); } catch {}
    try { producer.track.stop(); } catch {}
    try { producer.close(); } catch {}
    localVideoProducerRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }

  async function togglePause(producerId, paused) {
    const socket = socketRef.current;
    if (!socket) return;
    if (paused) await emitAsync(socket, 'resumeProducer', { producerId });
    else await emitAsync(socket, 'pauseProducer', { producerId });
  }

  async function changeQuality(consumerId, spatialLayer) {
    const socket = socketRef.current;
    if (!socket) return;
    await emitAsync(socket, 'setPreferredLayers', { consumerId, spatialLayer, temporalLayer: 2 });
  }

  async function leaveRoom() {
    const socket = socketRef.current;
    try { await emitAsync(socket, 'leave', {}); } catch {}
    try { socket?.disconnect(); } catch {}
    setConnected(false);
    setRemoteMedia([]);
    producerIdToPeerIdRef.current = new Map();
    try { localAudioProducerRef.current?.close(); } catch {}
    try { localVideoProducerRef.current?.close(); } catch {}
    try { sendTransportRef.current?.close(); } catch {}
    try { recvTransportRef.current?.close(); } catch {}
  }

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <input placeholder="Server URL" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="Room ID" value={roomId} onChange={(e) => setRoomId(e.target.value)} />
          <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          {!connected ? (
            <button className="primary" disabled={joining} onClick={joinRoom}>{joining ? 'Joining…' : 'Join'}</button>
          ) : (
            <button className="danger" onClick={leaveRoom}>Leave</button>
          )}
        </div>
        {error && <div style={{ color: '#fca5a5', marginTop: 8 }}>{error}</div>}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <button onClick={startMic} disabled={!connected || !!localAudioProducerRef.current}>Mic On</button>
          <button onClick={stopMic} disabled={!connected || !localAudioProducerRef.current}>Mic Off</button>
          <button onClick={startCamera} disabled={!connected || !!localVideoProducerRef.current}>Camera On</button>
          <button onClick={stopCamera} disabled={!connected || !localVideoProducerRef.current}>Camera Off</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="video-tile" style={{ width: 320 }}>
            <div className="badge">You</div>
            <video ref={localVideoRef} autoPlay playsInline muted></video>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ marginBottom: 8, fontWeight: 600 }}>Participants</div>
        <div className="grid">
          {remoteMedia.filter(m => m.kind === 'video').map((m) => (
            <RemoteVideoTile key={m.consumerId} item={m} onChangeQuality={changeQuality} />
          ))}
        </div>
        {remoteMedia.filter(m => m.kind === 'audio').map((m) => (
          <AudioPlayer key={m.consumerId} stream={m.stream} />
        ))}
      </div>
    </div>
  );
}

function RemoteVideoTile({ item, onChangeQuality }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = item.stream;
      ref.current.play().catch(() => {});
    }
  }, [item.stream]);
  return (
    <div className="video-tile">
      <div className="badge">{item.peerId?.slice(0, 6) || 'peer'}</div>
      <video ref={ref} autoPlay playsInline />
      <div className="row" style={{ padding: 8 }}>
        <label>Quality:</label>
        <select defaultValue={2} onChange={(e) => onChangeQuality(item.consumerId, Number(e.target.value))}>
          <option value={0}>Low</option>
          <option value={1}>Med</option>
          <option value={2}>High</option>
        </select>
      </div>
    </div>
  );
}

function emitAsync(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res || {}));
  });
}

function AudioPlayer({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

