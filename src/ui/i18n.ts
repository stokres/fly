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
    ],
  },
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
