import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Darpan keeps, what it sends, and to whom.",
};

const h2 = "mt-8 font-voice text-[1.5rem] font-semibold leading-tight";
const p = "mt-2 max-w-prose text-[1.02rem] leading-relaxed text-ink";
const li = "mt-1.5";

export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-5 pb-16 pt-8">
      <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-amethyst-ink underline underline-offset-4">
        Back to the mirror
      </Link>
      <h1 className="mt-4 font-display text-[2.4rem] leading-none">Privacy</h1>
      <p className={p}>
        Darpan is a mirror, not an account. There is no sign-up and no profile on a server. This page says plainly what stays on your device, what is sent, to whom, and
        when.
      </p>

      <h2 className={h2}>What stays on your device</h2>
      <p className={p}>
        Your settings, your scan scores, your ritual history and the products you track are saved in this browser (local storage) so the mirror remembers you next time.
        A scan is saved as its seven numbers and how sure the mirror was. <strong>Photos are never saved</strong>, and neither is any reading of your skin colour. In the
        mirror&apos;s settings, &ldquo;Forget me&rdquo; erases all of it at once, and clearing this site&apos;s data in your browser does the same.
      </p>

      <h2 className={h2}>What is sent, and only after you allow it</h2>
      <ul className="mt-2 max-w-prose list-disc pl-6 text-[1.02rem] leading-relaxed">
        <li className={li}>
          <strong>A photo for a skin scan or a makeup preview</strong> goes to YouCam (Perfect Corp.), through this site&apos;s server, only after you tap Allow on the
          consent card or switch it on in Settings. Darpan does not store it. YouCam processes it under its own terms and privacy policy.
        </li>
        <li className={li}>
          <strong>A frame of a bottle</strong>, when you ask the mirror to read a label, goes to a vision model (by default Groq, or xAI if the host chose it), again only
          after you allow it. Hold the bottle close and keep your face out of the frame.
        </li>
        <li className={li}>
          <strong>What you say or type</strong> may be sent to the same language model so the mirror can understand phrases its built-in rules don&apos;t know. Only the
          sentence, a few recent lines and a small summary of the ritual are sent: never scores, photos or your name.
        </li>
      </ul>
      <p className={p}>
        If the host has set no keys, the mirror runs in <strong>Demo Mode</strong>: skin numbers are labelled sample numbers made on your device, and nothing is sent
        anywhere.
      </p>

      <h2 className={h2}>Your voice</h2>
      <p className={p}>
        The mirror listens through your browser&apos;s speech recognition. <strong>In Chrome and Edge, that sends your audio to the browser maker&apos;s speech service</strong>
        {" "}(Google for Chrome, Microsoft for Edge) to turn it into text. Darpan never receives the audio, only the text. If you would rather not, turn off listening with the
        microphone button and type or tap instead; everything works that way. The mirror&apos;s own voice is produced on your device.
      </p>

      <h2 className={h2}>The camera</h2>
      <p className={p}>
        The camera is used only while the mirror is awake. Video is never recorded or uploaded: frames are checked on your device to see whether your face is in the frame
        and the light is good. The face check runs in your browser with MediaPipe.
      </p>

      <h2 className={h2}>What the server keeps</h2>
      <p className={p}>
        To protect the host from running up costs, the server keeps a daily counter per visitor, keyed by a one-way hash of your network address (not the address itself),
        which expires within a day. It also keeps short-lived rate-limit counters. It does not keep photos, scores, text you said or any profile. Ordinary hosting logs may
        record that a request happened, as at any website.
      </p>

      <h2 className={h2}>What the mirror is not</h2>
      <p className={p}>
        Darpan gives cosmetic readings and routine coaching. It does not diagnose, treat or promise results, and it says when it is unsure. If something worries you about
        your skin, a dermatologist is the right person to ask.
      </p>

      <h2 className={h2}>Your choices</h2>
      <ul className="mt-2 max-w-prose list-disc pl-6 text-[1.02rem] leading-relaxed">
        <li className={li}>Say no on a consent card: the mirror carries on with sample numbers or recipes only.</li>
        <li className={li}>Switch each permission off any time in Settings.</li>
        <li className={li}>Turn off listening, or block the microphone or camera in your browser.</li>
        <li className={li}>Choose &ldquo;Forget me&rdquo; to erase everything on this device.</li>
      </ul>
    </main>
  );
}
