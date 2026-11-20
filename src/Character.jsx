import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// Drop-in models. Put rigged GLB files here (inside /public) and they replace the built-in rig.
// ---------------------------------------------------------------------------
export const ASSETS = {
  runner: '/assets/runner.glb',
  guard: '/assets/guard.glb',
  targetHeight: 1.75,      // the model is scaled to this height (world units)
  modelRotationY: Math.PI, // Mixamo-style models face +Z; the player runs toward -Z, so turn them around.
  // Animation clips are matched by name (case-insensitive). Add your own clip names if needed.
  clips: {
    run: /run|sprint|jog/i,
    jump: /jump|hop|leap/i,
    slide: /slide|duck|crouch|roll/i,
    idle: /idle|stand|breath/i,
    fall: /fall|hit|stumble|caught|death|die|knock/i,
  },
};

const PALETTES = {
  runner: { hoodie: '#ff5d73', pants: '#27224a', shoes: '#f4f1ff', skin: '#e8b48f', hat: '#f4f1ff', bag: '#ffd23f' },
  guard: { hoodie: '#2347a8', pants: '#16255a', shoes: '#0f1630', skin: '#d9a17e', hat: '#16255a', bag: '#ffd23f' },
};

const lerp = (a, b, t) => a + (b - a) * t;

