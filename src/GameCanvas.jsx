import { useEffect, useRef } from 'react';

// Runs the render loop. Game logic only advances while the phase is "playing"; the pose signals are read
// straight from the engine each frame so React never re-renders at video frame rate.
export default function GameCanvas({ game, engine, phaseRef }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = engine.sig;
      if (phaseRef.current === 'playing') {
        game.update(dt, {
          running: s.detected && s.running,
          lane: s.lane,
          jumpCount: s.jumpCount,
          ducking: s.ducking,
        });
      } else {
        game.idleUpdate(dt);
      }
      game.render(ctx, window.innerWidth, window.innerHeight);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [game, engine, phaseRef]);

  return <canvas ref={ref} className="game" />;
}
