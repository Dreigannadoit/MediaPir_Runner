import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Character from './Character.jsx';
import { LANE_SPACING } from './gameEngine.js';

const TRAIN_COLORS = [
  ['#2f80ed', '#1d4f9b', '#7fb6ff'],
  ['#14b8a6', '#0d776c', '#6ee7d8'],
  ['#ef4444', '#9b2323', '#ff9a9a'],
];
const FOG_COLOR = '#f0886f';
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const Mat = ({ color, emissive, ei = 0.6, ...rest }) => (
  <meshStandardMaterial color={color} emissive={emissive || '#000000'} emissiveIntensity={emissive ? ei : 0} flatShading roughness={0.75} {...rest} />
);

export default function GameScene({ game, engine, phaseRef, flashRef }) {
  return (
    <Canvas
      style={{ position: 'absolute', inset: 0 }}
      dpr={[1, 1.75]}
      flat
      camera={{ fov: 60, near: 0.1, far: 400, position: [0, 3.4, 7.2] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <Stage game={game} engine={engine} phaseRef={phaseRef} flashRef={flashRef} />
    </Canvas>
  );
}

function Stage({ game, engine, phaseRef, flashRef }) {
  const { camera } = useThree();
  const player = useRef();
  const guard = useRef();
  const pShadow = useRef();
  const gShadow = useRef();

  const playerState = useMemo(
    () => () => ({
      run: game.runFactor,
      phase: game.runPhase,
      speed: game.speed,
      air: game.y > 0.02,
      duck: game.duck,
      over: game.over,
    }),
    [game],
  );
  const guardState = useMemo(
    () => () => ({
      run: game.over ? 0 : game.started ? Math.max(0.35, game.runFactor) : 0.15,
      phase: game.guardPhase,
      speed: game.speed,
      air: false,
      duck: 0,
      over: game.over,
    }),
    [game],
  );

  // Priority -1: advance the game first, then every other useFrame reads the fresh state.
  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
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

    const px = game.laneX * LANE_SPACING;
    player.current.position.set(px, game.y, 0);
    const gz = 1.7 + game.gap * 2.6;
    const gx = game.guardLane * LANE_SPACING;
    guard.current.position.set(gx, 0, gz);

    const ps = 0.5 - Math.min(0.25, game.y * 0.18);
    pShadow.current.position.x = px;
    pShadow.current.scale.set(ps, ps, 1);
    gShadow.current.position.set(gx, 0.03, gz);

    // Camera follows the lane a little, shakes on impact and widens with speed.
    const k = Math.min(1, dt * 5);
    camera.position.x += (px * 0.55 - camera.position.x) * k;
    camera.position.y = 3.4 + (Math.random() - 0.5) * 0.35 * game.shake;
    camera.position.z = 7.2 + (Math.random() - 0.5) * 0.2 * game.shake;
    camera.fov += (60 + game.runFactor * 7 - camera.fov) * k;
    camera.updateProjectionMatrix();
    camera.lookAt(px * 0.35, 1.2, -9);

    if (flashRef.current) flashRef.current.style.opacity = String(Math.min(0.4, game.flash * 0.5));
  }, -1);

  return (
    <>
      <color attach="background" args={[FOG_COLOR]} />
      <fog attach="fog" args={[FOG_COLOR, 30, 105]} />
      <hemisphereLight args={['#c9b8ff', '#3a2a55', 1.15]} />
      <directionalLight position={[-4, 9, 5]} intensity={2.1} color="#ffd9b0" />

      <Sky />
      <Track game={game} />
      <Buildings game={game} />
      <Obstacles game={game} />

      <mesh ref={pShadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh ref={gShadow} rotation={[-Math.PI / 2, 0, 0]} scale={0.6}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} depthWrite={false} />
      </mesh>

      <group ref={player}>
        <Character kind="runner" getState={playerState} />
      </group>
      <group ref={guard}>
        <Character kind="guard" getState={guardState} />
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------
function Sky() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#120d33');
    grad.addColorStop(0.35, '#3a2268');
    grad.addColorStop(0.62, '#b0507f');
    grad.addColorStop(0.72, '#ff9a6a');
    grad.addColorStop(1, '#ff9a6a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 256);
    const glow = g.createRadialGradient(635, 164, 6, 635, 164, 120);
    glow.addColorStop(0, 'rgba(255,240,190,1)');
    glow.addColorStop(0.25, 'rgba(255,214,140,0.85)');
    glow.addColorStop(1, 'rgba(255,170,110,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 1024, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return (
    <mesh position={[0, 40, -150]}>
      <planeGeometry args={[700, 175]} />
      <meshBasicMaterial map={tex} fog={false} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function Track({ game }) {
  const sleepers = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const N = 40;

  // Sleepers scroll with distance, so the track only moves while the player runs.
  useFrame(() => {
    const off = game.dist % 3;
    for (let i = 0; i < N; i++) {
      dummy.position.set(0, 0.03, -(i * 3) + off + 4);
      dummy.updateMatrix();
      sleepers.current.setMatrixAt(i, dummy.matrix);
    }
    sleepers.current.instanceMatrix.needsUpdate = true;
  });

  const railXs = [];
  for (const lane of [-1, 0, 1]) for (const o of [-0.45, 0.45]) railXs.push(lane * LANE_SPACING + o);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -100]}>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color="#2b2145" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -100]}>
        <planeGeometry args={[7.4, 300]} />
        <meshStandardMaterial color="#4b4268" />
      </mesh>
      {[-1.1, 1.1].map((x) => (
        <mesh key={x} position={[x, 0.012, -100]}>
          <boxGeometry args={[0.05, 0.01, 300]} />
          <meshBasicMaterial color="#7b72a3" />
        </mesh>
      ))}
      {[-3.85, 3.85].map((x) => (
        <mesh key={x} position={[x, 0.22, -100]}>
          <boxGeometry args={[0.5, 0.45, 300]} />
          <meshStandardMaterial color="#7a6fa0" />
        </mesh>
      ))}
      {railXs.map((x) => (
        <mesh key={x} position={[x, 0.08, -100]}>
          <boxGeometry args={[0.1, 0.12, 300]} />
          <meshStandardMaterial color="#cfc8ee" roughness={0.5} metalness={0.2} />
        </mesh>
      ))}
      <instancedMesh ref={sleepers} args={[null, null, N]} frustumCulled={false}>
        <boxGeometry args={[7.2, 0.08, 0.35]} />
        <meshStandardMaterial color="#5a4a72" />
      </instancedMesh>
    </group>
  );
}

