import type { Action, ChatRequest, StatusResponse } from "@/lib/api";
import { concernLabel } from "@/lib/concerns";
import type { LookId } from "@/lib/looks";
import { line as renderLine, type LineId, type LineParams } from "@/lib/persona/copy";
import { lintUtterance } from "@/lib/persona/lint";
import { cleanCustomTitle, shouldUseTitle, titleFor, type TurnKind } from "@/lib/persona/titles";
import { applyProduct, createRitual, finishRitual as closeRitual, nextSlot, skipSlot, type Note, type RitualState } from "@/lib/ritual/engine";
import { classifyProduct, cleanProductName, periodFromHour, speakableProductName, type Category, type SlotId } from "@/lib/ritual/products";
import { SAME_SITTING_MINUTES, compareScans } from "@/lib/skin/compare";
import { strengthAndFocus } from "@/lib/skin/report";
import type { SkinScan } from "@/lib/skin/types";
import type { Language, Pace, Period, Settings } from "@/lib/types";
import {
  addScan,
  defaultData,
  lastScan,
  randomId,
  recordRitual,
  scanBefore,
  setRitual,
  startTracking,
  stopTracking,
  touch,
  withSettings,
  type PersistedData,
} from "./data";
import { LooksFlow } from "./flows/looks";
import { ProductFlow } from "./flows/product";
import { ScanFlow, type SampleReason, type ScanOutcome, type ScanPurpose } from "./flows/scan";
import type { Host } from "./host";
import { isRetry, parseIntents, type Intent, type PendingKind as ParserPending } from "./intents";
import { joinLabels, ledgerRows } from "./ledger-view";
import { entry, live, plain, type Pending, type PendingEntry } from "./pending";
import type { CameraState, EarState, Platform } from "./ports";
import { SpeechQueue, type SayOptions } from "./speech";
import { MAX_CAPTIONS, type Caption, type MirrorState, type NoticeKey, type Panel, type ReportView, type TimerView } from "./state";
import { TimerBank } from "./timers";

/**
 * The mirror's brain on the screen side: the one place that decides what happens when the person
 * speaks, taps, scans, applies a product or asks for a second look.
 *
 * It owns the state the screen draws (an immutable snapshot, replaced on every change), the
 * sentence queue, the questions the mirror has asked, the ritual, the timers and the ledger. The
 * camera, microphone, speaker, storage and network all come in through `Platform`, so the whole
 * conversation can be tested with fakes. Voice, typing and buttons all land on the same methods.
 */

const MAX_UTTERANCE = 400;
const STATUS_RETRY_MS = 15_000;
const NOTICE_MS = 4_000;
const BRAIN_NOTE_EVERY_MS = 90_000;
const RETRY_WINDOW_MS = 120_000;
const VERIFY_WINDOW_MS = 12 * 3_600_000;

const NON_CANCELLING: ReadonlySet<Intent["type"]> = new Set(["yes", "no", "category", "repeat", "hush", "thanks", "greet", "settings", "none"]);

interface ScanIntent {
  purpose: ScanPurpose;
  ritualId?: string;
  before?: SkinScan;
}

export type ConsentKind = "scan" | "look";

export class MirrorController {
  private state: MirrorState;
  private readonly listeners = new Set<() => void>();
  private readonly speech: SpeechQueue;
  private readonly timers: TimerBank;
  private readonly timerThen = new Map<string, SlotId | null>();
  private readonly scanFlow: ScanFlow;
  private readonly looksFlow: LooksFlow;
  private readonly productFlow: ProductFlow;
  private readonly unsubs: Array<() => void> = [];

  private pending: PendingEntry | null = null;
  private retryMemo: { what: "scan" | "verify" | "look"; look?: LookId; at: number } | null = null;
  private scanIntent: ScanIntent = { purpose: "scan" };
  private turn = 0;
  private hearToken = 0;
  private thinkers = 0;
  private captionSeq = 0;
  private noticeSeq = 0;
  private turnLines: string[] = [];
  private prevTurnLines: string[] = [];
  private statusAt = Number.NEGATIVE_INFINITY;
  private statusLoad: Promise<StatusResponse | null> | null = null;
  private brainNoteAt = Number.NEGATIVE_INFINITY;
  private micNoticed = false;
  private visible = true;
  private disposed = false;

  constructor(private readonly platform: Platform) {
    this.state = this.initialState();
    this.speech = new SpeechQueue(
      platform.speaker,
      (ms) => platform.sleep(ms),
      { lang: () => this.lang, voiceUri: () => this.settings.voiceUri, pace: () => this.settings.pace },
      { onStart: (text) => this.onSpeechStart(text), onSpeaking: (on) => this.onSpeaking(on) },
    );
    this.timers = new TimerBank(
      () => platform.now(),
      (ms) => platform.sleep(ms),
      () => platform.rand(),
      { onChange: (timers) => this.patch({ timers }), onDone: (t) => this.onTimerDone(t) },
    );
    const host = this.makeHost();
    this.scanFlow = new ScanFlow(host, (outcome) => this.afterScan(outcome));
    this.looksFlow = new LooksFlow(host);
    this.productFlow = new ProductFlow(host);
  }

