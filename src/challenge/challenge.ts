// Challenge mode: the same islands, with something at stake. The bird has a few lights (lives);
// shadow spirits hunt it, and every half minute or so something happens: a lightning storm, a
// ring rush, a golden spirit to chase, a shower of falling stars, a swarm. Everything scores,
// chained actions build a combo multiplier, and danger rises with time until the light goes out.
//
// This file is the rules and the director; shadows.ts, storm.ts, rings.ts, spirit.ts and
// starfall.ts are the pieces. Event randomness is gameplay, not world content: Math.random.
import { Group, type PerspectiveCamera, Vector3 } from 'three';
import type { CollectEvent } from '../collectibles';
import type { Flight } from '../flight';
import { tuning } from '../tuning';
import type { ChallengeHud } from '../ui/challengeHud';
import { type StringKey, t } from '../ui/i18n';
import { type SaveData, writeSave } from '../ui/save';
import { Rings } from './rings';
import type { ChallengeSfx } from './sfx';
import { Shadows } from './shadows';
import { Spirit } from './spirit';
import { Starfall } from './starfall';
import { Storm } from './storm';

type EventKind = 'storm' | 'rings' | 'spirit' | 'stars' | 'swarm';
const EVENTS: EventKind[] = ['storm', 'rings', 'spirit', 'stars', 'swarm'];
const FIRST_EVENTS: EventKind[] = ['rings', 'spirit', 'stars'];
const TITLES: Record<EventKind, [StringKey, StringKey]> = {
  storm: ['evStorm', 'evStormSub'],
  rings: ['evRings', 'evRingsSub'],
  spirit: ['evSpirit', 'evSpiritSub'],
  stars: ['evStars', 'evStarsSub'],
  swarm: ['evSwarm', 'evSwarmSub'],
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export interface ChallengeSummary {
  score: number;
  best: number;
  newBest: boolean;
  time: number;
  purified: number;
  events: number;
  danger: number;
}

/** What the challenge needs to know about the bird each frame. */
export interface ChallengeFrame {
  prev: Vector3;
  pos: Vector3;
  vel: Vector3;
  forward: Vector3;
  speed: number;
  boost: number;
  skim: number;
  camera: PerspectiveCamera;
}

export interface ChallengeHooks {
  /** Golden sparks at a point. */
  burst: (at: Vector3, count: number, speed: number) => void;
  /** The run is over. */
  gameOver: (summary: ChallengeSummary) => void;
}

export class Challenge {
  readonly group = new Group();
  readonly storm = new Storm();
  private readonly shadows = new Shadows();
  private readonly rings = new Rings();
  private readonly spirit = new Spirit();
  private readonly stars = new Starfall();

  /** A run is in progress (it keeps running for a moment after the last light goes out). */
  running = false;
  lives = 3;
  score = 0;
  private combo = 0;
  private comboTimer = 0;
  private invuln = 0;
  private dying = 0;
  private time = 0;
  danger = 1;
  private purified = 0;
  private eventsWon = 0;
  private skimTime = 0;
  private spawnTimer = 0;
  private shadowAnnounced = false;
  private event: EventKind | null = null;
  private lastEvent: EventKind | null = null;
  private eventTime = 0;
  private eventDuration = 0;
  private nextEventAt = 0;
  private swarmPurified = 0;
  private nearestShadow = Infinity;
  private kickAmount = 0;
  private idle = 0;
  private queued: EventKind | null = null;
  private readonly p = new Vector3();
  private readonly d = new Vector3();

  constructor(
    private readonly flight: Flight,
    private readonly hud: ChallengeHud,
    private readonly sfx: ChallengeSfx,
    private readonly ground: (x: number, z: number) => number,
    private readonly save: SaveData,
    private readonly hooks: ChallengeHooks,
  ) {
    this.group.add(this.shadows.group, this.storm.group, this.rings.group, this.spirit.group, this.stars.group);
    this.storm.onArm = () => this.sfx.telegraph(tuning.challenge.strikeWarnSeconds);
  }

  get mult(): number {
    return Math.min(tuning.challenge.comboMax, 1 + Math.floor(this.combo / 3));
  }

  /** Flicker the bird while it can't be hurt. */
  get invulnerable(): boolean {
    return this.running && this.invuln > 0;
  }

  /** 0..1 for the music: calm while exploring, higher in events and with shadows close. */
  get tension(): number {
    if (!this.running) return 0;
    const near = Number.isFinite(this.nearestShadow) ? Math.max(0, 1 - this.nearestShadow / 300) : 0;
    return Math.min(1, 0.35 + (this.event ? 0.4 : 0) + near * 0.35 + this.storm.level * 0.15);
  }

  /** Dev/testing: start this event as soon as possible. */
  queueEvent(kind: EventKind): void {
    this.queued = kind;
    this.nextEventAt = this.time;
  }

  /** Camera shake accumulated since the last call. */
  takeKick(): number {
    const k = this.kickAmount;
    this.kickAmount = 0;
    return k;
  }

  start(): void {
    const c = tuning.challenge;
    this.stopEvents(true);
    this.running = true;
    this.lives = c.lives;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.invuln = 0;
    this.dying = 0;
    this.time = 0;
    this.danger = 1;
    this.purified = 0;
    this.eventsWon = 0;
    this.skimTime = 0;
    this.spawnTimer = c.graceSeconds;
    this.shadowAnnounced = false;
    this.event = null;
    this.lastEvent = null;
    this.nextEventAt = c.firstEventSeconds;
    this.group.visible = true;
    this.hud.reset();
    this.hud.visible = true;
    this.hud.announce(t('challengeGo'), '', 1.8);
  }

  /** Leaves challenge mode (back to free flight). */
  stop(): void {
    this.running = false;
    this.dying = 0;
    this.stopEvents(true);
    this.hud.visible = false;
  }

  private stopEvents(immediate: boolean): void {
    this.storm.stop(immediate);
    this.rings.stop();
    this.spirit.stop();
    this.stars.stop();
    this.shadows.clear();
    this.event = null;
    this.hud.setStatus(null);
  }

  /** Pickups from collectibles.ts score in a run. */
  onCollect(events: CollectEvent[]): void {
    if (!this.running) return;
    for (const e of events) {
      if (e.kind === 'mote') this.add(20, '');
      else if (e.kind === 'trail') this.add(300, t('popTrail'), 'gold');
      else if (e.kind === 'feather') {
        this.add(2000, t('popFeather'), 'gold');
        this.gainLife();
      } else if (e.kind === 'shrine') this.add(500, t('popShrine'), 'gold');
    }
  }

  /** Hitting the ground steeply or scraping rock at speed. */
  crash(): void {
    if (!this.running) return;
    if (this.hurt(t('popCrash'))) {
      // Bounce off, nose up.
      this.flight.pitch = Math.max(this.flight.pitch, 0.4);
      this.flight.climb = Math.max(this.flight.climb, 6);
    }
  }

  update(dt: number, f: ChallengeFrame): void {
    const c = tuning.challenge;
    // Out of challenge mode: let things fade for a few seconds, then cost nothing.
    if (this.running) this.idle = 0;
    else if ((this.idle += dt) > 4) {
      this.group.visible = false;
      return;
    }
    const canHit = this.running && this.invuln <= 0 && this.dying <= 0;
    const boosting = f.boost > c.purifyBoost;

    // Pieces always update, so things fade out after a run or an event ends.
    const shadowEvents = this.shadows.update(dt, f.pos, f.vel, boosting, this.danger, this.ground, canHit);
    const strikes = this.storm.update(dt, f.camera, f.pos, f.vel, this.danger, this.ground);
    const caught = this.stars.update(dt, f.prev, f.pos, f.vel, this.ground);
    const spiritResult = this.spirit.update(dt, f.pos, this.ground);
    const ringResult = this.rings.update(dt, f.prev, f.pos);
    this.nearestShadow = Infinity;
    for (const s of this.shadows.list) if (s.alive && !s.dying) this.nearestShadow = Math.min(this.nearestShadow, s.pos.distanceTo(f.pos));

    if (this.running) {
      this.time += dt;
      this.invuln = Math.max(0, this.invuln - dt);
      this.score += dt * 4 * this.danger; // a trickle for staying alive
      if ((this.comboTimer -= dt) <= 0) this.combo = 0;

      // Danger rises with time.
      const danger = Math.min(c.maxDanger, 1 + Math.floor(this.time / c.dangerStepSeconds));
      if (danger > this.danger) {
        this.danger = danger;
        this.hud.announce(`${t('dangerUp')} ${ROMAN[danger - 1] ?? danger}`, t('dangerUpSub'), 2.4);
        this.sfx.warn();
      }

      // Flying low and fast is risky, so it scores.
      if (f.skim > 0.55 && f.speed > 45) {
        this.skimTime += dt;
        if (this.skimTime > 1.5) {
          this.skimTime = 0;
          this.add(60, t('popSkim'));
        }
      } else {
        this.skimTime = Math.max(0, this.skimTime - dt);
      }

      this.spawnShadows(dt, f);
      this.director(dt, f);

      for (const e of shadowEvents) {
        if (e.kind === 'hit') this.hurt(t('popHit'));
        else if (e.kind === 'purify') {
          this.purified++;
          if (this.event === 'swarm') this.swarmPurified++;
          this.add(150, t('popPurified'), 'gold');
          this.hooks.burst(e.pos, 70, 26);
          this.flight.energy = Math.min(1, this.flight.energy + 0.3);
          this.sfx.purify();
          this.kickAmount += 0.25;
        } else {
          this.add(75, t('popNearMiss'));
          this.sfx.nearMiss();
        }
      }
      for (const s of strikes) {
        this.sfx.thunder(s.distance);
        this.kickAmount += Math.max(0, 0.5 - s.distance / 800);
        if (s.distance < c.strikeRadius && canHit) this.hurt(t('popBolt'));
        else if (s.distance < c.strikeRadius * 3.5) this.add(100, t('popDodged'));
      }
      if (caught > 0) {
        for (const at of this.stars.caughtAt) {
          this.add(40, t('popStar'));
          this.hooks.burst(at, 24, 14);
          this.sfx.star(this.stars.caught);
          this.flight.energy = Math.min(1, this.flight.energy + 0.08);
        }
      }
      if (ringResult === 'pass' || ringResult === 'done') {
        const i = ringResult === 'done' ? this.rings.count - 1 : this.rings.next - 1;
        this.add(100 + 25 * i, t('popRing'));
        this.hooks.burst(this.rings.centers[i], 50, 22);
        this.sfx.ring(i);
        this.flight.energy = Math.min(1, this.flight.energy + 0.15);
      }
      if (ringResult === 'done') {
        this.add(1000, t('popBonus'), 'gold', false);
        this.endEvent(true, t('evWon'));
      } else if (ringResult === 'fail') {
        this.endEvent(false, t('evRingsFail'));
      }
      if (spiritResult === 'caught') {
        this.add(1500, t('popCaught'), 'gold');
        this.hooks.burst(f.pos, 120, 34);
        this.flight.energy = 1;
        this.endEvent(true, t('evWon'));
      } else if (spiritResult === 'escaped') {
        this.endEvent(false, t('evSpiritFail'));
      }

      // The last light went out: a moment to see it happen, then the summary.
      if (this.dying > 0 && (this.dying -= dt) <= 0) this.finish();
    }

    this.hud.update(
      dt,
      {
        score: this.score,
        mult: this.mult,
        combo: Math.max(0, this.comboTimer / c.comboWindow),
        lives: this.lives,
        maxLives: c.lives,
        danger: this.danger,
        camera: f.camera,
        threats: this.shadows.list,
        target: this.event === 'rings' ? this.rings.nextCenter : this.event === 'spirit' && this.spirit.active ? this.spirit.pos : null,
      },
      this.storm.flash,
    );
  }

  /** Hunters arrive on their own between (and, fewer, during) events. */
  private spawnShadows(dt: number, f: ChallengeFrame): void {
    const c = tuning.challenge;
    if (this.event === 'swarm' || this.dying > 0) return;
    this.spawnTimer -= dt * (this.event ? 0.5 : 1);
    if (this.spawnTimer > 0) return;
    this.spawnTimer = Math.max(c.shadowSpawnMinSeconds, c.shadowSpawnSeconds - (this.danger - 1) * 1.6) * (0.8 + Math.random() * 0.4);
    const max = Math.floor(c.shadowMaxAlive + c.shadowMaxPerLevel * (this.danger - 1));
    if (this.shadows.aliveCount >= max) return;
    // Mostly from ahead, where they can be seen coming; from the flanks and behind later on.
    const behind = this.danger >= 3 && Math.random() < 0.3;
    const offset = behind ? (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 1.5) : (Math.random() - 0.5) * 1.6;
    this.spawnShadow(f, offset, c.shadowSpawnDistance);
    this.sfx.spawn();
    if (!this.shadowAnnounced) {
      this.shadowAnnounced = true;
      this.hud.announce(t('firstShadow'), t('firstShadowSub'), 3);
    }
  }

  /** One shadow at `distance`, `yawOffset` radians off the bird's heading, aimed at the bird. */
  private spawnShadow(f: ChallengeFrame, yawOffset: number, distance: number, life?: number): void {
    const yaw = Math.atan2(-f.forward.x, -f.forward.z) + yawOffset;
    this.p.set(f.pos.x - Math.sin(yaw) * distance, 0, f.pos.z - Math.cos(yaw) * distance);
    this.p.y = Math.max(this.ground(this.p.x, this.p.z) + 30, f.pos.y + (Math.random() - 0.3) * 80);
    this.d.subVectors(f.pos, this.p).normalize();
    this.shadows.spawn(this.p, this.d, life);
  }

  /** Starts, runs and ends the random events. */
  private director(dt: number, f: ChallengeFrame): void {
    const c = tuning.challenge;
    if (this.dying > 0) return;
    if (!this.event) {
      if (this.time >= this.nextEventAt) {
        const pool = (this.eventsWon === 0 && this.lastEvent === null ? FIRST_EVENTS : EVENTS).filter((e) => e !== this.lastEvent);
        this.startEvent(this.queued ?? pool[Math.floor(Math.random() * pool.length)], f);
        this.queued = null;
      }
      return;
    }
    this.eventTime += dt;
    const left = Math.max(0, this.eventDuration - this.eventTime);
    switch (this.event) {
      case 'storm':
        this.hud.setStatus(`${t('evStorm')} · ${Math.ceil(left)} s`, left / this.eventDuration);
        if (left <= 0) {
          this.add(600, t('popBonus'), 'gold', false);
          this.endEvent(true, t('evStormOver'));
        }
        break;
      case 'rings':
        if (this.rings.active) {
          this.hud.setStatus(
            `${t('evRings')} ${this.rings.next + 1}/${this.rings.count} · ${this.rings.timeLeft.toFixed(1)} s`,
            this.rings.timeLeft / this.rings.timeGiven,
            this.rings.timeLeft < 2.5,
          );
        }
        break;
      case 'spirit':
        if (this.spirit.active) this.hud.setStatus(`${t('evSpirit')} · ${Math.ceil(this.spirit.timeLeft)} s`, this.spirit.timeLeft / c.spiritSeconds, this.spirit.timeLeft < 6);
        break;
      case 'stars': {
        const total = this.stars.total;
        this.hud.setStatus(`${t('evStars')} ${this.stars.caught}/${total} · ${Math.ceil(Math.max(0, this.stars.timeLeft))} s`, Math.max(0, this.stars.timeLeft) / c.starSeconds);
        if (!this.stars.active && this.stars.falling === 0) {
          const won = this.stars.caught >= total * 0.4;
          this.add(this.stars.caught * 25, t('popBonus'), 'gold', false);
          this.endEvent(won, `${this.stars.caught}/${total} ${t('evStarsOver')}`);
        }
        break;
      }
      case 'swarm':
        this.hud.setStatus(`${t('evSwarm')} · ${Math.ceil(left)} s`, left / this.eventDuration);
        if (left <= 0 || (this.eventTime > 3 && this.shadows.aliveCount === 0)) {
          this.add(800 + 200 * this.swarmPurified, t('popBonus'), 'gold', false);
          this.endEvent(true, t('evSwarmOver'));
        }
        break;
    }
  }

  private startEvent(kind: EventKind, f: ChallengeFrame): void {
    const c = tuning.challenge;
    this.event = kind;
    this.lastEvent = kind;
    this.eventTime = 0;
    this.eventDuration = 0;
    const [title, sub] = TITLES[kind];
    this.hud.announce(t(title) as string, t(sub) as string, 3.2);
    this.sfx.eventStart();
    this.kickAmount += 0.3;
    if (kind === 'storm') {
      this.eventDuration = c.stormSeconds;
      this.storm.start(c.stormSeconds);
    } else if (kind === 'rings') {
      this.rings.start(f.pos, f.forward, this.ground);
    } else if (kind === 'spirit') {
      this.spirit.start(f.pos, f.forward, this.ground);
    } else if (kind === 'stars') {
      this.stars.start();
    } else {
      this.eventDuration = c.swarmSeconds;
      this.swarmPurified = 0;
      const n = c.swarmCount + this.danger - 1;
      // A loose ring all around, closing in.
      for (let i = 0; i < n; i++) this.spawnShadow(f, (i / n) * Math.PI * 2 + Math.random() * 0.4, 260 + Math.random() * 100, c.swarmSeconds + 6);
      this.sfx.spawn();
    }
  }

  private endEvent(won: boolean, message: string): void {
    const c = tuning.challenge;
    if (this.event === 'storm') this.storm.stop();
    this.event = null;
    this.nextEventAt = this.time + c.eventGapMin + Math.random() * Math.max(0, c.eventGapMax - c.eventGapMin);
    this.hud.setStatus(null);
    this.hud.announce(message, '', 2.2);
    if (won) {
      this.eventsWon++;
      this.sfx.eventWin();
      this.gainLife();
    } else {
      this.sfx.fail();
    }
  }

  private gainLife(): void {
    if (this.lives < tuning.challenge.lives) {
      this.lives++;
      this.hud.pop(t('popLife'), 'gold');
      this.sfx.lifeUp();
    } else {
      this.add(500, t('popBonus'), 'gold', false);
    }
  }

  /** Scores `points` times the multiplier; `bump` chains the combo. */
  private add(points: number, label: string, kind: 'good' | 'gold' = 'good', bump = true): void {
    if (!this.running || this.dying > 0) return;
    if (bump) {
      this.combo++;
      this.comboTimer = tuning.challenge.comboWindow;
    }
    const p = Math.round(points * this.mult);
    this.score += p;
    this.hud.pop(label ? `+${p} ${label}` : `+${p}`, kind);
  }

  /** Loses a light (unless invulnerable). Returns whether it hurt. */
  private hurt(label: string): boolean {
    const c = tuning.challenge;
    if (!this.running || this.invuln > 0 || this.dying > 0) return false;
    this.lives--;
    this.invuln = c.invulnSeconds;
    this.combo = 0;
    this.comboTimer = 0;
    this.flight.speed *= c.hitSlowdown;
    this.flight.energy = Math.max(0, this.flight.energy - 0.2);
    this.kickAmount += 1;
    this.hud.hurtFlash();
    this.hud.pop(label, 'bad');
    this.sfx.hit();
    if (this.lives <= 0) {
      this.dying = 1.6;
      this.sfx.gameOver();
      this.hud.announce(t('gameOver'), '', 2);
    }
    return true;
  }

  private finish(): void {
    this.running = false;
    this.stopEvents(false);
    const score = Math.round(this.score);
    const previous = this.save.best ?? 0;
    const newBest = score > previous;
    if (newBest) {
      this.save.best = score;
      writeSave(this.save);
    }
    this.hooks.gameOver({
      score,
      best: Math.max(previous, score),
      newBest,
      time: this.time,
      purified: this.purified,
      events: this.eventsWon,
      danger: this.danger,
    });
  }
}