// Window textures: one for color, one emissive so the windows glow at dusk.
function makeWindowTextures() {
  const build = (lit, wall, dark) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = wall;
    g.fillRect(0, 0, 64, 128);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        g.fillStyle = hash(row * 7 + col * 3 + 1) > 0.5 ? lit : dark;
        g.fillRect(col * 16 + 3, row * 16 + 4, 10, 9);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    return t;
  };
  return { map: build('#ffd98a', '#2b2347', '#161030'), glow: build('#ffffff', '#000000', '#000000') };
}

function Buildings({ game }) {
  const N = 9;
  const period = 18;
  const total = N * period;
  const refs = useRef([]);
  const base = useMemo(() => makeWindowTextures(), []);

  const items = useMemo(() => {
    const variant = (t, rx, ry) => {
      const v = t.clone();
      v.needsUpdate = true;
      v.repeat.set(rx, ry);
      return v;
    };
    return Array.from({ length: N * 2 }, (_, i) => {
      const h = 6 + hash(i) * 11;
      const w = 5 + hash(i + 40) * 4;
      const depth = 13 + hash(i + 80) * 3;
      const rx = Math.max(1, Math.round(depth / 1.4)) / 4;
      const ry = Math.max(1, Math.round(h / 1.6)) / 8;
      return {
        k: i >> 1,
        side: i % 2 ? 1 : -1,
        h,
        w,
        depth,
        map: variant(base.map, rx, ry),
        glow: variant(base.glow, rx, ry),
      };
    });
  }, [base]);

  useFrame(() => {
    items.forEach((b, i) => {
      const g = refs.current[i];
      if (!g) return;
      const zr = (((b.k * period - game.dist) % total) + total) % total;
      g.position.z = -(zr - 8);
    });
  });

  return (
    <>
      {items.map((b, i) => (
        <group
          key={i}
          ref={(e) => (refs.current[i] = e)}
          position={[b.side * (3.9 + b.w / 2 + 0.2), b.h / 2, 0]}
        >
          <mesh>
            <boxGeometry args={[b.w, b.h, b.depth]} />
            <meshStandardMaterial map={b.map} emissiveMap={b.glow} emissive="#ffd98a" emissiveIntensity={1.2} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Obstacles and coins (the scene only creates meshes when the game's obstacle list changes)
// ---------------------------------------------------------------------------------------------
function Obstacles({ game }) {
  const [list, setList] = useState(() => game.objs.slice());
  const seen = useRef(-1);
  useFrame(() => {
    if (seen.current !== game.version) {
      seen.current = game.version;
      setList(game.objs.slice());
    }
  });
  useEffect(() => {
    seen.current = -1;
  }, [game]);
  return (
    <>
      {list.map((o) => (
        <Obstacle key={o.id} o={o} game={game} />
      ))}
    </>
  );
}

function Obstacle({ o, game }) {
  const ref = useRef();
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.position.z = -(o.z - game.dist);
    g.visible = o.type === 'coin' ? !o.got : !o.hit;
    if (o.type === 'coin') g.rotation.y = game.time * 4 + o.z;
  });

  return (
    <group ref={ref} position={[o.lane * LANE_SPACING, 0, -(o.z - game.dist)]}>
      {o.type === 'low' && <Hurdle />}
      {o.type === 'high' && <OverheadBar />}
      {o.type === 'block' && <Train d={o.d} palette={TRAIN_COLORS[o.tone]} />}
      {o.type === 'coin' && (
        <mesh position={[0, 0.95, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.27, 0.27, 0.07, 18]} />
          <Mat color="#ffd23f" emissive="#ff9f1c" ei={0.7} />
        </mesh>
      )}
    </group>
  );
}

function Hurdle() {
  return (
    <group position={[0, 0, -0.45]}>
      <mesh position={[0, 0.44, 0]}>
        <boxGeometry args={[1.9, 0.22, 0.35]} />
        <Mat color="#ffcf3a" />
      </mesh>
      {[-0.75, -0.25, 0.25, 0.75].map((x) => (
        <mesh key={x} position={[x, 0.44, 0]}>
          <boxGeometry args={[0.18, 0.24, 0.37]} />
          <Mat color="#2a2238" />
        </mesh>
      ))}
      {[-0.82, 0.82].map((x) => (
        <mesh key={x} position={[x, 0.17, 0]}>
          <boxGeometry args={[0.14, 0.34, 0.3]} />
          <Mat color="#4a4262" />
        </mesh>
      ))}
    </group>
  );
}

function OverheadBar() {
  return (
    <group position={[0, 0, -0.25]}>
      {[-0.95, 0.95].map((x) => (
        <mesh key={x} position={[x, 0.62, 0]}>
          <boxGeometry args={[0.14, 1.25, 0.14]} />
          <Mat color="#9a93b8" />
        </mesh>
      ))}
      <mesh position={[0, 1.275, 0]}>
        <boxGeometry args={[2.1, 0.55, 0.4]} />
        <Mat color="#ff4d6d" />
      </mesh>
      {[-0.8, -0.27, 0.27, 0.8].map((x) => (
        <mesh key={x} position={[x, 1.275, 0]}>
          <boxGeometry args={[0.2, 0.57, 0.42]} />
          <Mat color="#fff4f6" />
        </mesh>
      ))}
    </group>
  );
}

function Train({ d, palette }) {
  const [body, trim, roof] = palette;
  const windows = Math.max(1, Math.floor((d - 1.2) / 1.6));
  return (
    <group position={[0, 0, -d / 2]}>
      <mesh position={[0, 1.275, 0]}>
        <boxGeometry args={[1.9, 2.25, d]} />
        <Mat color={body} />
      </mesh>
      <mesh position={[0, 2.43, 0]}>
        <boxGeometry args={[1.7, 0.12, d]} />
        <Mat color={roof} />
      </mesh>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[1.95, 0.3, d - 0.4]} />
        <Mat color="#1b1630" />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <boxGeometry args={[1.93, 0.18, d + 0.01]} />
        <Mat color={trim} />
      </mesh>
      {Array.from({ length: windows }, (_, i) => (
        <mesh key={i} position={[0, 1.8, d / 2 - 1.1 - i * 1.6]}>
          <boxGeometry args={[1.94, 0.45, 0.9]} />
          <Mat color="#1a1433" emissive="#ffd98a" ei={0.35} />
        </mesh>
      ))}
      {/* front face (toward the player) */}
      <mesh position={[0, 1.75, d / 2 + 0.01]}>
        <boxGeometry args={[1.5, 0.7, 0.05]} />
        <Mat color="#1a1433" />
      </mesh>
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.65, d / 2 + 0.03]}>
          <sphereGeometry args={[0.1, 10, 8]} />
          <Mat color="#fff3b0" emissive="#fff3b0" ei={1.2} />
        </mesh>
      ))}
    </group>
  );
}
