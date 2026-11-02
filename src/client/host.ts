import type { StatusResponse } from "@/lib/api";
import type { LineId, LineParams } from "@/lib/persona/copy";
import type { TurnKind } from "@/lib/persona/titles";
import type { Language } from "@/lib/types";
import type { PersistedData } from "./data";
import type { Pending } from "./pending";
import type { CameraState, Platform } from "./ports";
import type { SayOptions } from "./speech";
import type { MirrorState, NoticeKey } from "./state";

/**
 * What a flow (scan, looks, reading a label) may ask of the controller. Flows are small classes
 * that never touch the DOM or the network directly: they go through the platform's ports and this
 * host, so each one can be tested alone with fakes.
 */
export interface Host {
  readonly platform: Platform;
  state(): MirrorState;
  patch(p: Partial<MirrorState>): void;
  /** Change the remembered data and save it. */
  update(fn: (d: PersistedData) => PersistedData): void;
  lang(): Language;
  /** Say one of the mirror's own sentences (queued, captioned, linted). */
  line<K extends LineId>(id: K, params: LineParams[K], opts?: SayOptions): void;
  /** Say text that is not a canned line (a look's recipe step, a model's reply). */
  text(text: string, opts?: SayOptions): void;
  /** The title to address the person by this turn, ready to spread into a line's params. */
  address(kind?: TurnKind): { title?: string };
  /** Remember what the next "yes" or "no" answers. */
  ask(p: Pending): void;
  speaking(): boolean;
  /** Resolves when the mirror has finished speaking everything queued. */
  idle(): Promise<void>;
  ensureStatus(): Promise<StatusResponse | null>;
  ensureCamera(): Promise<CameraState>;
  notice(key: NoticeKey): void;
}
