import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Bell, Calendar } from 'lucide-react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0, x: '10vw' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '-10vw' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative">
        <motion.div 
          className="absolute -top-[5vh] -right-[5vw] z-20"
          initial={{ opacity: 0, scale: 0, rotate: -30 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, rotate: [0, 15, -15, 10, -10, 0] } : { opacity: 0, scale: 0, rotate: -30 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <div className="relative bg-slate-800 p-[1.5vw] rounded-full border border-slate-600 shadow-2xl">
            <Bell className="w-[3vw] h-[3vw] text-amber-500" />
            <div className="absolute top-0 right-0 w-[1.5vw] h-[1.5vw] bg-red-500 rounded-full border-2 border-slate-800 animate-pulse" />
          </div>
        </motion.div>

        <motion.div 
          className="bg-slate-900 border border-slate-700 rounded-2xl p-[3vw] w-[45vw] shadow-2xl relative z-10"
          initial={{ opacity: 0, y: 50 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div className="flex items-center gap-6 mb-6">
            <motion.div 
              className="w-[5vw] h-[5vw] rounded-full overflow-hidden border border-slate-600 bg-slate-800"
              initial={{ scale: 0 }}
              animate={phase >= 2 ? { scale: 1 } : { scale: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <img src={`${import.meta.env.BASE_URL}images/marcus.png`} alt="Marcus" className="w-full h-full object-cover" />
            </motion.div>
            <div>
              <div className="text-[2vw] font-bold font-['Space_Grotesk'] text-white">Marcus Williams</div>
              <div className="text-[1.2vw] text-slate-400">CTO @ Bloom Ventures</div>
            </div>
          </div>
          
          <motion.div 
            className="bg-slate-800/50 p-6 rounded-xl border border-slate-700"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="flex items-center gap-3 text-amber-500 font-medium text-[1.2vw] mb-3">
              <Calendar className="w-[1.5vw] h-[1.5vw]" />
              Due Tomorrow
            </div>
            <div className="text-[1.8vw] text-slate-200">Follow up on proposal</div>
          </motion.div>
        </motion.div>

        {/* Popover */}
        <motion.div
          className="absolute -top-[12vh] -right-[15vw] bg-white text-black p-4 rounded-xl shadow-xl whitespace-nowrap z-30 flex items-center gap-3"
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25, delay: 0.6 }}
        >
          <div className="w-[1vw] h-[1vw] bg-amber-500 rounded-full" />
          <span className="font-semibold text-[1.2vw]">Sarah Chen's follow-up due in 1 hour</span>
        </motion.div>
      </div>
    </motion.div>
  );
}
