// Wellness-tracker motifs: faint floating icons plus glass "stat" chips shown on wide screens.
const FLOATERS = [
  { icon: '👟', left: '8%', top: '72%', size: 'text-4xl', dur: 16, delay: 0 },
  { icon: '😴', left: '16%', top: '14%', size: 'text-5xl', dur: 19, delay: -4 },
  { icon: '❤️', left: '82%', top: '16%', size: 'text-4xl', dur: 14, delay: -7, beat: true },
  { icon: '💧', left: '90%', top: '58%', size: 'text-3xl', dur: 17, delay: -2 },
  { icon: '🏃', left: '74%', top: '80%', size: 'text-4xl', dur: 21, delay: -9 },
  { icon: '⌚', left: '4%', top: '44%', size: 'text-3xl', dur: 18, delay: -11 },
  { icon: '🔥', left: '58%', top: '8%', size: 'text-2xl', dur: 15, delay: -5 },
  { icon: '🥗', left: '34%', top: '86%', size: 'text-3xl', dur: 20, delay: -13 },
];

const CHIPS = [
  { icon: '❤️', value: '72', unit: 'bpm', pos: 'left-[6%] top-[26%]', delay: -2, beat: true },
  { icon: '👟', value: '8,432', unit: 'steps', pos: 'left-[9%] top-[62%]', delay: -8 },
  { icon: '😴', value: '7h 20m', unit: 'sleep', pos: 'right-[7%] top-[30%]', delay: -5 },
  { icon: '🔥', value: '2,140', unit: 'kcal', pos: 'right-[9%] top-[66%]', delay: -11 },
];

// Two sine periods (1200 units each); the SVG is 200% wide and slides by -50%, so the loop is seamless.
const WAVE_PATH = 'M0 100 Q300 0 600 100 T1200 100 T1800 100 T2400 100 V200 H0 Z';

const WAVES = [
  { fill: 'rgba(255,255,255,0.16)', height: 'h-[46%]', dur: 22, delay: 0, reverse: true },
  { fill: 'rgba(255,255,255,0.20)', height: 'h-[36%]', dur: 16, delay: -5, reverse: false },
  { fill: 'rgba(255,255,255,0.26)', height: 'h-[26%]', dur: 11, delay: -3, reverse: true },
];

// Decorative backdrop: a slow colour-shifting gradient with translucent waves rolling along the bottom,
// plus floating wellness-tracker icons. Contains no assessment content.
export default function LoginBackdrop() {
  return (
    <div aria-hidden="true" className="login-gradient pointer-events-none fixed inset-0 overflow-hidden">
      {WAVES.map((w, i) => (
        <div key={i} className={`absolute inset-x-0 bottom-0 overflow-hidden ${w.height}`}>
          <svg viewBox="0 0 2400 200" preserveAspectRatio="none"
            className="login-wave h-full w-[200%]"
            style={{ animationDuration: `${w.dur}s`, animationDelay: `${w.delay}s`, animationDirection: w.reverse ? 'reverse' : 'normal' }}>
            <path d={WAVE_PATH} fill={w.fill} />
          </svg>
        </div>
      ))}

      {FLOATERS.map((f) => (
        <span key={f.icon} className={`login-float absolute select-none opacity-70 drop-shadow-[0_2px_10px_rgba(255,255,255,0.45)] ${f.size}`}
          style={{ left: f.left, top: f.top, animationDuration: `${f.dur}s`, animationDelay: `${f.delay}s` }}>
          <span className={f.beat ? 'login-beat inline-block' : undefined}>{f.icon}</span>
        </span>
      ))}

      {CHIPS.map((c) => (
        <div key={c.unit} className={`login-float absolute hidden items-center gap-2 rounded-full border border-white/40 bg-white/20 px-3.5 py-2 backdrop-blur-sm lg:flex ${c.pos}`}
          style={{ animationDuration: '13s', animationDelay: `${c.delay}s` }}>
          <span className={`text-lg ${c.beat ? 'login-beat inline-block' : ''}`}>{c.icon}</span>
          <span className="font-mono text-sm font-semibold text-white">{c.value}</span>
          <span className="text-xs text-white/80">{c.unit}</span>
        </div>
      ))}
    </div>
  );
}
