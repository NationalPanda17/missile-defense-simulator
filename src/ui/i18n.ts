// Translations. English is the source text and the key: tr('Pause') returns the chosen language's wording, or the
// English when a string has not been translated yet, so partly translated screens still read correctly.
// To add a language: add it to LANGS and give it a dictionary below. To translate more of the game: wrap the
// English string in tr() where it is shown and add it to each dictionary.
import { useSyncExternalStore } from 'react';

export const LANGS = { en: 'English', es: 'Español' } as const;
export type Lang = keyof typeof LANGS;

const KEY = 'mds.lang';
const listeners = new Set<() => void>();
let current: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v && v in LANGS ? (v as Lang) : 'en';
  } catch { return 'en'; }
})();

export const lang = () => current;
export function setLang(l: Lang) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** Re-render when the language changes. Call once near the top of a screen. */
export const useLang = (): Lang => useSyncExternalStore(subscribe, lang, lang);

const ES: Record<string, string> = {
  // Start screen
  'Global Integrated Defense Command': 'Mando Global de Defensa Integrada',
  'MISSILE DEFENSE SIMULATOR': 'SIMULADOR DE DEFENSA ANTIMISILES',
  'Command a fictional four-domain defense network — Space, Air, Sea and Ground — across seven strategic regions. Manage readiness, communications, uncertain intelligence and scarce resources through a dynamic campaign.':
    'Dirige una red de defensa ficticia de cuatro dominios (Espacio, Aire, Mar y Tierra) en siete regiones estratégicas. Gestiona la disponibilidad, las comunicaciones, la inteligencia incierta y los recursos escasos a lo largo de una campaña dinámica.',
  'You build the defense; the simulation fights it. Place systems in each briefing, then during the phase raise alerts, resupply, move systems and handle reports.':
    'Tú construyes la defensa; la simulación la pone a prueba. Coloca sistemas en cada sesión informativa y, durante la fase, da alertas, reabastece, mueve sistemas y atiende los informes.',
  '? How to play': '? Cómo se juega',
  'Continue': 'Continuar',
  'Continue ▶': 'Continuar ▶',
  'New here?': '¿Primera vez?',
  'Start with Lesson 1, Command basics: five minutes, with a coach that shows you each control. The campaign makes much more sense after the first few lessons.':
    'Empieza por la Lección 1, Fundamentos del mando: cinco minutos con un instructor que te enseña cada control. La campaña se entiende mucho mejor después de las primeras lecciones.',
  'I know the basics': 'Ya conozco lo básico',
  'Read how to play': 'Leer cómo se juega',
  'Start Lesson 1 ▶': 'Empezar la Lección 1 ▶',
  'Quick Battle': 'Batalla rápida',
  '· about 5 minutes': '· unos 5 minutos',
  'One region, three attack waves, a fixed budget, and nothing else to manage. Place air defenses on the map, then watch them fight and see why each threat was stopped or got through. A different battle every time.':
    'Una región, tres oleadas de ataque, un presupuesto fijo y nada más que gestionar. Coloca las defensas aéreas en el mapa, míralas combatir y comprueba por qué se detuvo o pasó cada amenaza. Una batalla distinta cada vez.',
  'Play a quick battle ▶': 'Jugar una batalla rápida ▶',
  'Endless Defense': 'Defensa sin fin',
  'One region, a bigger wave every time, a briefing between each. How many can you survive?': 'Una región, una oleada mayor cada vez y una sesión informativa entre ellas. ¿Cuántas puedes resistir?',
  'Start a run ▶': 'Empezar ▶',
  'Raid Designer': 'Diseñador de ataques',
  'Play the attacker. Write a raid, then hand it to a friend to defend, or send it against the computer’s defense.': 'Juega como atacante. Diseña un ataque y pásaselo a un amigo para que lo defienda, o lánzalo contra la defensa del ordenador.',
  'Design a raid ▶': 'Diseñar un ataque ▶',
  'Campaign': 'Campaña',
  'Four-phase global campaign: establish the network, weather regional instability, survive a global crisis and lead the recovery. 240 simulated hours.':
    'Campaña global en cuatro fases: establece la red, capea la inestabilidad regional, sobrevive a una crisis mundial y dirige la recuperación. 240 horas simuladas.',
  'Begin campaign': 'Empezar la campaña',
  'Crisis Mode': 'Modo crisis',
  'Start inside a cascading blackout with thin resources, unreliable intelligence and simultaneous disruptions. 96 hours, network management only (no threat waves; the Scenario Editor can add them).':
    'Empieza en pleno apagón en cascada, con pocos recursos, inteligencia poco fiable y fallos simultáneos. 96 horas, solo gestión de la red (sin oleadas de amenazas; el Editor de escenarios puede añadirlas).',
  'Enter crisis': 'Entrar en la crisis',
  'Training Academy': 'Academia de instrucción',
  '{n} guided lessons, from your first click to defending a region under attack, then a graded certification exercise. A coach tells you what to do and checks it off.':
    '{n} lecciones guiadas, desde el primer clic hasta la defensa de una región atacada, y después un ejercicio de certificación con nota. Un instructor te dice qué hacer y lo va marcando.',
  'Open the Academy': 'Abrir la Academia',
  'Sandbox': 'Modo libre',
  'Configure starting resources, regional conditions, domain readiness, event frequency and duration in the Scenario Editor.':
    'Configura los recursos iniciales, las condiciones regionales, la disponibilidad de cada dominio, la frecuencia de sucesos y la duración en el Editor de escenarios.',
  'Open scenario editor': 'Abrir el editor de escenarios',
  'Browser saves': 'Partidas guardadas en este navegador',
  'Import save file…': 'Importar partida…',
  'No saved operations in this browser.': 'No hay partidas guardadas en este navegador.',
  'Difficulty': 'Dificultad',
  'Opponent': 'Adversario',
  'Language': 'Idioma',
  // Top bar
  '▶ Resume': '▶ Reanudar',
  '❚❚ Pause': '❚❚ Pausa',
  'Turn mode': 'Por turnos',
  'Credits': 'Créditos',
  'Alert': 'Alerta',
  'Sim time': 'Hora',
  'Readiness': 'Disponibilidad',
  'Network': 'Red',
  '☰ Main menu': '☰ Menú principal',
  'Main menu': 'Menú principal',
  'Stay': 'Seguir',
  'Guide': 'Guía',
  'Needs you': 'Te necesita',
  'All clear': 'Todo en orden',
  // Navigation
  'Global Operations': 'Operaciones globales',
  'Tactical Theater': 'Teatro táctico',
  'Space Command': 'Mando espacial',
  'Air Command': 'Mando aéreo',
  'Sea Command': 'Mando naval',
  'Ground Command': 'Mando terrestre',
  'Intelligence': 'Inteligencia',
  'Communications': 'Comunicaciones',
  'Logistics': 'Logística',
  'Infrastructure': 'Infraestructura',
  'Campaign Management': 'Gestión de la campaña',
  'Scenario Editor': 'Editor de escenarios',
  'After-Action Review': 'Análisis posterior',
  'Command': 'Mando',
  'Domains': 'Dominios',
  'Staff': 'Estado mayor',
  'Scenario': 'Escenario',
  // Briefing
  '1 · Briefing': '1 · Informe',
  '2 · Deploy defenses': '2 · Desplegar defensas',
  'Deploy defenses ▶': 'Desplegar defensas ▶',
  'Assume command — begin phase ▶': 'Asumir el mando: empezar la fase ▶',
  'Begin anyway ▶': 'Empezar de todos modos ▶',
};

const DICT: Record<Lang, Record<string, string>> = { en: {}, es: ES };

/** The text in the chosen language. `{name}` placeholders are filled from `vars`. */
export function tr(text: string, vars?: Record<string, string | number>): string {
  let out = DICT[current][text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

/** How much of the dictionary a language covers, for the picker's note. */
export const translated = (l: Lang) => Object.keys(DICT[l]).length;
