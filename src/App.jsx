import { useEffect, useMemo, useRef, useState } from 'react';
import { PoseEngine } from './poseEngine.js';
import { Game } from './gameEngine.js';
import CameraPanel from './CameraPanel.jsx';
import GameScene from './GameScene.jsx';

const HOLD_SECONDS = 1.5; // how long the user must stay centered before calibration
const BEST_KEY = 'body-runner-best';

const GUIDE = {
  'no-body': ['Step into the camera view', 'I can’t see your body yet.'],
  farther: ['Step back', 'I need your whole body in view, from head to feet.'],
  closer: ['Come a little closer', 'You’re too far from the camera.'],
  'move-left': ['Move to your left', 'You’re right of the center line.'],
  'move-right': ['Move to your right', 'You’re left of the center line.'],
  ok: ['Perfect. Hold still', 'Locking in your center position.'],
};

const EMPTY_HUD = {
  score: 0, coins: 0, gap: 1, started: false, running: false, detected: true,
  lane: 0, jumping: false, ducking: false, stumble: false,
};

// Slider 0..1 (more sensitive to the right) -> leg movement needed to count as running.
const ampFromSensitivity = (v) => 0.55 - v * 0.4;

export default function App() {
  const engine = useMemo(() => new PoseEngine(), []);
  const game = useMemo(() => new Game(), []);
  const videoRef = useRef(null);
  const flashRef = useRef(null);
  const phaseRef = useRef('intro');
  const timers = useRef({ okSince: null, lostSince: null, cdStart: 0 });

  const [phase, setPhaseState] = useState('intro');
  const [error, setError] = useState('');
  const [view, setView] = useState({ guide: 'no-body', progress: 0, count: 3, running: false });
  const [hud, setHud] = useState(EMPTY_HUD);
  const [sens, setSens] = useState(0.62);
  const [best, setBest] = useState(() => {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  const bestRef = useRef(best);
  bestRef.current = best;
  const [result, setResult] = useState({ score: 0, reason: '', record: false });

  const setPhase = (p) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  useEffect(() => {
    engine.cfg.runAmp = ampFromSensitivity(sens);
  }, [engine, sens]);

  useEffect(() => () => engine.stop(), [engine]);

  // Phase machine, polled at 10 Hz. Per-frame data stays in refs and never goes through React state.
  useEffect(() => {
    const id = setInterval(() => {
      const s = engine.sig;
      const now = performance.now() / 1000;
      const T = timers.current;
      const ph = phaseRef.current;

      if (ph === 'position') {
        if (s.guide === 'ok') {
          T.okSince ??= now;
          const progress = Math.min(1, (now - T.okSince) / HOLD_SECONDS);
          setView({ guide: s.guide, progress, count: 3, running: s.running });
          if (progress >= 1 && engine.calibrate()) {
            T.cdStart = now;
            T.lostSince = null;
            setPhase('countdown');
          }
        } else {
          T.okSince = null;
          setView({ guide: s.guide, progress: 0, count: 3, running: s.running });
        }
      } else if (ph === 'countdown') {
        if (s.guide !== 'ok') {
          T.lostSince ??= now;
          if (now - T.lostSince > 0.8) {
            T.okSince = null;
            engine.base = null;
            setPhase('position');
            return;
          }
        } else {
          T.lostSince = null;
        }
        const elapsed = now - T.cdStart;
        setView((v) => ({ ...v, guide: s.guide, count: Math.max(1, 3 - Math.floor(elapsed)) }));
        if (elapsed >= 3) {
          game.reset(s.jumpCount);
          setPhase('playing');
        }
      } else if (ph === 'playing') {
        setHud({
          score: game.getScore(),
          coins: game.coins,
          gap: game.gap,
          started: game.started,
          running: s.detected && s.running,
          detected: s.detected,
          lane: s.lane,
          jumping: s.jumping,
          ducking: s.ducking,
          stumble: game.flash > 0 && !game.over,
        });
        if (game.over) {
          const score = game.getScore();
          const record = score > bestRef.current;
          if (record) {
            setBest(score);
            try {
              localStorage.setItem(BEST_KEY, String(score));
            } catch {
              /* storage unavailable */
            }
          }
          setResult({ score, reason: game.overReason, record });
          setPhase('gameover');
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, [engine, game]);

  const startCamera = async () => {
    setError('');
    setPhase('loading');
    try {
      await engine.start(videoRef.current);
      engine.softReset();
      timers.current.okSince = null;
      setPhase('position');
    } catch (e) {
      console.error(e);
      setError(
        e && e.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow the camera for this page, then try again.'
          : 'Couldn’t start the camera or load the pose model. Check your camera and internet connection, then try again.',
      );
      setPhase('intro');
    }
  };

  const playAgain = () => {
    engine.softReset();
    timers.current.okSince = null;
    game.reset(engine.sig.jumpCount);
    setHud(EMPTY_HUD);
    setPhase('position');
  };

  return (
    <div className="app">
      <GameScene game={game} engine={engine} phaseRef={phaseRef} flashRef={flashRef} />
      <div ref={flashRef} className="flash" />
      <CameraPanel engine={engine} videoRef={videoRef} phase={phase} />

      {phase === 'intro' && <Intro onStart={startCamera} error={error} />}

      {phase === 'loading' && (
        <div className="screen screen--center">
          <div className="panel panel--small">
            <div className="spinner" />
            <p>Starting camera and loading the pose model…</p>
          </div>
        </div>
      )}

      {phase === 'position' && <Position view={view} sens={sens} onSens={setSens} />}

      {phase === 'countdown' && (
        <div className="countdown">
          <span key={view.count}>{view.count}</span>
          <p>Get ready to run in place</p>
        </div>
      )}

      {phase === 'playing' && <Hud hud={hud} best={best} />}

      {phase === 'gameover' && (
        <GameOver result={result} best={best} sens={sens} onSens={setSens} onAgain={playAgain} />
      )}
    </div>
  );
}

function Intro({ onStart, error }) {
  return (
    <div className="screen screen--center">
      <div className="panel">
        <h1 className="display">Body Runner</h1>
        <p className="lead">
          Run through the subway with your whole body. Your webcam is the controller.
        </p>
        <ul className="moves">
          <li><b>Run in place</b> to move. Stop, and the guard catches you.</li>
          <li><b>Step left or right</b> to switch lanes around trains.</li>
          <li><b>Jump</b> over low yellow hurdles.</li>
          <li><b>Duck</b> under the red overhead bars.</li>
        </ul>
        {error && <p className="error">{error}</p>}
        <button className="btn" onClick={onStart}>Start camera</button>
        <p className="fine">Video is processed in your browser and is never uploaded.</p>
      </div>
    </div>
  );
}

function Position({ view, sens, onSens }) {
  const [title, sub] = GUIDE[view.guide] || GUIDE['no-body'];
  const ok = view.guide === 'ok';
  return (
    <>
      <div className="screen screen--top">
        <h2 className={`display guide ${ok ? 'guide--ok' : ''}`}>{title}</h2>
        <p className="sub">{sub}</p>
      </div>
      <div className="screen screen--bottom">
        <div className="hold">
          <i style={{ width: `${view.progress * 100}%` }} />
        </div>
        <p className="sub">Stand on the center line with your full body in view.</p>
        <label className="slider">
          <span>Run detection</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={sens}
            onChange={(e) => onSens(Number(e.target.value))}
          />
          <span className={`chip ${view.running ? 'chip--on' : ''}`}>Running</span>
        </label>
        <p className="fine">Try running in place now. If the chip doesn’t light up, slide toward “more sensitive”.</p>
      </div>
    </>
  );
}

function Hud({ hud, best }) {
  let banner = null;
  if (!hud.detected) banner = ['danger', 'I can’t see you. Step back into the frame!'];
  else if (!hud.started) banner = ['info', 'Run in place to start'];
  else if (!hud.running) banner = ['danger', 'Keep running! The guard is closing in'];
  else if (hud.stumble) banner = ['warn', 'Ouch! Dodge the obstacles'];

  return (
    <>
      <div className="hud-top">
        <div className="stat"><span>Score</span><b>{hud.score}</b></div>
        <div className="stat"><span>Coins</span><b>{hud.coins}</b></div>
        <div className="stat"><span>Best</span><b>{best}</b></div>
      </div>

      <div className="guard">
        <span>Guard</span>
        <div className="bar">
          <i className={hud.gap < 0.35 ? 'danger' : ''} style={{ width: `${Math.max(0, hud.gap) * 100}%` }} />
        </div>
      </div>

      {banner && <div className={`banner banner--${banner[0]}`}>{banner[1]}</div>}

      <div className="chips">
        <div className="lane" aria-label="Lane">
          {[-1, 0, 1].map((l) => (
            <i key={l} className={hud.lane === l ? 'on' : ''} />
          ))}
        </div>
        <span className={`chip ${hud.running ? 'chip--on' : ''}`}>Run</span>
        <span className={`chip ${hud.jumping ? 'chip--on' : ''}`}>Jump</span>
        <span className={`chip ${hud.ducking ? 'chip--on' : ''}`}>Duck</span>
      </div>
    </>
  );
}

function GameOver({ result, best, sens, onSens, onAgain }) {
  const msg =
    result.reason === 'stopped'
      ? 'You stopped running and the guard caught you.'
      : 'You hit too many obstacles and the guard caught you.';
  return (
    <div className="screen screen--center">
      <div className="panel">
        <h2 className="display">Busted!</h2>
        <p className="lead">{msg}</p>
        <div className="final">
          <b>{result.score}</b>
          <span>{result.record ? 'New best score' : `Best: ${best}`}</span>
        </div>
        <label className="slider">
          <span>Run detection</span>
          <input type="range" min="0" max="1" step="0.01" value={sens} onChange={(e) => onSens(Number(e.target.value))} />
        </label>
        <button className="btn" onClick={onAgain}>Run again</button>
      </div>
    </div>
  );
}
