import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';

// Varying durations to match the treatment
const SCENE_DURATIONS = {
  open: 4000,
  lead: 6500,
  pipeline: 7000,
  dashboard: 8000,
  tasks: 6000,
  close: 5000,
};

const bgPos = [
  { x: '10vw', y: '20vh', scale: 1.2, opacity: 0.15 },
  { x: '50vw', y: '50vh', scale: 1.5, opacity: 0.2 },
  { x: '80vw', y: '10vh', scale: 0.8, opacity: 0.1 },
  { x: '40vw', y: '80vh', scale: 1.8, opacity: 0.25 },
  { x: '20vw', y: '40vh', scale: 1.1, opacity: 0.15 },
  { x: '50vw', y: '50vh', scale: 2.0, opacity: 0.1 },
];

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0B1121] text-white selection:bg-[#3B82F6]/30">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Generated Image Background */}
        <motion.div 
          className="absolute inset-0 opacity-10 bg-cover bg-center mix-blend-screen"
          style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/bg-tech.png)` }}
          animate={{ scale: [1, 1.1, 1], rotate: [0, 1, -1, 0] }}
          transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
        />

        <motion.div className="absolute w-[80vw] h-[80vw] rounded-full blur-[120px]"
          style={{ background: 'radial-gradient(circle, #3B82F6, transparent)' }}
          animate={bgPos[currentScene]}
          transition={{ duration: 2.5, ease: [0.22, 1, 0.36, 1] }} />
        
        <motion.div className="absolute w-[60vw] h-[60vw] rounded-full blur-[100px]"
          style={{ background: 'radial-gradient(circle, #F59E0B, transparent)' }}
          animate={{
            x: ['-20vw', '60vw', '-20vw'],
            y: ['60vh', '-10vh', '60vh'],
            opacity: [0.05, 0.1, 0.05],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }} />
      </div>

      {/* Grid Pattern Midground */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)`,
          backgroundSize: '4vw 4vw'
        }}
      />

      {/* Dynamic Persistent Line */}
      <motion.div
        className="absolute h-[2px] bg-gradient-to-r from-transparent via-[#3B82F6] to-transparent"
        animate={{
          top: ['20%', '80%', '50%', '30%', '70%', '50%'][currentScene],
          left: ['-50%', '10%', '0%', '20%', '5%', '-50%'][currentScene],
          width: ['200%', '80%', '100%', '60%', '90%', '200%'][currentScene],
          opacity: currentScene === 0 || currentScene === 5 ? 0 : 0.3,
        }}
        transition={{ duration: 1.5, ease: [0.25, 1, 0.5, 1] }}
      />

      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <Scene1 key="open" />}
        {currentScene === 1 && <Scene2 key="lead" />}
        {currentScene === 2 && <Scene3 key="pipeline" />}
        {currentScene === 3 && <Scene4 key="dashboard" />}
        {currentScene === 4 && <Scene5 key="tasks" />}
        {currentScene === 5 && <Scene6 key="close" />}
      </AnimatePresence>
    </div>
  );
}
