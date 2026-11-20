import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// Pairs of landmark indices drawn as the skeleton overlay.
export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

// All thresholds are relative to the user's torso length or the frame size,
// so they work at different distances from the camera.
export const TUNING = {
  centerTolerance: 0.07, // how far from the frame center (fraction of width) still counts as centered
  jumpRise: 0.17,        // hips/shoulders must rise this many torso-lengths to count as a jump
  jumpLift: 0.05,        // both ankles must also lift this many torso-lengths
  duckDrop: 0.24,        // shoulders/head must drop this many torso-lengths to count as a duck
  stepWindow: 1.2,       // seconds of history used for step counting
  stepDeadband: 0.05,    // leg height difference needed before a step is registered
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

export class PoseEngine {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.raf = 0;
    this.lastVideoTime = -1;
    this.cfg = { runAmp: 0.3 }; // peak-to-peak leg movement (in torso lengths) that counts as running
    this.sig = this.blankSignals();
    this.softReset();
    this.loop = this.loop.bind(this);
  }

  blankSignals() {
    return {
      t: 0,
      detected: false,   // shoulders and hips visible
      guide: 'no-body',  // 'ok' | 'no-body' | 'farther' | 'closer' | 'move-left' | 'move-right'
      centered: false,
      offset: 0,         // horizontal offset from frame center, + = user's right
      cx: 0.5,
      bodyHeight: 0,
      calibrated: false,
      lane: 0,           // -1 left, 0 center, 1 right
      laneDx: 0,
      jumping: false,
      jumpCount: 0,      // increments once per jump (edge-triggered)
      riseMetric: 0,
      ducking: false,
      dropMetric: 0,
      running: false,
      cadence: 0,        // steps per second
      amp: 0,
      landmarks: null,
    };
  }

  // Clears per-session state. Keeps the camera and model loaded.
  softReset() {
    this.base = null;
    this.samples = [];
    this.lane = 0;
    this.ducking = false;
    this.jumpArmed = true;
    this.lastJumpT = -9;
    this.riseS = 0;
    this.dropS = 0;
    this.scx = null;
    this.altBuf = [];
    this.cross = [];
    this.altSign = 0;
    this.lastRunT = -9;
    const s = this.sig;
    s.calibrated = false;
    s.lane = 0;
    s.ducking = false;
    s.jumping = false;
    s.running = false;
  }

  async start(video) {
    this.video = video;
    if (!this.landmarker) {
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const make = (delegate) =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        this.landmarker = await make('GPU');
      } catch {
        this.landmarker = await make('CPU');
      }
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = this.stream;
    await video.play();
    this.lastVideoTime = -1;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
  }

  // Averages the last stable "centered" frames into the standing baseline.
  calibrate() {
    if (this.samples.length < 12) return false;
    const k = (key) => mean(this.samples.map((s) => s[key]));
    this.base = {
      cx: k('cx'), shY: k('shY'), hipY: k('hipY'), noseY: k('noseY'),
      lAnk: k('lAnk'), rAnk: k('rAnk'), torso: k('torso'), shW: k('shW'),
    };
    this.lane = 0;
    this.ducking = false;
    this.jumpArmed = true;
    this.riseS = 0;
    this.dropS = 0;
    this.sig.calibrated = true;
    return true;
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const v = this.video;
    if (!v || v.readyState < 2 || !this.landmarker) return;
    if (v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    let res;
    try {
      res = this.landmarker.detectForVideo(v, performance.now());
    } catch {
      return;
    }
    const lms = res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
    this.process(lms, performance.now() / 1000);
    this.sig.landmarks = lms;
  }

  markLost(s) {
    s.detected = false;
    s.guide = 'no-body';
    s.centered = false;
    s.running = false;
    s.jumping = false;
    s.ducking = false;
    this.ducking = false;
    this.samples.length = 0;
    this.altBuf.length = 0;
    this.cross.length = 0;
    this.altSign = 0;
  }

  process(lms, now) {
    const s = this.sig;
    s.t = now;
    if (!lms) return this.markLost(s);

    const vis = (i) => lms[i].visibility ?? 0;
    const bodyOk = [11, 12, 23, 24].every((i) => vis(i) > 0.5);
    if (!bodyOk) return this.markLost(s);
    const legsOk = [25, 26, 27, 28].every((i) => vis(i) > 0.4 && lms[i].y < 0.99);
    const headOk = vis(0) > 0.5 && lms[0].y > 0.01;
    s.detected = true;

    // x is mirrored (1 - x) so that "user's right" is the larger value, matching the mirrored preview.
    const mx = (i) => 1 - lms[i].x;
    const shX = (mx(11) + mx(12)) / 2;
    const hipX = (mx(23) + mx(24)) / 2;
    const cx = (shX + hipX) / 2;
    this.scx = this.scx == null ? cx : lerp(this.scx, cx, 0.5);

    const shY = (lms[11].y + lms[12].y) / 2;
    const hipY = (lms[23].y + lms[24].y) / 2;
    const noseY = lms[0].y;
    const torso = Math.max(0.05, hipY - shY);
    const shW = Math.abs(lms[11].x - lms[12].x);
    const lAnk = lms[27].y;
    const rAnk = lms[28].y;
    const bodyHeight = legsOk && headOk ? (lAnk + rAnk) / 2 - noseY : 0;

    s.cx = this.scx;
    s.offset = this.scx - 0.5;
    s.bodyHeight = bodyHeight;

    // ---- 1. Is the user standing in a good spot? ----
    const tol = TUNING.centerTolerance;
    let guide = 'ok';
    if (!headOk || !legsOk) guide = 'farther';
    else if (bodyHeight > 0.92) guide = 'farther';
    else if (bodyHeight < 0.45) guide = 'closer';
    else if (s.offset > tol) guide = 'move-left';
    else if (s.offset < -tol) guide = 'move-right';
    s.guide = guide;
    s.centered = Math.abs(s.offset) <= tol;

    if (guide === 'ok') {
      this.samples.push({ cx: this.scx, shY, hipY, noseY, lAnk, rAnk, torso, shW });
      if (this.samples.length > 24) this.samples.shift();
    } else {
      this.samples.length = 0;
    }

    // ---- 2. Lane, jump, duck (need a calibrated standing baseline) ----
    const b = this.base;
    if (b) {
      // Lane: left / center / right with hysteresis so it does not flicker at the boundary.
      const dx = this.scx - b.cx;
      const thr = clamp(b.shW * 0.6, 0.07, 0.16);
      s.laneDx = dx;
      if (this.lane === -1 && dx > -thr * 0.5) this.lane = 0;
      if (this.lane === 1 && dx < thr * 0.5) this.lane = 0;
      if (this.lane === 0) {
        if (dx < -thr) this.lane = -1;
        else if (dx > thr) this.lane = 1;
      }
      s.lane = this.lane;

      // Vertical metrics in torso lengths. rise > 0 = body went up, drop > 0 = body went down.
      const rise = ((b.shY - shY) + (b.hipY - hipY)) / 2 / b.torso;
      const drop = ((shY - b.shY) + (noseY - b.noseY)) / 2 / b.torso;
      this.riseS = lerp(this.riseS, rise, 0.6);
      this.dropS = lerp(this.dropS, drop, 0.6);
      s.riseMetric = this.riseS;
      s.dropMetric = this.dropS;

      // Duck: held while the body stays low.
      if (!this.ducking && this.dropS > TUNING.duckDrop && now - this.lastJumpT > 0.6) {
        this.ducking = true;
      } else if (this.ducking && this.dropS < TUNING.duckDrop * 0.5) {
        this.ducking = false;
      }
      s.ducking = this.ducking;

      // Jump: body rises AND both feet leave the floor. Edge-triggered, then re-armed on landing.
      const lift = legsOk ? Math.min(b.lAnk - lAnk, b.rAnk - rAnk) / b.torso : 1;
      const need = legsOk ? TUNING.jumpRise : TUNING.jumpRise * 1.4;
      if (
        this.jumpArmed && !this.ducking && this.riseS > need &&
        lift > TUNING.jumpLift && now - this.lastJumpT > 0.45
      ) {
        s.jumpCount += 1;
        this.lastJumpT = now;
        this.jumpArmed = false;
      } else if (!this.jumpArmed && this.riseS < need * 0.45) {
        this.jumpArmed = true;
      }
      s.jumping = !this.jumpArmed;
    } else {
      s.lane = 0;
      s.jumping = false;
      s.ducking = false;
    }

    // ---- 3. Running in place: alternating leg heights ----
    if (legsOk) {
      const alt = ((lms[25].y + lms[27].y) - (lms[26].y + lms[28].y)) / 2 / torso;
      const win = TUNING.stepWindow;
      const db = TUNING.stepDeadband;

      this.altBuf.push({ t: now, a: alt });
      while (this.altBuf.length && now - this.altBuf[0].t > win) this.altBuf.shift();

      // A "step" is the leg difference changing sign (left leg up -> right leg up, or back).
      if (alt > db) {
        if (this.altSign === -1) this.cross.push(now);
        this.altSign = 1;
      } else if (alt < -db) {
        if (this.altSign === 1) this.cross.push(now);
        this.altSign = -1;
      }
      while (this.cross.length && now - this.cross[0] > win) this.cross.shift();

      let lo = Infinity;
      let hi = -Infinity;
      for (const p of this.altBuf) {
        if (p.a < lo) lo = p.a;
        if (p.a > hi) hi = p.a;
      }
      const amp = this.altBuf.length ? hi - lo : 0;
      const lastCross = this.cross.length ? this.cross[this.cross.length - 1] : -9;
      const runningRaw = this.cross.length >= 2 && now - lastCross < 0.65 && amp >= this.cfg.runAmp;

      if (runningRaw) this.lastRunT = now;
      // While jumping or ducking both legs move together, so hold the running state briefly.
      const grace = s.jumping || s.ducking ? 1.0 : 0;
      s.running = runningRaw || now - this.lastRunT < grace;
      s.cadence = this.cross.length / win;
      s.amp = amp;
    } else {
      s.running = false;
      s.cadence = 0;
      s.amp = 0;
      this.altBuf.length = 0;
      this.cross.length = 0;
      this.altSign = 0;
    }
  }
}
