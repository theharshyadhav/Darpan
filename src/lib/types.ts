// Shared, framework-free types used by both the browser and the route handlers.

export const LANGUAGES = ["en", "hi", "hinglish"] as const;
export type Language = (typeof LANGUAGES)[number];

export const PACES = ["calm", "steady", "brisk"] as const;
export type Pace = (typeof PACES)[number];

export type Period = "am" | "pm";

/** Where scores came from. "demo" scores are samples and must always be labelled as such. */
export type ScanSource = "youcam" | "demo";

export interface Settings {
  titleId: string; // one of TITLE_PRESETS ids, or "custom"
  customTitle: string; // used when titleId === "custom"
  language: Language;
  pace: Pace;
  /** Frames may be sent to the vision model (to identify a product on request). */
  consentLook: boolean;
  /** A photo may be sent to YouCam for a skin scan or look preview. */
  consentScan: boolean;
  /** Listen hands-free after the mirror finishes speaking. */
  handsFree: boolean;
  kiosk: boolean;
  voiceUri: string; // chosen speechSynthesis voice URI, "" = auto
  welcomed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  titleId: "highness",
  customTitle: "",
  language: "en",
  pace: "calm",
  consentLook: false,
  consentScan: false,
  handsFree: true,
  kiosk: false,
  voiceUri: "",
  welcomed: false,
};

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);
}
