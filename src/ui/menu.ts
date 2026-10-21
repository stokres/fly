// Title screen, pause menu, settings and controls. Menus never stop the world from rendering:
// the islands stay alive behind them.
import { type Lang, getLang, setLang, t } from './i18n';
import { isTouchDevice } from '../touch';
import type { Quality, SaveData } from './save';

export type GameMode = 'zen' | 'challenge';

export interface RunSummary {
  score: number;
  best: number;
  newBest: boolean;
  time: number;
  purified: number;
  events: number;
  danger: number;
}

export interface MenuCallbacks {
  /** Player chose to fly: resume (no mode), or start that mode. */
  onPlay: (mode?: GameMode) => void;
  onSettingsChanged: () => void;
  onResetProgress: () => void;
}

type Screen = 'title' | 'pause' | 'settings' | 'controls' | 'gameover' | 'none';

const fmt = (n: number) => Math.round(n).toLocaleString('es-ES');

export class Menu {
  readonly root: HTMLElement;
  private screen: Screen = 'title';
  private previous: Screen = 'title';
  private started = false;
  private summary: RunSummary | null = null;
  /** Current game mode, for the pause menu. */
  mode: GameMode = 'zen';

  constructor(
    parent: HTMLElement,
    private readonly save: SaveData,
    private readonly progress: () => { feathers: number; featherTotal: number; shrines: number; shrineTotal: number },
    private readonly cb: MenuCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'screen dim';
    parent.appendChild(this.root);
    this.render();
  }

  get open(): boolean {
    return this.screen !== 'none';
  }

  /** Shows the loading hint on the title until the world is ready. */
  setLoading(loading: boolean): void {
    this.root.querySelector('.loading')?.classList.toggle('hidden', !loading);
    this.root.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((b) => (b.disabled = loading));
  }

  pause(): void {
    if (!this.started || this.screen !== 'none') return;
    this.show('pause');
  }

  /** Escape can close this screen and go back to flying. */
  get canResume(): boolean {
    return this.screen !== 'gameover' && this.screen !== 'title';
  }

  /** End of a challenge run. */
  gameOver(summary: RunSummary): void {
    this.summary = summary;
    this.show('gameover');
  }

  close(): void {
    this.show('none');
  }

  private show(screen: Screen): void {
    this.previous = this.screen === 'settings' || this.screen === 'controls' ? this.previous : this.screen;
    this.screen = screen;
    this.render();
  }

