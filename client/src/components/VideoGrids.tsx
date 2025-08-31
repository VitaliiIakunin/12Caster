import React, { useEffect, useRef } from 'react';

type MediaElementProps = {
  userId: string;
  stream: MediaStream;
  isVideo: boolean;
};

const MediaElement: React.FC<MediaElementProps> = ({ userId, stream, isVideo }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (isVideo && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(console.error);
    } else if (!isVideo && audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch(console.error);
    }
  }, [stream, isVideo]);

  if (isVideo) {
    return (
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        style={{ display: 'none' }} 
      />
    );
  }
  
  return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />;
};

type VideoGridProps = {
  connectedUsers: { userId: string; username: string }[];
};

export const VideoGrid: React.FC<VideoGridProps> = ({ connectedUsers }) => {
  const [mediaStreams, setMediaStreams] = React.useState<
    { userId: string; stream: MediaStream; isVideo: boolean }[]
  >([]);

  useEffect(() => {
    const handleRemoteStream = (e: CustomEvent) => {
      const { userId, stream } = e.detail;
      // Определяем тип потока (видео или аудио)
      const isVideo = stream.getVideoTracks().length > 0;
      
      setMediaStreams((prev) => [
        ...prev.filter((s) => s.userId !== userId),
        { userId, stream, isVideo }
      ]);
    };

    window.addEventListener('remoteStream', handleRemoteStream as EventListener);
    return () => {
      window.removeEventListener('remoteStream', handleRemoteStream as EventListener);
    };
  }, []);

  return (
    <div style={{ display: 'none' }}>
      {mediaStreams.map(({ userId, stream, isVideo }) => (
        <MediaElement 
          key={`${userId}-${isVideo ? 'video' : 'audio'}`} 
          userId={userId} 
          stream={stream} 
          isVideo={isVideo} 
        />
      ))}
    </div>
  );
};