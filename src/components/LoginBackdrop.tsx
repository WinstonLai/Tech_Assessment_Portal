import { useEffect, useRef } from 'react';

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

// One heartbeat per 200 units, repeated across the width.
const ECG_PATH = Array.from({ length: 6 }, (_, i) => {
  const x = i * 200;
  return `L${x + 70} 60 L${x + 85} 60 L${x + 95} 30 L${x + 110} 100 L${x + 122} 12 L${x + 134} 68 L${x + 146} 60 L${x + 200} 60`;
}).join(' ').replace(/^L/, 'M0 60 L');

type Node = { x: number; y: number; vx: number; vy: number };
type Pulse = { a: number; b: number; t: number };

// Generic data-pipeline backdrop: drifting nodes, faint edges and pulses travelling along them.
// Purely decorative; contains no assessment content.
export default function LoginBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const LINK = 150;
    let w = 0, h = 0, raf = 0;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(18, Math.min(60, Math.round((w * h) / 28000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      }));
      pulses = [];
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        if (!reduced) {
          n.x += n.vx; n.y += n.vy;
          if (n.x < 0 || n.x > w) n.vx *= -1;
          if (n.y < 0 || n.y > h) n.vy *= -1;
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(129, 140, 248, ${(1 - d / LINK) * 0.35})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }
      ctx.fillStyle = 'rgba(165, 180, 252, 0.8)';
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduced) {
        if (pulses.length < 8 && Math.random() < 0.04) {
          const a = Math.floor(Math.random() * nodes.length);
          const near = nodes
            .map((n, b) => ({ b, d: Math.hypot(n.x - nodes[a].x, n.y - nodes[a].y) }))
            .filter((c) => c.b !== a && c.d < LINK);
          if (near.length) pulses.push({ a, b: near[Math.floor(Math.random() * near.length)].b, t: 0 });
        }
        pulses = pulses.filter((p) => p.t < 1);
        for (const p of pulses) {
          p.t += 0.015;
          const x = nodes[p.a].x + (nodes[p.b].x - nodes[p.a].x) * p.t;
          const y = nodes[p.a].y + (nodes[p.b].y - nodes[p.a].y) * p.t;
          const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
          g.addColorStop(0, 'rgba(56, 189, 248, 0.95)');
          g.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.fill();
        }
        raf = requestAnimationFrame(draw);
      }
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden bg-slate-950">
      <div className="login-glow absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
      <div className="login-glow absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-sky-500/20 blur-3xl [animation-delay:-6s]" />
      <div className="login-grid absolute inset-0" />
      <canvas ref={canvasRef} className="absolute inset-0" />

      <svg className="absolute inset-x-0 bottom-[8%] h-28 w-full" viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path d={ECG_PATH} fill="none" stroke="rgba(244, 63, 94, 0.18)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d={ECG_PATH} pathLength={1} className="login-ecg" fill="none" stroke="#fb7185" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>

      {FLOATERS.map((f) => (
        <span key={f.icon} className={`login-float absolute select-none opacity-40 drop-shadow-[0_0_14px_rgba(129,140,248,0.6)] ${f.size}`}
          style={{ left: f.left, top: f.top, animationDuration: `${f.dur}s`, animationDelay: `${f.delay}s` }}>
          <span className={f.beat ? 'login-beat inline-block' : undefined}>{f.icon}</span>
        </span>
      ))}

      {CHIPS.map((c) => (
        <div key={c.unit} className={`login-float absolute hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 backdrop-blur-sm lg:flex ${c.pos}`}
          style={{ animationDuration: '13s', animationDelay: `${c.delay}s` }}>
          <span className={`text-lg ${c.beat ? 'login-beat inline-block' : ''}`}>{c.icon}</span>
          <span className="font-mono text-sm font-semibold text-white/80">{c.value}</span>
          <span className="text-xs text-white/50">{c.unit}</span>
        </div>
      ))}
    </div>
  );
}
