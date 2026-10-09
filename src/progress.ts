// What finding things means: energy, sounds, HUD messages, feather upgrades, contextual hints
// and saving. Collectibles reports events; this turns them into the player's experience.
import type { GameAudio } from './audio';
import type { CollectEvent, Collectibles } from './collectibles';
import type { Flight } from './flight';
import { FEATHERS } from './map';
import { FEATHER_NAMES_ES, getLang, t } from './ui/i18n';
import type { Hud } from './ui/hud';
import { type SaveData, writeSave } from './ui/save';

/** Boost top speed gained per golden feather (m/s). */
export const BOOST_PER_FEATHER = 3;

export class Progress {
  private playTime = 0;

  constructor(
    private readonly collectibles: Collectibles,
    private readonly hud: Hud,
    private readonly audio: GameAudio,
    private readonly save: SaveData,
    private readonly flight: Flight,
  ) {
    collectibles.restore(save.feathers, save.shrines);
    this.applyUpgrades();
    this.refreshCounts(false);
  }

  get feathers(): number {
    return this.collectibles.feathers.size;
  }

  get allFound(): boolean {
    return this.feathers >= this.collectibles.featherCount;
  }

  handle(events: CollectEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'mote':
          this.audio.chime('mote', e.index);
          this.flight.energy = Math.min(1, this.flight.energy + 0.1);
          this.hud.showCombo(e.index + 1, e.total);
          this.hintOnce('motes', t('hintMotes'));
          break;
        case 'trail':
          this.audio.chime('trail');
          this.flight.energy = 1;
          this.hud.showToast(t('trailDone'));
          break;
        case 'feather': {
          this.audio.chime('feather');
          this.flight.energy = 1;
          const name = getLang() === 'es' ? FEATHER_NAMES_ES[e.index] : FEATHERS[e.index].name;
          this.hud.showToast(`${t('featherFound')} · ${this.feathers}/${e.total}`, name);
          this.applyUpgrades();
          if (this.allFound) this.hud.showToast(t('allFound'));
          else this.hud.showToast(t('stronger'));
          this.persist();
          this.refreshCounts(true);
          break;
        }
        case 'shrine':
          this.audio.chime('shrine');
          this.hud.showToast(t('shrineAwake'), t('shrineHint'));
          this.persist();
          this.refreshCounts(true);
          break;
      }
    }
  }

  /** Contextual hints the first time something happens, and a boost hint early on. */
  update(dt: number, state: { current: number; skim: number }): void {
    this.playTime += dt;
    if (state.current > 0.5) this.hintOnce('current', t('hintCurrent'));
    if (state.skim > 0.6) this.hintOnce('skim', t('hintSkim'));
    if (this.playTime > 25) this.hintOnce('boost', t('hintBoost'));
  }

  reset(): void {
    this.collectibles.feathers.clear();
    this.collectibles.shrines.clear();
    this.save.feathers = [];
    this.save.shrines = [];
    this.save.hintsShown = [];
    this.applyUpgrades();
    this.persist();
    this.refreshCounts(false);
  }

  private hintOnce(id: string, text: string): void {
    if (this.save.hintsShown.includes(id)) return;
    this.save.hintsShown.push(id);
    this.hud.showHint(text);
    this.persist();
  }

  private applyUpgrades(): void {
    this.flight.boostBonus = this.feathers * BOOST_PER_FEATHER;
  }

  private refreshCounts(bump: boolean): void {
    this.hud.setCounts(this.feathers, this.collectibles.featherCount, this.collectibles.shrines.size, this.collectibles.shrineCount, bump);
  }

  persist(): void {
    this.save.feathers = [...this.collectibles.feathers];
    this.save.shrines = [...this.collectibles.shrines];
    writeSave(this.save);
  }
}
