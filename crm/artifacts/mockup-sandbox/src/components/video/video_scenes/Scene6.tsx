import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 4000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B1121] z-50"
      initial={{ opacity: 0, clipPath: 'inset(100% 0 0 0)' }}
      animate={{ opacity: 1, clipPath: 'inset(0% 0 0 0)' }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.0, ease: [0.85, 0, 0.15, 1] }}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={phase >= 1 ? { scale: 1, opacity: 1 } : { scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        className="flex flex-col items-center"
      >
        <motion.div 
          className="w-[10vw] h-[10vw] bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] rounded-3xl mb-8 flex items-center justify-center shadow-[0_0_80px_rgba(59,130,246,0.4)]"
          animate={{ rotate: [0, 90, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
        >
          <div className="w-[4vw] h-[4vw] bg-white rounded-full" />
        </motion.div>

        <h1 className="text-[6vw] font-bold tracking-tight text-white font-['Space_Grotesk']">
          Pipeline<span className="text-[#3B82F6]">OS</span>
        </h1>
        
        <motion.div
          className="mt-6 text-[2vw] text-slate-400 font-['Inter']"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
        >
          Your pipeline. Always in motion.
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
