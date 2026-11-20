// Game state and rules for the 3-lane subway runner. Rendering lives in GameScene.jsx.
// World units: x = lanes (LANE_SPACING apart), y = height, z = distance ahead of the player.

export const LANE_SPACING = 2.2;
export const Z_VIEW = 90;
const GRAVITY = 28;
const JUMP_V = 8.5;
const STAND_H = 1.7;
const DUCK_H = 0.8;

// Vertical extent [bottom, top] of each obstacle type, used for collisions.
const RANGE = {
  low: [0, 0.55],    // hurdle: jump over it
  high: [1.0, 1.6],  // overhead bar: duck under it
  block: [0, 2.4],   // train: change lane
};

const rand = (a, b) => a + Math.random() * (b - a);

export class Game {
  constructor() {
    this.nextId = 0;
    this.version = 0; // bumps whenever the obstacle list changes so the scene can re-render it
    this.reset(0);
  }

  add(o) {
    o.id = this.nextId++;
    this.objs.push(o);
    this.version++;
  }

  reset(jumpSeen = 0) {
    this.time = 0;
    this.playTime = 0;
    this.dist = 0;
    this.speed = 0;
    this.runFactor = 0;
    this.coins = 0;
    this.laneX = 0;
    this.guardLane = 0;
    this.y = 0;
    this.vy = 0;
    this.duck = 0;
    this.objs = [];
    this.version++;
    this.nextRow = 45;
    this.gap = 1; // 1 = guard far behind, 0 = guard has caught you
    this.invuln = 0;
    this.flash = 0;
    this.shake = 0;
    this.started = false;
    this.over = false;
    this.overReason = '';
    this.stalled = 0;
    this.jumpSeen = jumpSeen;
    this.runPhase = 0;
    this.guardPhase = 0;
  }

  getScore() {
    return Math.floor(this.dist + this.coins * 10);
  }

  // Called when the game is not in the "playing" phase so the scene still animates a little.
  idleUpdate(dt) {
    this.time += dt;
    this.guardPhase += dt * 2;
    this.shake = Math.max(0, this.shake - dt * 2);
    this.flash = Math.max(0, this.flash - dt);
  }

  // input: { running, lane, jumpCount, ducking }
  update(dt, input) {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.invuln = Math.max(0, this.invuln - dt);

    if (this.over) {
      this.runFactor = 0;
      this.speed = 0;
      return;
    }

    // Jump (edge triggered by the pose engine, physics handled here).
    if (input.jumpCount > this.jumpSeen) {
      this.jumpSeen = input.jumpCount;
      if (this.y <= 0.001) this.vy = JUMP_V;
    }
    if (this.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
    }

    // Lane and duck follow the player's body.
    this.laneX += (input.lane - this.laneX) * Math.min(1, dt * 11);
    const ducking = input.ducking && this.y <= 0.001;
    this.duck += ((ducking ? 1 : 0) - this.duck) * Math.min(1, dt * 16);

    // The character only runs while the player runs.
    if (input.running) this.started = true;
    const target = input.running && this.started ? 1 : 0;
    this.runFactor += (target - this.runFactor) * Math.min(1, dt * (target ? 4 : 3.2));
    if (this.started) this.playTime += dt;
    this.speed = this.runFactor * (11 + Math.min(9, this.playTime * 0.1));

    const step = this.speed * dt;
    this.dist += step;
    this.runPhase += dt * (5 + this.speed * 0.5) * this.runFactor;
    this.guardPhase += dt * (4 + this.speed * 0.5);

    // Guard: closes in while the player is stopped, drops back while the player runs.
    if (this.started) {
      if (input.running) {
        this.gap = Math.min(1, this.gap + dt * 0.22);
        this.stalled = 0;
      } else {
        this.gap -= dt * 0.4;
        this.stalled += dt;
      }
    }
    this.guardLane += (this.laneX - this.guardLane) * Math.min(1, dt * 3);

    // Spawn obstacles ahead of the player.
    while (this.nextRow < this.dist + Z_VIEW) {
      this.spawnRow(this.nextRow);
      this.nextRow += rand(20, 30) + this.speed * 0.7;
    }

    this.collide();
    const alive = this.objs.filter((o) => o.z + o.d - this.dist > -4);
    if (alive.length !== this.objs.length) {
      this.objs = alive;
      this.version++;
    }

    if (this.gap <= 0) {
      this.gap = 0;
      this.over = true;
      this.overReason = this.stalled > 0.3 ? 'stopped' : 'crashed';
      this.shake = 1;
      this.flash = 0.6;
    }
  }

  spawnRow(z) {
    const lanes = [-1, 0, 1];
    const pick = (n) => lanes.slice().sort(() => Math.random() - 0.5).slice(0, n);
    const used = new Set();
    const r = Math.random();

    if (r < 0.28) {
      pick(1 + Math.floor(Math.random() * 3)).forEach((lane) => {
        this.add({ type: 'low', lane, z, d: 0.9 });
        used.add(lane);
      });
    } else if (r < 0.52) {
      pick(1 + Math.floor(Math.random() * 3)).forEach((lane) => {
        this.add({ type: 'high', lane, z, d: 0.5 });
        used.add(lane);
      });
    } else if (r < 0.8) {
      const len = rand(6, 11);
      const tone = Math.floor(Math.random() * 3);
      pick(1 + Math.floor(Math.random() * 2)).forEach((lane) => {
        this.add({ type: 'block', lane, z, d: len, tone });
        used.add(lane);
      });
    }

    const free = lanes.filter((l) => !used.has(l));
    if (free.length && Math.random() < 0.8) {
      const lane = free[Math.floor(Math.random() * free.length)];
      for (let i = 0; i < 6; i++) this.add({ type: 'coin', lane, z: z + 4 + i * 1.6, d: 0 });
    }
  }

  collide() {
    const bottom = this.y;
    const top = this.y + (this.duck > 0.5 ? DUCK_H : STAND_H);
    for (const o of this.objs) {
      const zr = o.z - this.dist;
      if (o.type === 'coin') {
        if (!o.got && Math.abs(zr) < 0.7 && Math.abs(this.laneX - o.lane) < 0.55 && bottom <= 1.2 && top >= 0.6) {
          o.got = true;
          this.coins += 1;
        }
        continue;
      }
      if (o.hit) continue;
      if (Math.abs(this.laneX - o.lane) > 0.62) continue;
      if (zr > 0.35 || zr + o.d < -0.35) continue;
      const [y0, y1] = RANGE[o.type];
      if (bottom < y1 && top > y0) {
        o.hit = true;
        if (this.invuln <= 0) {
          this.gap -= 0.34;
          this.runFactor *= 0.35;
          this.flash = 0.5;
          this.shake = 0.7;
          this.invuln = 0.9;
        }
      }
    }
  }
}