// Vite serves index.html for unknown paths, so a missing file looks like a 200 response with HTML.
function useAssetExists(url) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url, { method: 'HEAD' })
      .then((r) => {
        const type = r.headers.get('content-type') || '';
        if (alive) setOk(r.ok && !type.includes('text/html'));
      })
      .catch(() => alive && setOk(false));
    return () => {
      alive = false;
    };
  }, [url]);
  return ok;
}

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.warn('Model failed to load, using the built-in rig instead.', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// kind: 'runner' | 'guard'. getState() returns { run, phase, speed, air, duck, over }.
export default function Character({ kind, getState }) {
  const hasModel = useAssetExists(ASSETS[kind]);
  const fallback = <ProceduralRig kind={kind} getState={getState} />;
  if (!hasModel) return fallback;
  return (
    <Boundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <ModelRig url={ASSETS[kind]} getState={getState} />
      </Suspense>
    </Boundary>
  );
}

// ---------------------------------------------------------------------------
// 1) Skinned GLB with animation clips (run / jump / slide / idle / fall), crossfaded by game state.
// ---------------------------------------------------------------------------
function ModelRig({ url, getState }) {
  const group = useRef();
  const { scene, animations } = useGLTF(url);
  const model = useMemo(() => {
    const m = cloneSkinned(scene);
    m.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false; // skinned meshes can be culled wrongly when animated
    });
    return m;
  }, [scene]);

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? ASSETS.targetHeight / size.y : 1;
    return { scale, y: -box.min.y * scale };
  }, [model]);

  const { actions, names } = useAnimations(animations, group);
  const map = useMemo(() => {
    const find = (re) => names.find((n) => re.test(n));
    return {
      run: find(ASSETS.clips.run),
      jump: find(ASSETS.clips.jump),
      slide: find(ASSETS.clips.slide),
      idle: find(ASSETS.clips.idle) || names[0],
      fall: find(ASSETS.clips.fall),
    };
  }, [names]);

  useEffect(() => {
    console.info('Animation clips found in', url, names, '->', map);
  }, [url, names, map]);

  const current = useRef(null);
  useFrame(() => {
    const s = getState();
    let want = 'idle';
    if (s.over) want = map.fall ? 'fall' : 'idle';
    else if (s.duck > 0.5) want = map.slide ? 'slide' : 'run';
    else if (s.air) want = map.jump ? 'jump' : 'run';
    else if (s.run > 0.2) want = 'run';

    const name = map[want] || map.idle;
    const next = name && actions[name];
    if (!next) return;

    if (current.current !== want) {
      const prev = current.current && actions[map[current.current] || map.idle];
      next.reset();
      if (want === 'jump' || want === 'slide' || want === 'fall') {
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
        // Fit the jump clip to the in-game airtime (~0.65s).
        next.timeScale = want === 'jump' ? Math.max(0.6, next.getClip().duration / 0.65) : 1;
      } else {
        next.setLoop(THREE.LoopRepeat, Infinity);
        next.timeScale = 1;
      }
      next.fadeIn(0.15).play();
      if (prev && prev !== next) prev.fadeOut(0.15);
      current.current = want;
    }
    if (want === 'run') next.timeScale = THREE.MathUtils.clamp(0.7 + s.speed * 0.05, 0.7, 1.7);
  });

  return (
    <group ref={group}>
      <group rotation={[0, ASSETS.modelRotationY, 0]} scale={fit.scale} position={[0, fit.y, 0]}>
        <primitive object={model} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// 2) Built-in jointed rig: hips > spine > head / shoulders > elbows, hips > thighs > shins.
//    Every joint is a real node, animated in code (run cycle, jump tuck, crouch, caught pose).
// ---------------------------------------------------------------------------
function ProceduralRig({ kind, getState }) {
  const J = useRef({}).current;
  const c = PALETTES[kind];
  const guard = kind === 'guard';

  useFrame((state) => {
    const s = getState();
    if (!J.hips) return;
    const { run, phase: p, air, duck, over } = s;

    J.root.position.y = air ? 0 : Math.abs(Math.sin(p)) * 0.05 * run;
    J.hips.position.y = 0.93 - 0.36 * duck;

    for (const sx of [-1, 1]) {
      const side = sx < 0 ? 0 : 1;
      const ph = p + side * Math.PI;
      let thigh = Math.sin(ph) * 0.95 * run;
      let shin = -Math.max(0, Math.cos(ph)) * 1.35 * run - 0.08 * run;
      let arm = -Math.sin(ph) * 0.9 * run;
      let elbow = 0.3 + 0.9 * run;
      if (air) {
        thigh = side ? 1.1 : 0.3;
        shin = side ? -1.5 : -0.6;
        arm = 2.2;
        elbow = 0.5;
      }
      thigh = lerp(thigh, 1.2, duck);
      shin = lerp(shin, -1.6, duck);
      arm = lerp(arm, 1.0, duck);
      if (over) {
        thigh = 0;
        shin = 0;
        arm = guard ? 1.5 : 2.6; // guard grabs, player throws hands up
        elbow = 0.3;
      }
      J['thigh' + sx].rotation.x = thigh;
      J['shin' + sx].rotation.x = shin;
      J['arm' + sx].rotation.x = arm;
      J['elbow' + sx].rotation.x = elbow;
    }

    J.spine.rotation.x = -0.18 * run - 0.45 * duck;
    J.spine.rotation.y = Math.sin(p) * 0.14 * run;
    J.spine.scale.y = 1 + (run < 0.05 ? Math.sin(state.clock.elapsedTime * 2.2) * 0.012 : 0);
    J.head.rotation.x = 0.12 * run + 0.35 * duck;
  });

  const mat = (color) => <meshStandardMaterial color={color} flatShading roughness={0.8} />;

  return (
    <group scale={guard ? 0.98 : 0.88}>
      <group ref={(e) => (J.root = e)}>
        <group ref={(e) => (J.hips = e)} position={[0, 0.93, 0]}>
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[0.38, 0.2, 0.24]} />
            {mat(c.pants)}
          </mesh>

          {[-1, 1].map((sx) => (
            <group key={sx} ref={(e) => (J['thigh' + sx] = e)} position={[sx * 0.12, -0.02, 0]}>
              <mesh position={[0, -0.21, 0]}>
                <capsuleGeometry args={[0.075, 0.3, 4, 8]} />
                {mat(c.pants)}
              </mesh>
              <group ref={(e) => (J['shin' + sx] = e)} position={[0, -0.43, 0]}>
                <mesh position={[0, -0.2, 0]}>
                  <capsuleGeometry args={[0.065, 0.3, 4, 8]} />
                  {mat(c.pants)}
                </mesh>
                <mesh position={[0, -0.43, -0.05]}>
                  <boxGeometry args={[0.14, 0.09, 0.27]} />
                  {mat(c.shoes)}
                </mesh>
              </group>
            </group>
          ))}

          <group ref={(e) => (J.spine = e)} position={[0, 0.1, 0]}>
            <mesh position={[0, 0.3, 0]}>
              <boxGeometry args={[0.5, 0.6, 0.28]} />
              {mat(c.hoodie)}
            </mesh>
            {guard ? (
              <>
                <mesh position={[0, 0.08, 0]}>
                  <boxGeometry args={[0.52, 0.07, 0.3]} />
                  <meshStandardMaterial color="#ffd23f" flatShading />
                </mesh>
                <mesh position={[0, 0.34, 0.0]}>
                  <boxGeometry args={[0.52, 0.05, 0.3]} />
                  <meshStandardMaterial color="#fff2a0" emissive="#fff2a0" emissiveIntensity={0.5} />
                </mesh>
              </>
            ) : (
              <mesh position={[0, 0.32, 0.2]}>
                <boxGeometry args={[0.36, 0.42, 0.16]} />
                {mat(c.bag)}
              </mesh>
            )}

            <group ref={(e) => (J.head = e)} position={[0, 0.62, 0]}>
              <mesh position={[0, 0.17, 0]}>
                <sphereGeometry args={[0.17, 16, 12]} />
                {mat(c.skin)}
              </mesh>
              <mesh position={[0, 0.2, 0.01]}>
                <sphereGeometry args={[0.185, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
                {mat(c.hat)}
              </mesh>
              <mesh position={[0, 0.21, -0.18]}>
                <boxGeometry args={[guard ? 0.34 : 0.26, 0.025, 0.16]} />
                {mat(c.hat)}
              </mesh>
            </group>

            {[-1, 1].map((sx) => (
              <group key={sx} ref={(e) => (J['arm' + sx] = e)} position={[sx * 0.33, 0.55, 0]}>
                <mesh position={[0, -0.15, 0]}>
                  <capsuleGeometry args={[0.06, 0.18, 4, 8]} />
                  {mat(c.hoodie)}
                </mesh>
                <group ref={(e) => (J['elbow' + sx] = e)} position={[0, -0.31, 0]}>
                  <mesh position={[0, -0.13, 0]}>
                    <capsuleGeometry args={[0.052, 0.18, 4, 8]} />
                    {mat(c.hoodie)}
                  </mesh>
                  <mesh position={[0, -0.28, 0]}>
                    <sphereGeometry args={[0.065, 10, 8]} />
                    {mat(c.skin)}
                  </mesh>
                </group>
              </group>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}
