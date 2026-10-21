// Spanish and English strings. The language follows the browser until the player picks one.
export type Lang = 'es' | 'en';

const STRINGS = {
  title: { es: 'Fly', en: 'Fly' },
  subtitle: { es: 'Un archipiélago bajo el viento', en: 'An archipelago under the wind' },
  play: { es: 'Volar', en: 'Fly' },
  resume: { es: 'Seguir volando', en: 'Keep flying' },
  settings: { es: 'Ajustes', en: 'Settings' },
  controls: { es: 'Controles', en: 'Controls' },
  back: { es: 'Volver', en: 'Back' },
  paused: { es: 'En pausa', en: 'Paused' },
  clickToFly: { es: 'Haz clic para volar con el ratón', en: 'Click to fly with the mouse' },
  language: { es: 'Idioma', en: 'Language' },
  volume: { es: 'Volumen', en: 'Volume' },
  music: { es: 'Música', en: 'Music' },
  sensitivity: { es: 'Sensibilidad del ratón', en: 'Mouse sensitivity' },
  invert: { es: 'Invertir eje vertical', en: 'Invert vertical axis' },
  quality: { es: 'Calidad gráfica', en: 'Graphics quality' },
  low: { es: 'Baja', en: 'Low' },
  medium: { es: 'Media', en: 'Medium' },
  high: { es: 'Alta', en: 'High' },
  cameraRoll: { es: 'Inclinación de cámara', en: 'Camera roll' },
  resetProgress: { es: 'Borrar progreso', en: 'Reset progress' },
  confirmReset: { es: '¿Seguro? Se perderán las plumas encontradas.', en: 'Sure? Found feathers will be lost.' },
  feathers: { es: 'Plumas doradas', en: 'Golden feathers' },
  shrines: { es: 'Santuarios', en: 'Shrines' },
  featherFound: { es: 'Pluma dorada', en: 'Golden feather' },
  shrineAwake: { es: 'Santuario despierto', en: 'Shrine awakened' },
  shrineHint: { es: 'Una columna de luz señala una pluma', en: 'A pillar of light marks a feather' },
  trailDone: { es: 'Estela completa', en: 'Trail complete' },
  allFound: { es: 'Has reunido todas las plumas. El cielo es tuyo.', en: 'You found every feather. The sky is yours.' },
  stronger: { es: 'Tu impulso es más fuerte', en: 'Your boost grows stronger' },
  hintMotes: { es: 'Atraviesa las luces: recargan tu energía', en: 'Fly through the lights: they refill your energy' },
  hintCurrent: { es: 'Corriente de viento: déjate llevar', en: 'Wind current: let it carry you' },
  hintSkim: { es: 'Rozar el agua o la hierba recarga energía', en: 'Skimming water or grass refills energy' },
  hintBoost: { es: 'Mayús o clic derecho: impulso', en: 'Shift or right click: boost' },
  tiltSensitivity: { es: 'Sensibilidad de inclinación', en: 'Tilt sensitivity' },
  hintTilt: {
    es: 'Inclina el móvil para girar y subir o bajar. El botón dorado acelera',
    en: 'Tilt the phone to turn and climb or dive. The golden button boosts',
  },
  hintNoTilt: {
    es: 'Sin sensor de movimiento: arrastra el dedo para dirigir',
    en: 'No motion sensor: drag your thumb to steer',
  },
  holdHint: {
    es: 'Sujeta el móvil en vertical, en una postura cómoda: esa será la posición neutra',
    en: 'Hold the phone upright, comfortably: that becomes the neutral position',
  },
  qualityLowered: { es: 'Calidad gráfica ajustada para ir más fluido', en: 'Graphics quality lowered for smoother flight' },
  controlsList: {
    es: [
      ['Ratón', 'Dirigir (clic para capturar)'],
      ['W / S', 'Picar / subir'],
      ['A / D', 'Girar'],
      ['Espacio · clic izq.', 'Aletear'],
      ['Mayús · clic der.', 'Impulso'],
      ['M', 'Silenciar'],
      ['Esc', 'Pausa'],
      ['Mando', 'Stick izq. · A aletear · B/LT impulso'],
      ['Reto', 'Impulso contra una sombra: la purificas'],
    ],
    en: [
      ['Mouse', 'Steer (click to capture)'],
      ['W / S', 'Dive / climb'],
      ['A / D', 'Turn'],
      ['Space · left click', 'Flap'],
      ['Shift · right click', 'Boost'],
      ['M', 'Mute'],
      ['Esc', 'Pause'],
      ['Gamepad', 'Left stick · A flap · B/LT boost'],
      ['Challenge', 'Boost into a shadow: purify it'],
    ],
  },
  controlsTouch: {
    es: [
      ['Inclinar a los lados', 'Girar'],
      ['Inclinar hacia delante / atrás', 'Bajar / subir'],
      ['Botón dorado', 'Impulso'],
      ['Botón ⌃', 'Aletear'],
      ['◎', 'Recalibrar la posición neutra'],
      ['❚❚', 'Pausa'],
    ],
    en: [
      ['Tilt sideways', 'Turn'],
      ['Tilt forward / back', 'Dive / climb'],
      ['Golden button', 'Boost'],
      ['⌃ button', 'Flap'],
      ['◎', 'Recalibrate the neutral position'],
      ['❚❚', 'Pause'],
    ],
  },
  modeZen: { es: 'Volar', en: 'Fly' },
  modeZenSub: { es: 'Contemplativo · a tu ritmo', en: 'Peaceful · at your own pace' },
  modeChallenge: { es: 'Reto', en: 'Challenge' },
  modeChallengeSub: { es: 'Sombras, tormentas y carreras', en: 'Shadows, storms and races' },
  best: { es: 'Récord', en: 'Best' },
  tryChallenge: { es: 'Modo reto', en: 'Challenge mode' },
  quitChallenge: { es: 'Dejar el reto', en: 'Quit challenge' },
  restartChallenge: { es: 'Reiniciar reto', en: 'Restart challenge' },
  gameOver: { es: 'Tu luz se apaga', en: 'Your light fades' },
  newBest: { es: 'NUEVO RÉCORD', en: 'NEW BEST' },
  retry: { es: 'Otra vez', en: 'Again' },
  freeFlight: { es: 'Vuelo libre', en: 'Free flight' },
  statTime: { es: 'Tiempo', en: 'Time' },
  statPurified: { es: 'Sombras purificadas', en: 'Shadows purified' },
  statEvents: { es: 'Eventos superados', en: 'Events cleared' },
  statDanger: { es: 'Peligro alcanzado', en: 'Danger reached' },
  challengeGo: { es: '¡A volar!', en: 'Fly!' },
  challengeIntro: {
    es: 'Tienes 3 luces. Embiste a las sombras con impulso para purificarlas; si te tocan sin impulso, pierdes una',
    en: 'You have 3 lights. Ram shadows while boosting to purify them; if they touch you otherwise, you lose one',
  },
  challengeIntroTouch: {
    es: 'Tienes 3 luces. Mantén el botón dorado al chocar con una sombra para purificarla',
    en: 'You have 3 lights. Hold the golden button as you hit a shadow to purify it',
  },
  dangerUp: { es: 'Peligro', en: 'Danger' },
  dangerUpSub: { es: 'Las sombras son más rápidas', en: 'The shadows grow faster' },
  firstShadow: { es: 'Una sombra te ha visto', en: 'A shadow has seen you' },
  firstShadowSub: { es: 'Esquívala… o embístela con impulso', en: 'Dodge it… or ram it with a boost' },
  evStorm: { es: 'Tormenta', en: 'Storm' },
  evStormSub: { es: 'Sal de las columnas de luz antes de que caiga el rayo', en: 'Leave the light columns before the bolt falls' },
  evRings: { es: 'Carrera de anillos', en: 'Ring rush' },
  evRingsSub: { es: 'Crúzalos todos antes de que se acabe el tiempo', en: 'Fly through them all before time runs out' },
  evSpirit: { es: 'Espíritu dorado', en: 'Golden spirit' },
  evSpiritSub: { es: 'Atrápalo antes de que escape', en: 'Catch it before it escapes' },
  evStars: { es: 'Lluvia de estrellas', en: 'Star shower' },
  evStarsSub: { es: 'Atrapa todas las que puedas', en: 'Catch as many as you can' },
  evSwarm: { es: 'Enjambre', en: 'Swarm' },
  evSwarmSub: { es: 'Resiste… o purifícalas a todas', en: 'Hold on… or purify them all' },
  evWon: { es: '¡Superado!', en: 'Cleared!' },
  evRingsFail: { es: 'Se acabó el tiempo', en: 'Out of time' },
  evSpiritFail: { es: 'Se ha escapado', en: 'It got away' },
  evStormOver: { es: 'La tormenta pasa', en: 'The storm passes' },
  evSwarmOver: { es: 'El enjambre se disuelve', en: 'The swarm dissolves' },
  evStarsOver: { es: 'estrellas', en: 'stars' },
  popPurified: { es: 'Purificada', en: 'Purified' },
  popNearMiss: { es: '¡Por los pelos!', en: 'Close call!' },
  popDodged: { es: 'Rayo esquivado', en: 'Bolt dodged' },
  popSkim: { es: 'Vuelo rasante', en: 'Low flying' },
  popRing: { es: 'Anillo', en: 'Ring' },
  popCrash: { es: '¡Choque!', en: 'Crash!' },
  popHit: { es: '¡Herido!', en: 'Hit!' },
  popBolt: { es: '¡Rayo!', en: 'Struck!' },
  popLife: { es: '+1 luz', en: '+1 light' },
  popStar: { es: 'Estrella', en: 'Star' },
  popCaught: { es: '¡Atrapado!', en: 'Caught!' },
  popTrail: { es: 'Estela', en: 'Trail' },
  popFeather: { es: 'Pluma dorada', en: 'Golden feather' },
  popShrine: { es: 'Santuario', en: 'Shrine' },
  popBonus: { es: 'Bonus', en: 'Bonus' },
  goal: {
    es: 'Explora las islas. Doce plumas doradas esperan en lugares especiales; los santuarios te muestran dónde.',
    en: 'Explore the islands. Twelve golden feathers wait in special places; the shrines show you where.',
  },
} as const;

export type StringKey = keyof typeof STRINGS;

let lang: Lang = navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';

export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l;
}

export function getLang(): Lang {
  return lang;
}

type Entry<K extends StringKey> = (typeof STRINGS)[K][Lang];

export function t<K extends StringKey>(key: K): Entry<K> {
  return (STRINGS[key] as Record<Lang, Entry<K>>)[lang];
}

/** Feather names, translated where it reads better. */
export const FEATHER_NAMES_ES = [
  'Bajo el arco',
  'Cima de la aguja',
  'Corazón del anillo',
  'Dentro de la torre',
  'Escalinata del templo',
  'Cumbre del pico',
  'Linterna del faro',
  'Entre los molinos',
  'Corazón de la laguna',
  'Cielo sobre la cresta',
  'Puerto de la cala',
  'Chimeneas de Ascua',
];
