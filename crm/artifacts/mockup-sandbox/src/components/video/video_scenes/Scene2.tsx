import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Flame, Building2, Linkedin, Briefcase } from 'lucide-react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 2600),
      setTimeout(() => setPhase(5), 5500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center p-[10vw]"
      initial={{ opacity: 0, x: '20vw' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '-20vw', filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div 
        className="relative w-full max-w-[50vw] bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-10 shadow-2xl shadow-black/50"
        initial={{ scale: 0.9 }}
        animate={phase >= 1 ? { scale: 1 } : { scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-6">
            <motion.div 
              className="w-[8vw] h-[8vw] rounded-full overflow-hidden border-2 border-slate-600 bg-slate-800"
              initial={{ scale: 0, rotate: -45 }}
              animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -45 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
            >
              <img src={`${import.meta.env.BASE_URL}images/sarah.jpg`} alt="Sarah Chen" className="w-full h-full object-cover" />
            </motion.div>
            <div>
              <motion.h2 
                className="text-[3vw] font-bold font-['Space_Grotesk'] leading-tight"
                initial={{ opacity: 0, x: -20 }}
                animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                transition={{ duration: 0.5 }}
              >
                Sarah Chen
              </motion.h2>
              <motion.div 
                className="flex items-center gap-3 text-[1.2vw] text-slate-400 mt-2"
                initial={{ opacity: 0 }}
                animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                <Briefcase className="w-[1.2vw] h-[1.2vw]" />
                VP of Engineering @ Acme Corp
              </motion.div>
            </div>
          </div>
          
          <motion.div 
            className="flex items-center gap-2 bg-amber-500/20 text-amber-500 px-4 py-2 rounded-full font-bold text-[1.2vw]"
            initial={{ scale: 0, opacity: 0 }}
            animate={phase >= 3 ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            <Flame className="w-[1.5vw] h-[1.5vw]" />
            HOT
          </motion.div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-4">
          <motion.div 
            className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50"
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.4 }}
          >
            <div className="text-[1vw] text-slate-400 uppercase tracking-wider mb-2">Status</div>
            <div className="text-[1.5vw] font-semibold text-[#3B82F6]">Qualified</div>
          </motion.div>
          <motion.div 
            className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50"
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div className="text-[1vw] text-slate-400 uppercase tracking-wider mb-2">Tags</div>
            <div className="flex gap-2 text-[1vw]">
              <span className="bg-slate-700 px-3 py-1 rounded-full text-white">Enterprise</span>
              <span className="bg-[#3B82F6]/20 text-[#3B82F6] px-3 py-1 rounded-full">Demo Req</span>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}
