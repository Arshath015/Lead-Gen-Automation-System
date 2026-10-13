import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 3200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-10"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative overflow-hidden flex items-center justify-center">
        <motion.div 
          className="absolute inset-0 bg-[#3B82F6] mix-blend-overlay blur-md"
          initial={{ opacity: 0, scale: 0 }}
          animate={phase >= 1 ? { opacity: 0.5, scale: 1.5 } : { opacity: 0, scale: 0 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
        <motion.h1 
          className="text-[8vw] font-bold tracking-tight text-white font-['Space_Grotesk'] z-10"
          initial={{ y: 100, opacity: 0, rotateX: 45 }}
          animate={phase >= 1 ? { y: 0, opacity: 1, rotateX: 0 } : { y: 100, opacity: 0, rotateX: 45 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          Pipeline<span className="text-[#3B82F6]">OS</span>
        </motion.h1>
      </div>
      
      <motion.div
        className="mt-6 text-[2vw] text-slate-300 font-['Inter'] font-medium"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        Your pipeline. Always in motion.
      </motion.div>
    </motion.div>
  );
}
