import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1300),
      setTimeout(() => setPhase(4), 7000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const stats = [
    { label: "Active Leads", value: "48", delay: 1 },
    { label: "Pipeline Value", value: "$2.4M", delay: 2, highlight: true },
    { label: "Conversion Rate", value: "32%", delay: 3 }
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center p-[8vw]"
      initial={{ opacity: 0, clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ opacity: 1, clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="w-full flex justify-between gap-[4vw]">
        {stats.map((stat, i) => (
          <motion.div
            key={i}
            className={`flex-1 flex flex-col justify-center rounded-3xl p-[3vw] ${
              stat.highlight 
                ? 'bg-[#3B82F6]/10 border-2 border-[#3B82F6]/50 shadow-[0_0_50px_rgba(59,130,246,0.2)]' 
                : 'bg-slate-900/60 border border-slate-700/50'
            } backdrop-blur-md`}
            initial={{ opacity: 0, y: 40 }}
            animate={phase >= stat.delay ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          >
            <div className="text-[1.5vw] text-slate-400 font-medium uppercase tracking-widest mb-4">
              {stat.label}
            </div>
            <motion.div 
              className={`text-[6vw] font-bold font-['Space_Grotesk'] leading-none ${
                stat.highlight ? 'text-[#3B82F6]' : 'text-white'
              }`}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={phase >= stat.delay ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
            >
              {stat.value}
            </motion.div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
