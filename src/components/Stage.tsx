"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { getPlatform } from "@/client/browser/use-mirror";
import { HINT_LINE } from "@/client/flows/hints";
import { line } from "@/lib/persona/copy";
import { ArchFrame, Orb, type OrbState } from "./Arch";
import { CameraIcon, UploadIcon } from "./icons";
import { useMirrorCtx } from "./mirror-context";

/**
 * The mirror: the live camera in a palace arch, with the gem orb above it. Everything a scan needs
 * on screen (the spoken hint, the steady-hold bar, the countdown, "capture now", errors) is drawn
 * over the arch, so the person never has to look away from their own face.
 */
export function Stage() {
  const { ctl, state, t } = useMirrorCtx();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  const { camera, scan, voice, looks } = state;
  const awake = state.phase === "awake";

  // show the live stream in the visible mirror whenever the camera state changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const stream = getPlatform()?.eyes.stream ?? null;
    if (v.srcObject !== stream) {
      v.srcObject = stream;
      if (stream) void v.play().catch(() => {});
    }
  }, [camera, state.phase]);

  const orb: OrbState = !awake
    ? "resting"
    : state.thinking || scan.name === "analyzing" || scan.name === "preparing"
      ? "thinking"
      : voice.speaking
        ? "speaking"
        : voice.listening && voice.ear === "listening"
          ? "listening"
          : "idle";
  const orbLabel = t(orb === "listening" ? "orb_listening" : orb === "speaking" ? "orb_speaking" : orb === "thinking" ? "orb_thinking" : orb === "resting" ? "mirror_resting" : "orb_idle");

  const cameraOn = camera.state === "on";
  const preview = looks.image && looks.status === "ready" && !showOriginal ? looks.image : null;
  const openPicker = () => fileRef.current?.click();

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) ctl.scanFile(f);
  };

  return (
    <div className="relative pt-7">
      <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2">
        <Orb state={orb} label={orbLabel} />
      </div>

      <div className="arch">
        <div className="arch-clip">
          <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" style={{ opacity: cameraOn && awake ? 1 : 0 }} />
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="look" src={preview} alt={t("look_preview")} />
          )}

          {!cameraOn && <CameraFallback onUpload={openPicker} />}
          {cameraOn && awake && <ScanOverlay onUpload={openPicker} />}

          {looks.image && looks.status === "ready" && (
            <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center">
              <div role="group" className="flex gap-1 rounded-full bg-white/90 p-1 text-sm shadow">
                <button type="button" aria-pressed={!showOriginal} onClick={() => setShowOriginal(false)} className={`min-h-9 rounded-full px-3 font-semibold ${!showOriginal ? "bg-rani-ink text-white" : "text-ink-soft"}`}>
                  {t("look_preview")}
                </button>
                <button type="button" aria-pressed={showOriginal} onClick={() => setShowOriginal(true)} className={`min-h-9 rounded-full px-3 font-semibold ${showOriginal ? "bg-rani-ink text-white" : "text-ink-soft"}`}>
                  {t("look_original")}
                </button>
              </div>
            </div>
          )}
        </div>
        <ArchFrame />
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} tabIndex={-1} aria-hidden="true" />
    </div>
  );
}

function CameraFallback({ onUpload }: { onUpload: () => void }) {
  const { ctl, state, t } = useMirrorCtx();
  const awake = state.phase === "awake";
  const cam = state.camera.state;
  const denied = cam === "denied";
  const gone = cam === "unavailable";
  const starting = cam === "starting";
  const message = !awake ? t("mirror_resting") : starting ? t("camera_starting") : denied ? t("camera_denied") : gone ? t("camera_unavailable") : t("camera_off");
  return (
    <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 px-8 pt-16 text-center">
      <p className="font-voice text-lg text-ink">{message}</p>
      {awake && !starting && (
        <div className="flex flex-wrap justify-center gap-2">
          {!denied && !gone && (
            <button type="button" onClick={() => ctl.startCamera()} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-white">
              <CameraIcon /> {t("allow_camera")}
            </button>
          )}
          <button type="button" onClick={onUpload} className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-ink px-4 text-sm font-semibold text-ink">
            <UploadIcon /> {t("upload_photo")}
          </button>
        </div>
      )}
    </div>
  );
}

function ScanOverlay({ onUpload }: { onUpload: () => void }) {
  const { ctl, state, lang, t } = useMirrorCtx();
  const { scan } = state;
  if (scan.name === "idle") return null;
  return (
    <div className="absolute inset-0 z-[2] flex flex-col items-center justify-between p-4 pt-14">
      {scan.name === "preparing" && <Pill>{t("camera_starting")}</Pill>}

      {scan.name === "framing" && (
        <>
          <Pill>{scan.hint === "manual" ? t("hint_manual") : line(lang, HINT_LINE[scan.hint], {})}</Pill>
          <div className="flex w-full flex-col items-center gap-3">
            <div
              className="h-1.5 w-40 overflow-hidden rounded-full bg-white/70"
              role="progressbar"
              aria-label={t("steady_progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.round((scan.steadyMs / 1200) * 100))}
            >
              <div className="h-full rounded-full bg-peacock transition-[width] duration-200" style={{ width: `${Math.min(100, (scan.steadyMs / 1200) * 100)}%` }} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => ctl.captureNow()} className="min-h-11 rounded-full bg-rani-ink px-5 text-sm font-semibold text-white shadow">
                {t("capture_now")}
              </button>
              <button type="button" onClick={() => ctl.cancelScan()} className="min-h-11 rounded-full bg-white/90 px-4 text-sm font-semibold text-ink shadow">
                {t("cancel")}
              </button>
            </div>
          </div>
        </>
      )}

      {scan.name === "countdown" && (
        <div key={scan.n} className="m-auto font-voice text-[8rem] font-semibold leading-none text-white drop-shadow-[0_4px_18px_rgba(34,26,82,0.55)]" aria-hidden="true">
          {scan.n}
        </div>
      )}

      {scan.name === "capturing" && <div className="absolute inset-0 bg-white" style={{ animation: "unveil 0.4s ease-out reverse both" }} />}

      {scan.name === "analyzing" && (
        <div className="m-auto flex flex-col items-center gap-3">
          <div className="h-1 w-44 overflow-hidden rounded-full bg-white/70">
            <div className="h-full w-1/3 rounded-full bg-amethyst" style={{ animation: "scan-sweep 1.4s ease-in-out infinite" }} />
          </div>
          <Pill>{scan.long ? t("analyzing_long") : t("analyzing")}</Pill>
        </div>
      )}

      {scan.name === "error" && (
        <div className="m-auto flex max-w-[16rem] flex-col items-center gap-3 rounded-2xl bg-white/95 p-4 text-center shadow-lg">
          <p className="font-voice text-base text-ink">{scan.kind === "camera" ? t("camera_error") : line(lang, "scan_error", { kind: scan.kind })}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => ctl.retry()} className="min-h-11 rounded-full bg-ink px-4 text-sm font-semibold text-white">
              {t("try_again")}
            </button>
            <button type="button" onClick={onUpload} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-ink px-4 text-sm font-semibold text-ink">
              <UploadIcon /> {t("upload_photo")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <p className="max-w-[16rem] rounded-full bg-white/92 px-4 py-2 text-center font-voice text-base text-ink shadow-md">{children}</p>;
}
