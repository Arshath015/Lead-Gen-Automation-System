import { useState, useEffect, useRef } from 'react';

declare global {
  interface Window {
    startRecording?: () => void;
    stopRecording?: () => void;
  }
}

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const [currentScene, setCurrentScene] = useState(0);
  const isFirstPass = useRef(true);
  
  useEffect(() => {
    let mounted = true;
    let timeout: NodeJS.Timeout;
    
    const sceneKeys = Object.keys(durations);
    
    const playSequence = async () => {
      if (isFirstPass.current) {
        window.startRecording?.();
      }
      
      for (let i = 0; i < sceneKeys.length; i++) {
        if (!mounted) return;
        setCurrentScene(i);
        await new Promise(r => { timeout = setTimeout(r, durations[sceneKeys[i]]); });
      }
      
      if (!mounted) return;
      if (isFirstPass.current) {
        window.stopRecording?.();
        isFirstPass.current = false;
      }
      
      // Loop
      playSequence();
    };
    
    playSequence();
    
    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, [JSON.stringify(durations)]);

  return { currentScene };
}
