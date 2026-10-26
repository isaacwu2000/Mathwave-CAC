'use client';
import { useEffect, useRef } from 'react';
import './pico-confetti.css';

/** Draws a bounded, silent burst from the visible Pico; cleanup never changes focus or saved work. */
export function PicoConfetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const origin = document.querySelector('.pico')?.getBoundingClientRect();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    if (!canvas || !origin || reduced.matches || document.hidden) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = innerWidth,
      height = innerHeight,
      ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);
    const startX = origin.x + origin.width / 2,
      startY = origin.y + origin.height / 2;
    const colors = ['#d32419', '#f5bc98', '#b27049', '#e6b44e', '#49382f'];
    const count = width < 600 ? 60 : 96;
    const particles = Array.from({ length: count }, (_, i) => ({
      vx: -(100 + (((i * 37) % 101) / 100) * width * 0.75),
      vy: -(90 + ((i * 53) % 240)),
      delay: (i % 7) * 0.018,
      size: 4 + (i % 5),
      spin: (i % 2 ? 1 : -1) * (2 + (i % 4)),
      color: colors[i % colors.length],
      round: i % 4 === 0,
    }));
    let frame = 0,
      started = 0,
      stopped = false;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
    };
    const hide = () => {
      if (document.hidden) stop();
    };
    const draw = (now: number) => {
      if (stopped) return;
      if (!started) started = now;
      const elapsed = (now - started) / 1000;
      context.clearRect(0, 0, width, height);
      if (elapsed >= 2.1) return;
      for (const particle of particles) {
        const t = elapsed - particle.delay;
        if (t < 0) continue;
        const x = startX + particle.vx * t,
          y = startY + particle.vy * t + 420 * t * t;
        if (y > height + 20 || x < -20) continue;
        context.save();
        context.globalAlpha = Math.min(1, (2.1 - elapsed) / 0.45);
        context.fillStyle = particle.color;
        context.translate(x, y);
        context.rotate(particle.spin * t);
        if (particle.round) {
          context.beginPath();
          context.arc(0, 0, particle.size / 2, 0, Math.PI * 2);
          context.fill();
        } else
          context.fillRect(
            -particle.size / 2,
            -particle.size / 2,
            particle.size,
            particle.size * 0.55,
          );
        context.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('resize', stop, { once: true });
    reduced.addEventListener('change', stop);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('resize', stop);
      reduced.removeEventListener('change', stop);
    };
  }, []);
  return (
    <canvas ref={canvasRef} className="pico-confetti" aria-hidden="true" />
  );
}
