import { describe, expect, it } from "vitest";
import { extractTranscript, getSpeechRecognitionCtor } from "./speech";

describe("extractTranscript", () => {
  it("junta las alternativas de cada resultado", () => {
    const event = {
      results: [[{ transcript: "arregla el " }], [{ transcript: "login" }]],
    };
    expect(extractTranscript(event)).toBe("arregla el login");
  });

  it("recorta espacios sobrantes", () => {
    expect(extractTranscript({ results: [[{ transcript: "  hola  " }]] })).toBe("hola");
  });

  it("vacío si no hay resultados", () => {
    expect(extractTranscript({ results: [] })).toBe("");
  });
});

describe("getSpeechRecognitionCtor", () => {
  it("devuelve null si el entorno no tiene la API", () => {
    expect(getSpeechRecognitionCtor({})).toBeNull();
  });

  it("toma SpeechRecognition o el prefijo webkit", () => {
    const ctor = function () {} as unknown;
    expect(getSpeechRecognitionCtor({ SpeechRecognition: ctor })).toBe(ctor);
    expect(getSpeechRecognitionCtor({ webkitSpeechRecognition: ctor })).toBe(ctor);
  });

  it("ignora valores que no son funciones", () => {
    expect(getSpeechRecognitionCtor({ SpeechRecognition: "nope" })).toBeNull();
  });
});
