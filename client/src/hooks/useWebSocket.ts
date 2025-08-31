// client/src/hooks/useWebSocket.ts
import { useState, useEffect, useRef } from 'react';

type Message = {
  type: string;
  [key: string]: any;
};

type ActiveSpeaker = {
  userId: string;
  volume: number;
};

type ConnectedUser = {
  userId: string;
  username: string;
};

type UserAudioState = {
  userId: string;
  isAudioEnabled: boolean;
};

type UserVideoState = {
  userId: string;
  isVideoEnabled: boolean;
};

type WebRTCPeer = {
  connection: RTCPeerConnection;
  userId: string;
  username: string;
  audioElement?: HTMLAudioElement;
};

export const useWebSocket = (url: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeSpeakers, setActiveSpeakers] = useState<ActiveSpeaker[]>([]);
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  const [userAudioStates, setUserAudioStates] = useState<UserAudioState[]>([]);
  const [userVideoStates, setUserVideoStates] = useState<UserVideoState[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, WebRTCPeer>>(new Map());
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const userIdRef = useRef<string>('');

  // Configuration for WebRTC
  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'stun:stun.stunprotocol.org:3478',
      },
      // Добавьте TURN сервер для лучшей совместимости
      {
        urls: 'turn:your-turn-server.com:3478',
        username: 'username',
        credential: 'password',
      },
    ],
    iceCandidatePoolSize: 10,
  };

  // Инициализация WebSocket
  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to WebSocket');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Обработка бинарных данных (видео/аудио)
        // В WebRTC это не используется
        return;
      } else {
        // Обработка JSON сообщений
        try {
          const data = JSON.parse(event.data);
          handleMessage(data);
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from WebSocket');
      setIsConnected(false);
      stopAllStreams();
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      ws.close();
      stopAllStreams();
    };
  }, [url]);

  const stopAllStreams = () => {
    // Остановить локальный поток
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Закрыть все WebRTC соединения
    peersRef.current.forEach((peer) => {
      peer.connection.close();
      if (peer.audioElement) {
        peer.audioElement.remove();
      }
    });
    peersRef.current.clear();

    setIsAudioEnabled(false);
    setIsVideoEnabled(false);
  };

  const handleMessage = (data: any) => {
    switch (data.type) {
      case 'user_list':
        setConnectedUsers(data.users);
        // Создаем WebRTC соединения для новых пользователей
        setTimeout(() => {
          createPeerConnections(data.users);
        }, 100);
        break;
      case 'audio_states':
        setUserAudioStates(data.states);
        break;
      case 'video_states':
        setUserVideoStates(data.states);
        break;
      case 'username_accepted':
        userIdRef.current = data.userId;
        setMessages((prev) => [...prev, data]);
        break;
      case 'chat':
      case 'system':
        setMessages((prev) => [...prev, data]);
        break;
      // WebRTC signaling
      case 'webrtc_offer':
        handleWebRTCOffer(data);
        break;
      case 'webrtc_answer':
        handleWebRTCAnswer(data);
        break;
      case 'webrtc_ice_candidate':
        handleWebRTCICECandidate(data);
        break;
      default:
        console.log('Unknown message type:', data.type);
    }
  };

  // Инициация звонка к пользователю
  const initiateCall = async (peer: WebRTCPeer) => {
    try {
      // Таймаут для установления соединения
      const connectionTimeout = setTimeout(() => {
        if (peer.connection.connectionState !== 'connected') {
          console.warn(`Connection timeout with ${peer.username}`);
          handleConnectionFailure(peer.userId, peer.username);
        }
      }, 10000); // 10 секунд таймаут

      const offer = await peer.connection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await peer.connection.setLocalDescription(offer);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'webrtc_offer',
            targetUserId: peer.userId,
            offer,
          })
        );
      }

      // Очищаем таймаут при успешном создании предложения
      clearTimeout(connectionTimeout);
    } catch (error) {
      console.error('Error initiating call:', error);
      handleConnectionFailure(peer.userId, peer.username);
    }
  };

  // Создание WebRTC соединений для всех пользователей
  const createPeerConnections = (users: ConnectedUser[]) => {
    users.forEach((user) => {
      // Не создаем соединение с самим собой
      if (
        user.userId !== userIdRef.current &&
        !peersRef.current.has(user.userId)
      ) {
        const peer = createPeerConnection(user.userId, user.username);
        // Инициируем звонок сразу после создания соединения
        if (userIdRef.current) {
          setTimeout(() => {
            const peerObj = peersRef.current.get(user.userId);
            if (peerObj) {
              initiateCall(peerObj);
            }
          }, 100);
        }
      }
    });
  };

  // Создание WebRTC соединения с пользователем
  const createPeerConnection = (userId: string, username: string) => {
    const peerConnection = new RTCPeerConnection(rtcConfig);

    // Добавляем локальный поток к соединению
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStreamRef.current!);
      });
    }

    // Обработка входящих потоков
    peerConnection.ontrack = (event) => {
      console.log(`Remote stream received from ${username}`);
      // Создаем аудио элемент для воспроизведения звука
      const audioElement = new Audio();
      audioElement.srcObject = event.streams[0];
      audioElement.autoplay = true;
      audioElement.playsInline = true; // Для мобильных устройств
      document.body.appendChild(audioElement); // Добавляем в DOM

      // Воспроизводим аудио
      audioElement.play().catch((error) => {
        console.error('Error playing audio:', error);
      });

      // Сохраняем ссылку на аудио элемент
      const peer = peersRef.current.get(userId);
      if (peer) {
        peer.audioElement = audioElement;
      }
    };

    // Обработка ICE кандидатов
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'webrtc_ice_candidate',
            targetUserId: userId,
            candidate: event.candidate,
          })
        );
      }
    };

    // Обработка состояния соединения
    // В createPeerConnection замените onconnectionstatechange:
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log(`Connection state with ${username}: ${state}`);

      switch (state) {
        case 'connected':
          console.log(`✅ Successfully connected to ${username}`);
          break;
        case 'failed':
          console.error(`❌ Connection failed with ${username}`);
          // Попытка переподключения
          handleConnectionFailure(userId, username);
          break;
        case 'disconnected':
          console.warn(`⚠️ Disconnected from ${username}`);
          break;
        case 'closed':
          console.log(`🔒 Connection closed with ${username}`);
          break;
      }
    };

    // В функции createPeerConnection добавьте:
    peerConnection.onicegatheringstatechange = () => {
      console.log(`ICE gathering state: ${peerConnection.iceGatheringState}`);
    };

    peerConnection.onsignalingstatechange = () => {
      console.log(`Signaling state: ${peerConnection.signalingState}`);
    };
    // Сохраняем соединение
    const peer: WebRTCPeer = {
      connection: peerConnection,
      userId,
      username,
    };
    peersRef.current.set(userId, peer);

    // Если у нас уже есть локальный поток, инициируем соединение
    if (localStreamRef.current && userIdRef.current) {
      initiateCall(peer);
    }

    return peerConnection;
  };

  // Обработка входящего предложения
  const handleWebRTCOffer = async (data: any) => {
    const { senderUserId, senderUsername, offer } = data;

    // Создаем соединение если его еще нет
    let peer = peersRef.current.get(senderUserId);
    if (!peer) {
      peer = createPeerConnection(senderUserId, senderUsername);
    }

    try {
      await peer.connection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      // Создаем ответ
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);

      // Отправляем ответ
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'webrtc_answer',
            targetUserId: senderUserId,
            answer,
          })
        );
      }
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  };

  // Обработка входящего ответа
  const handleWebRTCAnswer = async (data: any) => {
    const { senderUserId, answer } = data;
    const peer = peersRef.current.get(senderUserId);

    if (peer) {
      try {
        await peer.connection.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  };

  // Обработка ICE кандидата
  const handleWebRTCICECandidate = (data: any) => {
    const { senderUserId, candidate } = data;
    const peer = peersRef.current.get(senderUserId);

    if (peer && candidate) {
      // Добавлена проверка candidate
      peer.connection
        .addIceCandidate(new RTCIceCandidate(candidate))
        .catch((error) => {
          console.error('Error adding ICE candidate:', error);
          // Попытка восстановления при ошибке ICE
          if (error.toString().includes('InvalidStateError')) {
            handleConnectionFailure(senderUserId, peer.username);
          }
        });
    }
  };
  const handleConnectionFailure = (userId: string, username: string) => {
    console.log(`Attempting to reconnect to ${username}`);

    // Удаляем старое соединение
    const oldPeer = peersRef.current.get(userId);
    if (oldPeer) {
      oldPeer.connection.close();
      if (oldPeer.audioElement) {
        oldPeer.audioElement.remove();
      }
      peersRef.current.delete(userId);
    }

    // Создаем новое соединение через небольшую задержку
    setTimeout(() => {
      const newPeer = createPeerConnection(userId, username);
      initiateCall(newPeer);
    }, 1000);
  };

  const sendMessage = (message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  // Захват аудио потока
  const startAudioStreaming = async () => {
    try {
      // Если уже есть поток - остановить его
      if (localStreamRef.current) {
        localStreamRef.current
          .getAudioTracks()
          .forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      // Обновить или создать новый поток
      if (localStreamRef.current) {
        // Заменить аудио дорожку
        const oldAudioTracks = localStreamRef.current.getAudioTracks();
        oldAudioTracks.forEach((track) => {
          localStreamRef.current!.removeTrack(track);
        });
        stream.getAudioTracks().forEach((track) => {
          localStreamRef.current!.addTrack(track);
        });
      } else {
        localStreamRef.current = stream;
      }

      // Добавляем аудио дорожку ко всем существующим соединениям
      addTracksToPeers();

      setIsAudioEnabled(true);
      sendMessage({ type: 'audio_enabled' });
    } catch (err) {
      console.error('Error starting audio stream:', err);
    }
  };

  // Захват видео потока
  const startVideoStreaming = async (
    videoRef: React.RefObject<HTMLVideoElement>
  ) => {
    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      // Если уже есть поток - остановить видео дорожку
      if (localStreamRef.current) {
        localStreamRef.current
          .getVideoTracks()
          .forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Установить локальный поток в video элемент
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Обновить или создать новый поток
      if (localStreamRef.current) {
        // Заменить видео дорожку
        const oldVideoTracks = localStreamRef.current.getVideoTracks();
        oldVideoTracks.forEach((track) => {
          localStreamRef.current!.removeTrack(track);
        });
        stream.getVideoTracks().forEach((track) => {
          localStreamRef.current!.addTrack(track);
        });
      } else {
        localStreamRef.current = stream;
      }

      // Добавляем видео дорожку ко всем существующим соединениям
      addTracksToPeers();

      setIsVideoEnabled(true);
      sendMessage({ type: 'video_enabled' });
    } catch (err) {
      console.error('Error starting video stream:', err);
    }
  };

  // Добавление дорожек к существующим соединениям
  const addTracksToPeers = () => {
    if (!localStreamRef.current) return;

    peersRef.current.forEach((peer) => {
      // Удаляем старые дорожки
      const senders = peer.connection.getSenders();
      senders.forEach((sender) => {
        if (sender.track) {
          peer.connection.removeTrack(sender);
        }
      });

      // Добавляем новые дорожки
      localStreamRef.current!.getTracks().forEach((track) => {
        peer.connection.addTrack(track, localStreamRef.current!);
      });
    });
  };

  const stopAudioStreaming = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.stop();
        peersRef.current.forEach((peer) => {
          const sender = peer.connection
            .getSenders()
            .find((s) => s.track === track);
          if (sender) {
            peer.connection.removeTrack(sender);
          }
        });
      });
    }
    setIsAudioEnabled(false);
    sendMessage({ type: 'audio_disabled' });
  };

  const stopVideoStreaming = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.stop();
        peersRef.current.forEach((peer) => {
          const sender = peer.connection
            .getSenders()
            .find((s) => s.track === track);
          if (sender) {
            peer.connection.removeTrack(sender);
          }
        });
      });
    }
    setIsVideoEnabled(false);
    sendMessage({ type: 'video_disabled' });
  };

  return {
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
    userVideoStates,
    activeSpeakers,
  };
};
