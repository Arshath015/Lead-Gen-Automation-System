import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const stages = [
  { name: "Prospecting", count: 18, color: "#64748B" },
  { name: "Qualified", count: 12, color: "#3B82F6" },
  { name: "Demo", count: 8, color: "#8B5CF6" },
  { name: "Proposal", count: 6, color: "#F59E0B" },
  { name: "Closed Won", count: 4, color: "#10B981" }
];

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 6000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center pt-[5vh]"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: '-10vh' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.h2 
        className="text-[4vw] font-bold font-['Space_Grotesk'] mb-[8vh] text-white"
        initial={{ opacity: 0, y: 30 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        transition={{ duration: 0.6 }}
      >
        Master the Flow
      </motion.h2>

      <div className="flex gap-6 px-12 w-full max-w-[90vw] overflow-visible">
        {stages.map((stage, i) => (
          <motion.div
            key={i}
            className="flex-1 bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-2xl overflow-hidden flex flex-col"
            initial={{ opacity: 0, y: 50 }}
            animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20, delay: i * 0.15 }}
          >
            <div className="p-4 border-b border-slate-800" style={{ borderTop: `4px solid ${stage.color}` }}>
              <div className="text-[1.2vw] font-semibold text-slate-300">{stage.name}</div>
              <div className="text-[2.5vw] font-bold mt-2 font-['Space_Grotesk']">{stage.count}</div>
            </div>
            <div className="p-4 flex-1 flex flex-col gap-3">
              {/* Dummy skeleton cards */}
              {[...Array(Math.min(stage.count, 3))].map((_, j) => (
                <motion.div 
                  key={j}
                  className="h-[6vh] bg-slate-800 rounded-lg w-full"
                  initial={{ opacity: 0, x: -20 }}
                  animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                  transition={{ duration: 0.4, delay: i * 0.15 + j * 0.1 + 0.3 }}
                />
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
