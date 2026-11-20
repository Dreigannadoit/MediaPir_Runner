import { useEffect, useRef } from 'react';
import { BONES, TUNING } from './poseEngine.js';

// Mirrored camera preview. The video is flipped with CSS; the skeleton is drawn with x mirrored by hand.
export default function CameraPanel({ engine, videoRef, phase }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = videoRef.current;
      if (!v || !v.videoWidth) return;
      if (canvas.width !== v.videoWidth || canvas.height !== v.videoHeight) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        boxRef.current.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
      }
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const s = engine.sig;
      const ph = phaseRef.current;
      const positioning = ph === 'position' || ph === 'countdown';

      if (positioning) {
        const tol = TUNING.centerTolerance;
        ctx.fillStyle = s.guide === 'ok' ? 'rgba(56, 255, 165, 0.16)' : 'rgba(255, 207, 58, 0.12)';
        ctx.fillRect((0.5 - tol) * W, 0, tol * 2 * W, H);
        ctx.strokeStyle = s.guide === 'ok' ? '#38ffa5' : '#ffcf3a';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(0.5 * W, 0);
        ctx.lineTo(0.5 * W, H);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const lms = s.landmarks;
      if (!lms) return;
      const good = !positioning || s.guide === 'ok';
      const color = good ? '#38ffa5' : '#ff5d73';
      const P = (i) => [(1 - lms[i].x) * W, lms[i].y * H];
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, W / 180);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [a, b] of BONES) {
        if ((lms[a].visibility ?? 0) < 0.4 || (lms[b].visibility ?? 0) < 0.4) continue;
        const [ax, ay] = P(a);
        const [bx, by] = P(b);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.fillStyle = '#fff';
      for (const i of [0, 11, 12, 23, 24, 25, 26, 27, 28]) {
        if ((lms[i].visibility ?? 0) < 0.4) continue;
        const [x, y] = P(i);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3, W / 150), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, videoRef]);

  const mode = phase === 'position' || phase === 'countdown' ? 'big' : phase === 'intro' || phase === 'loading' ? 'hidden' : 'mini';

  return (
    <div ref={boxRef} className={`cam cam--${mode}`}>
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} />
    </div>
  );
}