  private render(): void {
    const r = this.root;
    r.classList.toggle('hidden', this.screen === 'none');
    if (this.screen === 'none') return;
    const p = this.progress();
    const progress = `<div class="progress shadow"><span>✦ ${t('feathers')}: ${p.feathers}/${p.featherTotal}</span><span>⛩ ${t('shrines')}: ${p.shrines}/${p.shrineTotal}</span></div>`;
    if (this.screen === 'title') {
      r.innerHTML = `<div class="center">
        <h1 class="shadow">${t('title')}</h1>
        <div class="sub shadow">${t('subtitle')}</div>
        <div class="goal shadow">${t('goal')}</div>
        ${p.feathers || p.shrines ? progress : ''}
        ${isTouchDevice ? `<div class="goal shadow" style="opacity:0.8;font-size:13px">${t('holdHint')}</div>` : ''}
        <div class="modes">
          <button class="btn mode" data-play="zen">${t('modeZen')}<small>${t('modeZenSub')}</small></button>
          <button class="btn mode challenge" data-play="challenge">${t('modeChallenge')}<small>${t('modeChallengeSub')}</small></button>
        </div>
        ${this.save.best > 0 ? `<div class="best shadow">${t('best')}: <b>${fmt(this.save.best)}</b></div>` : ''}
        <div><button class="btn ghost" data-settings>${t('settings')}</button><button class="btn ghost" data-controls>${t('controls')}</button></div>
        <div class="loading shadow">· · ·</div>
      </div>`;
    } else if (this.screen === 'pause') {
      r.innerHTML = `<div class="panel center">
        <h2>${t('paused')}</h2>${progress}
        <button class="btn" data-play>${t('resume')}</button>
        <div class="btnrow">${
          this.mode === 'challenge'
            ? `<button class="btn ghost" data-play="challenge">${t('restartChallenge')}</button><button class="btn ghost" data-play="zen">${t('quitChallenge')}</button>`
            : `<button class="btn ghost" data-play="challenge">${t('tryChallenge')}</button>`
        }</div>
        <div><button class="btn ghost" data-settings>${t('settings')}</button><button class="btn ghost" data-controls>${t('controls')}</button></div>
      </div>`;
    } else if (this.screen === 'gameover') {
      const s = this.summary ?? { score: 0, best: 0, newBest: false, time: 0, purified: 0, events: 0, danger: 1 };
      const mm = Math.floor(s.time / 60);
      const ss = String(Math.floor(s.time % 60)).padStart(2, '0');
      r.innerHTML = `<div class="panel center">
        <h2>${t('gameOver')}</h2>
        <div class="bigscore">${fmt(s.score)}</div>
        ${s.newBest ? `<div class="newbest">${t('newBest')}</div>` : `<div class="best">${t('best')}: <b>${fmt(s.best)}</b></div>`}
        <div class="summary">
          <span>${t('statTime')}</span><span class="v">${mm}:${ss}</span>
          <span>${t('statPurified')}</span><span class="v">${s.purified}</span>
          <span>${t('statEvents')}</span><span class="v">${s.events}</span>
          <span>${t('statDanger')}</span><span class="v">${s.danger}</span>
        </div>
        <button class="btn" data-play="challenge">${t('retry')}</button>
        <div><button class="btn ghost" data-play="zen">${t('freeFlight')}</button></div>
      </div>`;
    } else if (this.screen === 'controls') {
      const keys = (isTouchDevice ? t('controlsTouch') : t('controlsList'))
        .map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`)
        .join('');
      r.innerHTML = `<div class="panel"><h2>${t('controls')}</h2><div class="keys">${keys}</div>
        <div class="center" style="margin-top:18px"><button class="btn ghost" data-back>${t('back')}</button></div></div>`;
    } else {
      const s = this.save.settings;
      const seg = (name: string, options: [string, string][], value: string) =>
        `<div class="seg" data-seg="${name}">${options.map(([v, label]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${label}</button>`).join('')}</div>`;
      r.innerHTML = `<div class="panel"><h2>${t('settings')}</h2>
        <div class="row"><span>${t('language')}</span>${seg('lang', [['es', 'Español'], ['en', 'English']], getLang())}</div>
        <div class="row"><span>${t('volume')}</span><input type="range" min="0" max="1" step="0.01" value="${s.volume}" data-range="volume"></div>
        <div class="row"><span>${t('music')}</span><input type="range" min="0" max="1.5" step="0.01" value="${s.music}" data-range="music"></div>
        ${
          isTouchDevice
            ? `<div class="row"><span>${t('tiltSensitivity')}</span><input type="range" min="0.4" max="2.5" step="0.05" value="${s.tiltSensitivity}" data-range="tiltSensitivity"></div>`
            : `<div class="row"><span>${t('sensitivity')}</span><input type="range" min="0.2" max="3" step="0.05" value="${s.sensitivity}" data-range="sensitivity"></div>`
        }
        <div class="row"><span>${t('cameraRoll')}</span><input type="range" min="0" max="0.8" step="0.01" value="${s.cameraRoll}" data-range="cameraRoll"></div>
        <div class="row"><span>${t('invert')}</span>${seg('invert', [['0', '—'], ['1', '✓']], s.invert ? '1' : '0')}</div>
        <div class="row"><span>${t('quality')}</span>${seg('quality', [['low', t('low')], ['medium', t('medium')], ['high', t('high')]], s.quality)}</div>
        <div class="center" style="margin-top:16px">
          <button class="btn ghost" data-back>${t('back')}</button>
          <button class="btn ghost" data-reset style="font-size:13px;opacity:0.8">${t('resetProgress')}</button>
        </div></div>`;
    }
    this.bind();
  }

  private bind(): void {
    const r = this.root;
    r.querySelectorAll<HTMLElement>('[data-play]').forEach((el) =>
      el.addEventListener('click', () => {
        this.started = true;
        this.show('none');
        this.cb.onPlay((el.dataset.play || undefined) as GameMode | undefined);
      }),
    );
    r.querySelector('[data-settings]')?.addEventListener('click', () => this.show('settings'));
    r.querySelector('[data-controls]')?.addEventListener('click', () => this.show('controls'));
    r.querySelector('[data-back]')?.addEventListener('click', () => {
      this.screen = this.previous;
      this.render();
    });
    r.querySelector('[data-reset]')?.addEventListener('click', () => {
      if (confirm(t('confirmReset'))) this.cb.onResetProgress();
    });
    const s = this.save.settings;
    r.querySelectorAll<HTMLInputElement>('[data-range]').forEach((el) =>
      el.addEventListener('input', () => {
        const key = el.dataset.range as 'volume' | 'music' | 'sensitivity' | 'cameraRoll' | 'tiltSensitivity';
        s[key] = Number(el.value);
        this.cb.onSettingsChanged();
      }),
    );
    r.querySelectorAll<HTMLElement>('[data-seg]').forEach((seg) =>
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          const v = b.dataset.v as string;
          const name = seg.dataset.seg;
          if (name === 'lang') {
            s.lang = v as Lang;
            setLang(v as Lang);
          } else if (name === 'invert') s.invert = v === '1';
          else if (name === 'quality') {
            s.quality = v as Quality;
            s.qualityLocked = true;
          }
          this.cb.onSettingsChanged();
          this.render();
        }),
      ),
    );
  }
}
