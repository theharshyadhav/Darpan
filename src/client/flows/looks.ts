import { LOOKS, recipeSteps, type LookId } from "@/lib/looks";
import type { ScanErrorKind } from "@/lib/persona/copy";
import type { Host } from "../host";

/**
 * Look Studio: show a makeup look on the person's own face (YouCam's virtual try-on), then coach
 * them through recreating it, one step at a time. With no YouCam key the preview is skipped and
 * the recipe is the whole experience, which is a perfectly good one.
 */

const POLL_TIMEOUT_MS = 70_000;

export class LooksFlow {
  private token = 0;
  private coach: { look: LookId; steps: string[]; index: number } | null = null;

  constructor(private readonly host: Host) {}

  get coaching(): boolean {
    return this.coach !== null;
  }

  get busy(): boolean {
    return this.host.state().looks.status === "rendering";
  }

  /** Open the looks panel and invite a choice. */
  open(): void {
    this.host.patch({ panel: "looks" });
    this.host.line("look_intro", {});
  }

  /** Drop any preview in flight and any coaching in progress. */
  cancel(): void {
    this.token += 1;
    this.coach = null;
    const looks = this.host.state().looks;
    if (looks.status === "rendering" || looks.coach) {
      this.host.patch({ looks: { ...looks, status: looks.status === "rendering" ? "idle" : looks.status, coach: null } });
    }
  }

  async preview(look: LookId): Promise<void> {
    const h = this.host;
    if (this.busy) {
      h.notice("busy");
      return;
    }
    const token = ++this.token;
    const alive = () => token === this.token;
    this.coach = null;
    h.patch({ panel: "looks", looks: { selected: look, status: "rendering", coach: null } });

    const status = await h.ensureStatus();
    if (!alive()) return;
    if (status?.look !== "live") {
      this.recipeOnly(look, status ? "look_demo" : "look_unavailable");
      return;
    }
    if (!h.state().data.settings.consentScan) {
      h.patch({ looks: { selected: look, status: "idle", coach: null } });
      h.ask({ kind: "consent_scan", resume: { what: "look", look } });
      h.line("consent_scan_needed", {});
      return;
    }

    const eyes = h.platform.eyes;
    const cam = eyes.state === "on" ? "on" : await h.ensureCamera();
    if (!alive()) return;
    if (cam !== "on") {
      h.patch({ looks: { selected: look, status: "idle", coach: null } });
      h.line("camera_denied", {});
      return;
    }

    h.line("look_rendering", {});
    const photo = await eyes.capturePhoto();
    if (!alive()) return;
    if (!photo) return this.fail(look, "generic");

    const api = h.platform.api;
    const start = await api.previewStart(look, photo.blob);
    if (!alive()) return;
    if (!start.ok) {
      if (start.error === "unavailable") return this.recipeOnly(look, "look_unavailable");
      return this.fail(look, start.error === "bad_look" ? "generic" : start.error);
    }
    if (start.mode === "demo") return this.recipeOnly(look, "look_demo");

    const began = h.platform.now();
    let delay = start.pollMs;
    for (;;) {
      await h.platform.sleep(delay);
      if (!alive()) return;
      const r = await api.previewPoll(start.ticket);
      if (!alive()) return;
      if (!r.ok) {
        if (r.error === "unavailable") return this.recipeOnly(look, "look_unavailable");
        return this.fail(look, r.error);
      }
      if (r.status === "success") {
        h.patch({ looks: { selected: look, status: "ready", image: r.image, coach: null } });
        h.line("look_ready", { name: LOOKS[look].name[h.lang()], ...h.address("win") });
        h.ask({ kind: "look_coach", look });
        return;
      }
      delay = r.pollMs;
      if (h.platform.now() - began > POLL_TIMEOUT_MS) return this.fail(look, "busy");
    }
  }

  private recipeOnly(look: LookId, why: "look_demo" | "look_unavailable"): void {
    this.host.patch({ looks: { selected: look, status: "demo", coach: null } });
    this.host.line(why, {});
    this.startCoach(look);
  }

  private fail(look: LookId, kind: ScanErrorKind): void {
    const h = this.host;
    h.patch({ looks: { selected: look, status: "error", error: kind, coach: null } });
    h.line("scan_error", { kind });
    h.ask({ kind: "retry", what: "look", look });
  }

  // ----------------------------------------------------------------- coaching

  startCoach(look: LookId): void {
    const h = this.host;
    const steps = recipeSteps(LOOKS[look], h.lang());
    this.coach = { look, steps, index: 0 };
    h.patch({ looks: { ...h.state().looks, selected: look, coach: { index: 0 } } });
    h.line("look_steps_intro", { name: LOOKS[look].name[h.lang()] });
    h.text(steps[0]!);
  }

  /** "Next": returns false when there is nothing being coached, so the caller can treat it as a ritual skip. */
  next(): boolean {
    const c = this.coach;
    if (!c) return false;
    const h = this.host;
    const index = c.index + 1;
    if (index >= c.steps.length) {
      this.coach = null;
      h.patch({ looks: { ...h.state().looks, coach: null } });
      h.line("look_done", {});
      return true;
    }
    c.index = index;
    h.patch({ looks: { ...h.state().looks, coach: { index } } });
    h.text(c.steps[index]!);
    return true;
  }

  /** "Say that again" while coaching repeats the current step. */
  repeat(): boolean {
    const c = this.coach;
    if (!c) return false;
    this.host.text(c.steps[c.index]!);
    return true;
  }
}
