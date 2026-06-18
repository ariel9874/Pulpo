// Dictado por voz (speech-to-text). Usa la Web Speech API del navegador donde
// existe (Chrome/Edge en web). En plataformas sin soporte degrada con gracia:
// `getSpeechRecognitionCtor` devuelve null y la UI esconde el micrófono.

interface SpeechResultAlternative {
  transcript: string;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<SpeechResultAlternative>>;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Junta las alternativas de mayor confianza en un solo texto. */
export function extractTranscript(event: SpeechRecognitionEventLike): string {
  let text = "";
  for (let i = 0; i < event.results.length; i += 1) {
    const first = event.results[i]?.[0];
    if (first) text += first.transcript;
  }
  return text.trim();
}

/** Constructor de SpeechRecognition del entorno, o null si no hay soporte. */
export function getSpeechRecognitionCtor(
  g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): SpeechRecognitionCtor | null {
  const ctor = g["SpeechRecognition"] ?? g["webkitSpeechRecognition"];
  return typeof ctor === "function" ? (ctor as SpeechRecognitionCtor) : null;
}

export function isSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export interface DictateOptions {
  lang?: string;
  onText: (text: string) => void;
  onError?: (error: unknown) => void;
  onEnd?: () => void;
}

/**
 * Empieza a dictar; entrega el texto reconocido por `onText`. Devuelve una
 * función para detener, o null si el entorno no soporta dictado.
 */
export function startDictation(opts: DictateOptions): (() => void) | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = opts.lang ?? "es-ES";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const text = extractTranscript(event);
    if (text) opts.onText(text);
  };
  recognition.onerror = (error) => opts.onError?.(error);
  recognition.onend = () => opts.onEnd?.();
  recognition.start();
  return () => recognition.stop();
}