  // ===================================================================== store

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): MirrorState => this.state;

  private patch(p: Partial<MirrorState>): void {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  private patchVoice(p: Partial<MirrorState["voice"]>): void {
    this.patch({ voice: { ...this.state.voice, ...p } });
  }

  /** Change the remembered data and save it. */
  private update(fn: (d: PersistedData) => PersistedData): void {
    const data = fn(this.state.data);
    this.platform.store.save(data);
    this.patch({ data, persistent: this.platform.store.persistent });
  }

  private initialState(): MirrorState {
    const { speaker, eyes, ear } = this.platform;
    return {
      phase: "booting",
      // a fixed seed keeps the first render identical on the server and in the browser
      data: defaultData(() => 0),
      persistent: false,
      status: null,
      panel: "home",
      sheet: null,
      voice: { speaking: false, ear: ear.available ? "idle" : "unsupported", listening: false, interim: "", ttsAvailable: speaker.available },
      camera: { state: eyes.state, detector: eyes.detector },
      captions: [],
      thinking: false,
      scan: { name: "idle" },
      report: null,
      verify: null,
      looks: { selected: null, status: "idle", coach: null },
      product: { status: "idle" },
      timers: [],
      pending: null,
      uploadOffered: eyes.state === "denied" || eyes.state === "unavailable",
      notice: null,
    };
  }

  private get settings(): Settings {
    return this.state.data.settings;
  }

  private get lang(): Language {
    return this.state.data.settings.language;
  }

  private get awake(): boolean {
    return this.state.phase === "awake";
  }

  private get ritualActive(): boolean {
    return this.state.data.ritual?.status === "active";
  }

  private activeRitual(): RitualState | null {
    const r = this.state.data.ritual;
    return r && r.status === "active" ? r : null;
  }

  private makeHost(): Host {
    return {
      platform: this.platform,
      state: () => this.state,
      patch: (p) => this.patch(p),
      update: (fn) => this.update(fn),
      lang: () => this.lang,
      line: (id, params, opts) => this.line(id, params, opts),
      text: (text, opts) => this.say(text, opts),
      address: (kind) => this.address(kind),
      ask: (p) => this.ask(p),
      speaking: () => this.speech.speaking,
      idle: () => this.speech.idle(),
      ensureStatus: () => this.ensureStatus(),
      ensureCamera: () => this.ensureCamera(),
      notice: (key) => this.notice(key),
    };
  }

  // ================================================================== lifecycle

  /** Load what was remembered and wire up the camera and microphone. Safe to call twice. */
  init(): void {
    if (this.state.phase !== "booting" || this.disposed) return;
    const { store, eyes, ear, speaker } = this.platform;
    const data = store.load(this.platform.now(), () => this.platform.rand());
    this.unsubs.push(eyes.subscribe(() => this.onCamera()));
    this.unsubs.push(
      ear.subscribe({
        interim: (text) => this.patchVoice({ interim: text }),
        final: (text) => {
          this.patchVoice({ interim: "" });
          void this.hear(text, "voice");
        },
        state: (s) => this.onEarState(s),
      }),
    );
    this.patch({
      data,
      persistent: store.persistent,
      phase: "welcome",
      camera: { state: eyes.state, detector: eyes.detector },
      voice: { ...this.state.voice, ttsAvailable: speaker.available, ear: ear.available ? "idle" : "unsupported" },
    });
    void this.ensureStatus();
  }

  /**
   * The first tap of a visit. Browsers only let a page speak or listen after a gesture, so the
   * greeting is the very first thing said and nothing before it waits on the camera.
   */
  wake(): void {
    if (this.state.phase !== "welcome" && this.state.phase !== "asleep") return;
    const returning = this.settings.welcomed;
    this.turn += 1;
    this.patch({ phase: "awake", sheet: null });
    this.update((d) => touch(withSettings(d, { welcomed: true }), this.platform.now()));
    this.line(returning ? "welcome_back" : "welcome", this.address("greeting"));

    const ritual = this.activeRitual();
    if (ritual) {
      this.patch({ panel: "ritual" });
      const next = nextSlot(ritual);
      if (next) this.line("next_step", { slot: next });
    } else if (this.platform.ear.available && this.settings.handsFree) {
      this.line("ready", {});
    }
    if (!this.platform.ear.available) this.line("mic_unsupported", {});

    this.micNoticed = false;
    this.patchVoice({ listening: this.settings.handsFree && this.platform.ear.available });
    this.syncEar();
    void this.ensureCamera();
  }

  /** Rest the mirror: camera and microphone off, voice quiet. Timers keep running. */
  rest(): void {
    if (!this.awake) return;
    this.cancelFlows();
    this.speech.cancel();
    this.platform.eyes.stop();
    this.patch({ phase: "asleep", sheet: null });
    this.syncEar();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.syncEar();
  }

  dispose(): void {
    this.disposed = true;
    for (const u of this.unsubs.splice(0)) u();
    this.cancelFlows();
    this.timers.dispose();
    this.speech.cancel();
    this.platform.eyes.stop();
    this.platform.ear.stop();
    this.listeners.clear();
  }

  private cancelFlows(): void {
    this.scanFlow.cancel();
    this.looksFlow.cancel();
    this.productFlow.cancel();
  }

  // ==================================================================== speaking

  private address(kind: TurnKind = "normal"): { title?: string } {
    return shouldUseTitle(this.turn, kind) ? { title: titleFor(this.settings) } : {};
  }

  private addressTitle(): string | undefined {
    return shouldUseTitle(this.turn) ? titleFor(this.settings) : undefined;
  }

  private line<K extends LineId>(id: K, params: LineParams[K], opts?: SayOptions): void {
    this.speech.say(renderLine(this.lang, id, params), opts);
  }

  private say(text: string, opts?: SayOptions): void {
    this.speech.say(text, opts);
  }

  private onSpeechStart(text: string): void {
    this.turnLines.push(text);
    this.caption("mirror", text);
  }

  private onSpeaking(speaking: boolean): void {
    this.patchVoice({ speaking });
    this.syncEar();
  }

  private caption(who: Caption["who"], text: string): void {
    const c: Caption = { id: (this.captionSeq += 1), who, text, at: this.platform.now() };
    this.patch({ captions: [...this.state.captions, c].slice(-MAX_CAPTIONS) });
  }

  private notice(key: NoticeKey): void {
    const seq = (this.noticeSeq += 1);
    this.patch({ notice: key });
    void this.platform.sleep(NOTICE_MS).then(() => {
      if (seq === this.noticeSeq && !this.disposed) this.patch({ notice: null });
    });
  }

  // ======================================================================= ears

  /** Half-duplex: the microphone is open only while the mirror is quiet, so it never hears itself. */
  private syncEar(): void {
    const { ear } = this.platform;
    const v = this.state.voice;
    const want = this.awake && this.visible && ear.available && v.listening && !v.speaking && v.ear !== "blocked" && v.ear !== "unsupported";
    if (want) ear.start(this.lang);
    else ear.stop();
  }

  private onEarState(s: EarState): void {
    this.patchVoice({ ear: s });
    if (s === "blocked" && !this.micNoticed) {
      this.micNoticed = true;
      this.patchVoice({ listening: false });
      this.line("mic_blocked", {});
    } else if (s === "unsupported" && !this.micNoticed) {
      this.micNoticed = true;
      this.line("mic_unsupported", {});
    }
    this.syncEar();
  }

  /** The microphone button: listen hands-free, or not. Remembered for next time. */
  toggleListening(): void {
    const on = !this.state.voice.listening;
    this.micNoticed = false;
    const retry = this.state.voice.ear === "blocked" || this.state.voice.ear === "error";
    this.patchVoice({ listening: on, ear: on && retry ? "idle" : this.state.voice.ear });
    this.update((d) => withSettings(d, { handsFree: on }));
    this.syncEar();
  }

  private onCamera(): void {
    const { eyes } = this.platform;
    this.patch({ camera: { state: eyes.state, detector: eyes.detector }, uploadOffered: eyes.state === "denied" || eyes.state === "unavailable" });
  }

  private async ensureCamera(): Promise<CameraState> {
    const { eyes } = this.platform;
    if (eyes.state === "on") return "on";
    return eyes.start();
  }

  // ===================================================================== status

  private ensureStatus(): Promise<StatusResponse | null> {
    if (this.state.status) return Promise.resolve(this.state.status);
    if (this.statusLoad) return this.statusLoad;
    const now = this.platform.now();
    if (now - this.statusAt < STATUS_RETRY_MS) return Promise.resolve(null);
    return this.loadStatus();
  }

  private loadStatus(): Promise<StatusResponse | null> {
    this.statusAt = this.platform.now();
    const load = this.platform.api
      .status()
      .then((s) => {
        if (s && !this.disposed) this.patch({ status: s });
        return s;
      })
      .finally(() => {
        this.statusLoad = null;
      });
    this.statusLoad = load;
    return load;
  }

  /** Ask the server again how it is doing (after a budget or outage message). */
  private refreshStatus(): void {
    if (!this.statusLoad) void this.loadStatus();
  }

  // ================================================================== questions

  private ask(p: Pending): void {
    const now = this.platform.now();
    const e = entry(p, now);
    this.pending = e;
    if (p.kind === "retry") this.retryMemo = { what: p.what, look: p.look, at: now };
    this.patch({ pending: p.kind });
    void this.platform.sleep(e.expiresAt - now + 25).then(() => {
      if (this.pending === e) this.dropPending();
    });
  }

  private reask(p: PendingEntry): void {
    this.ask(plain(p));
  }

  private dropPending(): void {
    if (!this.pending) return;
    this.pending = null;
    this.patch({ pending: null });
  }

  private currentPending(): PendingEntry | null {
    const p = live(this.pending, this.platform.now());
    if (!p && this.pending) this.dropPending();
    return p;
  }

  /** The "Yes" and "Not now" chips, and the spoken yes and no, land here. */
  reply(yes: boolean): void {
    this.turn += 1;
    const p = this.currentPending();
    if (!p) return;
    this.dropPending();
    switch (p.kind) {
      case "forget":
        return yes ? this.eraseAll() : this.line("ack_no", {});
      case "focus":
        return yes ? this.line("report_focus", { label: concernLabel(p.focus, this.lang) }) : this.line("report_decline", {});
      case "verify_offer":
        return yes ? this.verify() : this.line("ack_no", {});
      case "verify_anyway":
        return yes ? this.verify(true) : this.line("ack_no", {});
      case "scan_offer":
        return yes ? this.startScan() : this.line("ack_no", {});
      case "confirm_product":
        return yes ? this.logProduct(p.name, p.category) : this.line("ask_potion", {});
      case "look_coach":
        return yes ? this.looksFlow.startCoach(p.look) : this.line("ack_no", {});
      case "retry":
        return yes ? this.retryNow(p.what, p.look) : this.line("ack_no", {});
      case "consent_scan":
      case "consent_look":
        if (!yes) return this.line("ack_no", {});
        // consent is a tap on the card, never a spoken word: say so, keep the card up
        this.reask(p);
        return this.line(p.kind === "consent_scan" ? "consent_scan_needed" : "consent_look_needed", {});
      case "category":
        if (!yes) return this.line("ack_no", {});
        this.reask(p);
        return this.line("ask_category", {});
    }
  }

  private answerCategory(category: Category): void {
    const p = this.currentPending();
    if (!p || p.kind !== "category") return;
    this.dropPending();
    if (p.then === "track") this.trackProduct(p.name, category);
    else this.logProduct(p.name, category);
  }

  // ====================================================================== hearing

  /** Something the person said or typed. */
  async hear(raw: string, via: "voice" | "typed" = "voice"): Promise<void> {
    const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_UTTERANCE);
    if (!text || !this.awake || this.disposed) return;
    // the microphone is closed while the mirror talks, so anything that slips through is its own echo
    if (via === "voice" && this.speech.speaking) return;

    this.turn += 1;
    this.hearToken += 1;
    if (this.turnLines.length > 0) this.prevTurnLines = this.turnLines;
    this.turnLines = [];
    this.caption("you", text);
    this.speech.cancel();

    const p = this.currentPending();
    const parserPending: ParserPending = p ? (p.kind === "category" ? "ask_category" : "yes_no") : null;
    const parsed = parseIntents(text, { ritualActive: this.ritualActive, pending: parserPending, now: new Date(this.platform.now()) });
    if (parsed) return this.execute(parsed);
    if (isRetry(text) && this.retryAvailable()) return this.retry();
    await this.plan(text);
  }

  private execute(intents: readonly Intent[]): void {
    for (const it of intents) this.run(it);
  }

  private run(it: Intent): void {
    if (!NON_CANCELLING.has(it.type)) this.dropPending();
    switch (it.type) {
      case "yes":
        return this.reply(true);
      case "no":
        return this.reply(false);
      case "category":
        return this.answerCategory(it.category);
      case "hush":
        return this.hush();
      case "greet":
        return this.line("greet", this.address("greeting"));
      case "thanks":
        return this.line("thanks", this.address());
      case "settings":
        return this.openSettings(true);
      case "repeat":
        return this.repeat();
      case "none":
        return;
      case "start_ritual":
        return this.startRitual(it.period);
      case "log_product":
        return this.logProduct(it.name, it.category);
      case "skip_step":
        return this.skipStep();
      case "finish_ritual":
        return this.finishRitual();
      case "start_scan":
        return this.startScan();
      case "verify":
        return this.verify();
      case "show_report":
        return this.showReport();
      case "try_look":
        return this.tryLook(it.look);
      case "show_ledger":
        return this.showLedger();
      case "track_product":
        return this.trackProduct(it.name, it.category);
      case "set_language":
        return this.setLanguage(it.language);
      case "set_title":
        return this.setCustomTitle(it.title);
      case "start_timer":
        return this.startTimer(it.seconds);
      case "stop_timer":
        return this.stopTimers();
      case "look_at_product":
        return this.lookAtProduct();
      case "forget_me":
        return this.askForget();
      default: {
        const unreachable: never = it;
        void unreachable;
      }
    }
  }

  private async plan(text: string): Promise<void> {
    const status = this.state.status;
    if (!status || status.llm !== "live") {
      this.line("didnt_catch", this.address());
      return;
    }
    const token = this.hearToken;
    this.thinkers += 1;
    this.patch({ thinking: true });
    const res = await this.platform.api.chat({
      mode: "plan",
      lang: this.lang,
      title: this.addressTitle(),
      utterance: text,
      history: this.historyForModel(),
      state: this.stateForModel(),
    });
    this.thinkers -= 1;
    this.patch({ thinking: this.thinkers > 0 });
    if (this.disposed || token !== this.hearToken) return; // the person has already moved on

    if (!res.ok) {
      if (res.error === "llm_off" && this.state.status) this.patch({ status: { ...this.state.status, llm: "off" } });
      else this.brainNote();
      this.line("didnt_catch", this.address());
      return;
    }
    const actions: Action[] = res.actions.filter((a) => a.type !== "none");
    if (res.say) this.say(res.say);
    if (actions.length > 0) this.execute(actions);
    else if (!res.say) this.line("didnt_catch", this.address());
  }

  private brainNote(): void {
    const now = this.platform.now();
    if (now - this.brainNoteAt < BRAIN_NOTE_EVERY_MS) return;
    this.brainNoteAt = now;
    this.line("brain_offline", {});
  }

  private historyForModel(): NonNullable<ChatRequest["history"]> {
    // the sentence just heard is sent separately, so it is left out of the history
    return this.state.captions
      .slice(0, -1)
      .slice(-6)
      .map((c) => ({ role: c.who === "you" ? ("user" as const) : ("mirror" as const), text: c.text.slice(0, 300) }));
  }

  private stateForModel(): NonNullable<ChatRequest["state"]> {
    const d = this.state.data;
    const r = d.ritual;
    const last = lastScan(d);
    return {
      period: this.periodNow(),
      ritual: r
        ? {
            status: r.status,
            applied: r.applied.slice(0, 20).map((a) => ({ name: a.name.slice(0, 60), category: a.category })),
            next: r.status === "active" ? nextSlot(r) : null,
            skipped: r.skipped.slice(0, 12),
          }
        : null,
      hasScan: last !== null,
      scanSource: last?.source,
      tracked: d.tracked.slice(0, 12).map((t) => t.name.slice(0, 60)),
    };
  }

  private periodNow(): Period {
    return periodFromHour(new Date(this.platform.now()).getHours());
  }

  /** "Be quiet": silence the mirror, and back out of a scan that has not been sent yet. */
  private hush(): void {
    this.speech.cancel();
    if (this.scanFlow.cancellable) {
      this.scanFlow.cancel();
      this.patch({ panel: "home" });
    }
  }

  private repeat(): void {
    if (this.looksFlow.repeat()) return;
    const lines = this.prevTurnLines.slice(-3);
    if (lines.length === 0) {
      this.line("greet", this.address("greeting"));
      return;
    }
    for (const l of lines) this.say(l);
  }

  // ====================================================================== scans

  startScan(): void {
    this.turn += 1;
    this.scanIntent = { purpose: "scan" };
    this.runScan();
  }

  private runScan(file?: File): void {
    if (this.scanFlow.active) return this.notice("busy");
    this.patch({ panel: "scan" });
    void this.scanFlow.run({ purpose: this.scanIntent.purpose, ritualId: this.scanIntent.ritualId, ...(file ? { file } : {}) });
  }

  /** A photo from the device, for when the camera is not an option. */
  scanFile(file: File): void {
    this.turn += 1;
    this.runScan(file);
  }

  /** The "capture now" button during framing. */
  captureNow(): void {
    this.scanFlow.captureNow();
  }

  /** Close the scan screen (and drop whatever was under way). */
  cancelScan(): void {
    this.scanFlow.cancel();
    this.speech.cancel();
    this.patch({ panel: this.state.report ? "report" : "home" });
  }

  /** "Try again" after a failed scan, look or reading. */
  retry(): void {
    this.turn += 1;
    const m = this.retryMemo;
    this.dropPending();
    if (!m) return;
    this.retryNow(m.what, m.look);
  }

  private retryAvailable(): boolean {
    return this.retryMemo !== null && this.platform.now() - this.retryMemo.at < RETRY_WINDOW_MS;
  }

  private retryNow(what: "scan" | "verify" | "look" | "product", look?: LookId): void {
    this.retryMemo = null;
    if (what === "look") {
      if (look) void this.looksFlow.preview(look);
      return;
    }
    if (what === "product") return this.lookAtProduct();
    this.scanIntent = { ...this.scanIntent, purpose: what === "verify" ? "verify" : "scan" };
    this.runScan();
  }

  private afterScan(o: ScanOutcome): void {
    this.update((d) => addScan(d, o.scan));
    if (o.sampleReason === "budget" || o.sampleReason === "unavailable") this.refreshStatus();
    const before = this.scanIntent.before;
    if (o.purpose === "verify" && before) this.presentVerify(before, o.scan, o.sampleReason);
    else this.presentReport(o.scan, o.sampleReason);
    this.scanIntent = { purpose: "scan" };
  }

  private reportView(scan: SkinScan, sampleReason?: SampleReason): ReportView {
    const sf = strengthAndFocus(scan.scores);
    const reason = scan.source === "demo" ? (sampleReason ?? "no_key") : undefined;
    return { scan, strength: sf.strength, focus: sf.focus, allHigh: sf.allHigh, ...(reason ? { sampleReason: reason } : {}) };
  }

  private presentReport(scan: SkinScan, sampleReason?: SampleReason): void {
    const view = this.reportView(scan, sampleReason);
    this.patch({ report: view, panel: "report" });
    this.turn += 1;

    // samples are announced first, so no number is ever mistaken for a measurement
    if (view.sampleReason === "budget") this.line("scan_budget", {});
    else if (view.sampleReason === "unavailable") this.line("scan_error", { kind: "unavailable" });
    else if (view.sampleReason) this.line("scan_demo_notice", {});

    if (view.allHigh) this.line("report_all_high", {});
    else if (view.strength) this.line("report_strength", { label: concernLabel(view.strength, this.lang), ...this.address("win") });
    if (scan.source === "youcam" && scan.confidence.level !== "high") this.line("report_uncertainty", {});
    if (view.focus && !view.allHigh) {
      this.line("report_ask_focus", {});
      this.ask({ kind: "focus", focus: view.focus });
    }
  }

  showReport(): void {
    this.turn += 1;
    const last = lastScan(this.state.data);
    if (!last) {
      this.line("report_none", {});
      this.ask({ kind: "scan_offer" });
      return;
    }
    this.presentReport(last);
  }

  // ===================================================================== verify

  /** The anchor a second look is measured against: the open ritual, or one finished recently. */
  private verifyAnchor(): { since: number | null; ritualId?: string } {
    const d = this.state.data;
    if (d.ritual) return { since: d.ritual.startedAt, ritualId: d.ritual.id };
    const last = d.history[d.history.length - 1];
    if (last && this.platform.now() - last.finishedAt < VERIFY_WINDOW_MS) return { since: last.startedAt, ritualId: last.id };
    return { since: null };
  }

  verify(measureAnyway = false): void {
    this.turn += 1;
    if (this.scanFlow.active) return this.notice("busy");
    const d = this.state.data;
    const anchor = this.verifyAnchor();
    const before = anchor.since !== null ? scanBefore(d, anchor.since) : lastScan(d);
    if (!before) {
      this.line("verify_no_baseline", {});
      this.ask({ kind: "scan_offer" });
      return;
    }
    const minutes = Math.round((this.platform.now() - before.at) / 60_000);
    if (!measureAnyway && minutes < SAME_SITTING_MINUTES) {
      // honest by default: a second look this soon says little, so the mirror says so and asks
      this.line("verify_too_soon", { minutes: Math.max(1, SAME_SITTING_MINUTES - minutes) });
      this.ask({ kind: "verify_anyway" });
      return;
    }
    this.scanIntent = { purpose: "verify", ritualId: anchor.ritualId, before };
    this.runScan();
  }

  private presentVerify(before: SkinScan, after: SkinScan, sampleReason?: SampleReason): void {
    const comparison = compareScans(before, after);
    this.patch({ verify: { before, after, comparison }, panel: "verify" });
    this.turn += 1;

    const better = comparison.deltas
      .filter((x) => x.cls === "better" || x.cls === "slightly_better")
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .map((x) => x.key);
    const softer = comparison.deltas
      .filter((x) => x.cls === "lower" || x.cls === "slightly_lower")
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 2)
      .map((x) => x.key);

    if (better.length > 0) this.line("verify_better", { label: joinLabels(better, this.lang) });
    if (softer.length > 0) this.line("verify_softer", { label: joinLabels(softer, this.lang) });
    if (better.length === 0 && softer.length === 0) this.line("verify_same", {});
    if (comparison.caveats.some((c) => c === "same_sitting" || c === "lighting_changed" || c === "low_confidence")) this.line("verify_caveat", {});
    if (comparison.caveats.includes("demo")) {
      if (sampleReason === "budget") this.line("scan_budget", {});
      else this.line("scan_demo_notice", {});
    }
  }

  // ====================================================================== ritual

  startRitual(period?: Period): void {
    this.turn += 1;
    const want = period ?? this.periodNow();
    const open = this.activeRitual();
    this.patch({ panel: "ritual" });
    if (open && open.period === want) {
      const next = nextSlot(open);
      if (next) this.line("next_step", { slot: next });
      else this.line("ask_potion", {});
      return;
    }
    if (open) this.update((d) => recordRitual(d, open, this.platform.now())); // a different one was left open: file it away
    const ritual = createRitual(want, this.platform.now(), randomId("r", this.platform.now(), () => this.platform.rand()));
    this.update((d) => setRitual(d, ritual));
    this.line("ritual_start", { period: want, ...this.address("greeting") });
  }

  logProduct(rawName: string, category?: Category): void {
    this.turn += 1;
    const name = cleanProductName(rawName, "label");
    if (!name) {
      this.line("ask_potion", {});
      return;
    }
    const cat = category ?? classifyProduct(name)?.category;
    if (!cat) {
      this.ask({ kind: "category", name, then: "log" });
      this.line("ask_category", {});
      return;
    }
    this.patch({ panel: "ritual", product: { status: "idle" } });

    let ritual = this.activeRitual();
    if (!ritual) {
      // applying something before saying "start my ritual" is the most natural thing in the world
      const now = this.platform.now();
      ritual = createRitual(this.periodNow(), now, randomId("r", now, () => this.platform.rand()));
    }
    const result = applyProduct(ritual, { name, category: cat }, this.platform.now());
    this.update((d) => setRitual(d, result.state));
    this.line("product_noted", { name: speakableProductName(name, cat) });
    if (result.duplicate) return;

    // one calm sentence at a time: the most useful two notes, never a lecture
    for (const note of result.notes.slice(0, 2)) this.sayNote(note);

    if (result.next === null) {
      this.completeRitual();
      return;
    }
    if (result.timer) {
      const t = this.timers.start(result.timer.kind, result.timer.seconds);
      this.timerThen.set(t.id, result.next);
      this.line("timer_start", { seconds: result.timer.seconds, kind: result.timer.kind });
    } else {
      this.line("next_step", { slot: result.next });
    }
  }

  private sayNote(n: Note): void {
    this.line("note", { code: n.code, slot: n.slot, after: n.after });
  }

  skipStep(): void {
    this.turn += 1;
    if (this.looksFlow.next()) return; // "next" while a look is being coached moves the coach
    const r = this.activeRitual();
    if (!r) {
      this.line("ritual_none_active", {});
      return;
    }
    const res = skipSlot(r);
    if (!res.skipped) {
      this.completeRitual();
      return;
    }
    this.update((d) => setRitual(d, res.state));
    this.line("ritual_skipped", { slot: res.skipped });
    const next = nextSlot(res.state);
    if (next) this.line("next_step", { slot: next });
    else this.completeRitual();
  }

  finishRitual(): void {
    this.turn += 1;
    this.completeRitual();
  }

  private completeRitual(): void {
    const r = this.activeRitual();
    if (!r) {
      this.line("ritual_none_active", {});
      return;
    }
    const closed = closeRitual(r);
    const offerSecondLook = scanBefore(this.state.data, r.startedAt) !== null;
    this.update((d) => recordRitual(d, closed.state, this.platform.now()));
    for (const n of closed.notes) this.sayNote(n);
    if (offerSecondLook) {
      this.line("ritual_complete", this.address("win"));
      this.ask({ kind: "verify_offer" });
    } else {
      this.line("ritual_complete_plain", this.address("win"));
    }
  }

  // ====================================================================== timers

  startTimer(seconds: number): void {
    this.turn += 1;
    const s = Math.max(5, Math.min(1800, Math.round(seconds)));
    const t = this.timers.start("custom", s);
    this.timerThen.set(t.id, null);
    this.line("timer_start", { seconds: s, kind: "custom" });
  }

  stopTimers(): void {
    this.turn += 1;
    this.timers.stopAll();
    this.timerThen.clear();
    this.line("timer_stopped", {});
  }

  private onTimerDone(t: TimerView): void {
    this.platform.chime?.();
    this.line("timer_done", { kind: t.kind });
    const then = this.timerThen.get(t.id);
    this.timerThen.delete(t.id);
    if (then && this.activeRitual()) this.line("next_step", { slot: then });
  }

  // ================================================================ looks, labels

  tryLook(look?: LookId): void {
    this.turn += 1;
    if (!look) return this.looksFlow.open();
    void this.looksFlow.preview(look);
  }

  /** The "Coach me through it" button on a look. */
  coachLook(look: LookId): void {
    this.turn += 1;
    this.looksFlow.startCoach(look);
  }

  /** The "Turn the camera on" button, for a camera that is off or was blocked and is now allowed. */
  startCamera(): void {
    void this.ensureCamera();
  }

  /** "Next" on the screen while a look is being coached. */
  coachNext(): void {
    this.turn += 1;
    this.looksFlow.next();
  }

  lookAtProduct(): void {
    this.turn += 1;
    void this.productFlow.run();
  }

  // ====================================================================== ledger

  showLedger(): void {
    this.turn += 1;
    const d = this.state.data;
    this.patch({ panel: "ledger" });
    const rows = ledgerRows(d.tracked, d.scans, this.platform.now(), this.lang);
    if (rows.length === 0) {
      this.line("ledger_empty", {});
      return;
    }
    // the screen shows every product; the voice gives the two newest, one sentence each
    for (const row of rows.slice(0, 2)) this.say(row.headline);
    const caveat = rows.slice(0, 2).find((r) => r.caveat)?.caveat;
    if (caveat) this.say(caveat);
  }

  trackProduct(rawName: string, category?: Category): void {
    this.turn += 1;
    const name = cleanProductName(rawName, "label");
    if (!name) {
      this.line("ask_potion", {});
      return;
    }
    const cat = category ?? classifyProduct(name)?.category;
    if (!cat) {
      this.ask({ kind: "category", name, then: "track" });
      this.line("ask_category", {});
      return;
    }
    this.update((d) => startTracking(d, { name, category: cat }, this.platform.now(), () => this.platform.rand()).data);
    this.line("track_started", { product: speakableProductName(name, cat) });
    this.patch({ panel: "ledger" });
  }

  stopTrackingProduct(id: string): void {
    this.update((d) => stopTracking(d, id));
  }

  // ==================================================================== settings

  openPanel(panel: Panel): void {
    this.patch({ panel });
  }

  openSettings(open: boolean): void {
    this.patch({ sheet: open ? "settings" : null });
  }

  setLanguage(language: Language): void {
    if (language === this.lang) {
      if (this.awake) this.line("language_changed", {});
      return;
    }
    this.looksFlow.cancel(); // a recipe in the old language would be confusing
    this.update((d) => withSettings(d, { language }));
    if (!this.awake) return;
    this.speech.cancel();
    this.line("language_changed", {});
    this.platform.ear.stop();
    this.syncEar();
  }

  setTitleId(titleId: string): void {
    this.update((d) => withSettings(d, { titleId }));
  }

  setCustomTitle(raw: string): void {
    const title = cleanCustomTitle(raw);
    if (title.length < 2 || !lintUtterance(title).ok) {
      if (this.awake) this.line("didnt_catch", this.address());
      return;
    }
    this.update((d) => withSettings(d, { titleId: "custom", customTitle: title }));
    if (this.awake) this.line("title_set", { title });
  }

  setPace(pace: Pace): void {
    this.update((d) => withSettings(d, { pace }));
  }

  setVoice(voiceUri: string): void {
    this.update((d) => withSettings(d, { voiceUri }));
  }

  setKiosk(kiosk: boolean): void {
    this.update((d) => withSettings(d, { kiosk }));
  }

  // ===================================================================== consent

  /** A photo may be sent to YouCam (scan, look preview), or a bottle frame to the vision model. */
  grantConsent(kind: ConsentKind): void {
    this.update((d) => withSettings(d, kind === "scan" ? { consentScan: true } : { consentLook: true }));
    const p = this.currentPending();
    if (!p) return;
    if (p.kind === "consent_scan" && kind === "scan") {
      this.dropPending();
      const r = p.resume;
      if (r.what === "look") void this.looksFlow.preview(r.look);
      else {
        this.scanIntent = { ...this.scanIntent, purpose: r.what };
        this.runScan();
      }
    } else if (p.kind === "consent_look" && kind === "look") {
      this.dropPending();
      this.lookAtProduct();
    }
  }

  revokeConsent(kind: ConsentKind): void {
    this.update((d) => withSettings(d, kind === "scan" ? { consentScan: false } : { consentLook: false }));
  }

  /** "Not now" on a consent card. */
  declineConsent(): void {
    const p = this.currentPending();
    if (p && (p.kind === "consent_scan" || p.kind === "consent_look")) {
      this.dropPending();
      this.line("ack_no", {});
    }
  }

  // ======================================================================= forget

  askForget(): void {
    this.turn += 1;
    this.ask({ kind: "forget" });
    this.line("forget_confirm", {});
  }

  /** Erase everything on this device: scans, ledger, rituals, settings, conversation. */
  private eraseAll(): void {
    const lang = this.lang;
    this.cancelFlows();
    this.timers.stopAll();
    this.timerThen.clear();
    this.dropPending();
    this.retryMemo = null;
    this.speech.cancel();
    this.platform.eyes.stop();
    this.platform.store.erase();
    this.captionSeq = 0;
    this.prevTurnLines = [];
    this.turnLines = [];
    this.scanIntent = { purpose: "scan" };
    this.patch({
      data: defaultData(() => this.platform.rand()),
      persistent: this.platform.store.persistent,
      phase: "welcome",
      panel: "home",
      sheet: null,
      captions: [],
      report: null,
      verify: null,
      looks: { selected: null, status: "idle", coach: null },
      product: { status: "idle" },
      scan: { name: "idle" },
      timers: [],
      thinking: false,
    });
    this.syncEar();
    // the settings are back to their defaults, but the goodbye is said in the language it was asked in
    this.speech.say(renderLine(lang, "forgotten", {}), { lang });
  }
}
