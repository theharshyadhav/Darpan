import { classifyProduct, cleanProductName, speakableProductName } from "@/lib/ritual/products";
import type { Host } from "../host";

/**
 * "What am I holding?": the person holds a bottle up to the mirror, one frame is read by a vision
 * model (only after they allowed it), and the mirror says what it thinks it is and asks. A name
 * read off a label is the bottle's own text, so it is shown as written and spoken only when it
 * passes the claim linter (otherwise the plain category is said instead).
 */

const HOLD_MS = 2200;

export class ProductFlow {
  private token = 0;

  constructor(private readonly host: Host) {}

  get busy(): boolean {
    const s = this.host.state().product.status;
    return s === "holding" || s === "reading";
  }

  cancel(): void {
    this.token += 1;
    if (this.busy) this.host.patch({ product: { status: "idle" } });
  }

  async run(): Promise<void> {
    const h = this.host;
    if (this.busy) {
      h.notice("busy");
      return;
    }
    const token = ++this.token;
    const alive = () => token === this.token;

    const status = await h.ensureStatus();
    if (!alive()) return;
    if (!status?.vision) {
      h.line("look_failed", {});
      return;
    }
    if (!h.state().data.settings.consentLook) {
      h.ask({ kind: "consent_look" });
      h.line("consent_look_needed", {});
      return;
    }

    const eyes = h.platform.eyes;
    const cam = eyes.state === "on" ? "on" : await h.ensureCamera();
    if (!alive()) return;
    if (cam !== "on") {
      h.line("camera_denied", {});
      return;
    }

    h.patch({ product: { status: "holding" } });
    h.line("look_hold", {});
    await h.idle();
    if (!alive()) return;
    await h.platform.sleep(HOLD_MS);
    if (!alive()) return;

    h.patch({ product: { status: "reading" } });
    const frame = await eyes.captureLabel();
    if (!alive()) return;
    if (!frame) return this.lost();

    const res = await h.platform.api.lookAtProduct(frame);
    if (!alive()) return;
    if (!res.ok && res.error === "consent") {
      h.patch({ product: { status: "idle" } });
      h.ask({ kind: "consent_look" });
      h.line("consent_look_needed", {});
      return;
    }
    if (res.ok && res.found) {
      const name = cleanProductName(res.name, "label");
      if (!name) return this.lost();
      const category = res.category ?? classifyProduct(name)?.category;
      h.patch({ product: { status: "found", name, category } });
      h.line("look_found_confirm", { name: speakableProductName(name, category ?? "serum") });
      h.ask({ kind: "confirm_product", name, category });
      return;
    }
    this.lost();
  }

  private lost(): void {
    this.host.patch({ product: { status: "notfound" } });
    this.host.line("look_failed", {});
  }
}
