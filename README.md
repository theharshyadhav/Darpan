# Darpan

A talking magic mirror that measures your skin with YouCam AI, coaches your skincare ritual one calm sentence at a time, previews makeup looks, and tells you honestly whether a product helped.

Built for the YouCam API Skin AI & eCommerce VTO Hackathon 2026. Next.js 16, React 19, TypeScript, Tailwind 4. No database, no accounts.

## What it does

- **Skin audit.** One photo goes to YouCam's skin analysis. The result is seven rings (smoothness, hydration, calm tone, radiance, oil balance, fine pores, clarity), each with a printed number and a band, never colour alone.
- **Ritual coach.** A bead-garland timeline for the morning or evening routine. Say or type what you are applying and the mirror tracks it, with timers for massage, settling and masks.
- **Did it work?** A before and after comparison that refuses to over-claim: changes inside the noise band count as "same", scans taken minutes apart are flagged, and sample numbers never count.
- **Look Studio.** Five makeup looks with step-by-step recipes and, with a YouCam key, a try-on preview of your photo.
- **Royal Ledger.** Track a product across a couple of weeks of scans. The verdict stays "too early to say" until there is enough to say anything.
- **Read a bottle.** One camera frame to a vision model to read a label, only after you allow it.
- **Three languages.** English, Hindi (Devanagari) and Hinglish, for the screen and for the mirror's voice.

## How to Run
   Add YouCam API in env file.
```bash
npm install
npm run dev          # http://localhost:3000
```

With no environment variables the app runs in **Demo Mode**: the scan numbers are clearly labelled samples made on your device, the mirror understands you with built-in rules, and nothing is sent anywhere. The camera and microphone need `localhost` or HTTPS.

## Add real keys

Copy `.env.example` to `.env.local` and fill in what you have.

| Variable | Purpose |
| --- | --- |
| `YOUCAM_API_KEY` | Turns on live skin scans and look previews. Required for real measurements. |
| `GROQ_API_KEY` | The mirror's brain. Groq is the free default. |
| `XAI_API_KEY` + `LLM_PROVIDER=xai` | Use xAI Grok instead. |
| `LLM_PROVIDER=off` | Force the built-in rules even if a key is present. |
| `DARPAN_DEMO_ONLY=true` | Force Demo Mode even if keys are present. |
| `DARPAN_DAILY_UNITS`, `DARPAN_IP_DAILY_UNITS`, `DARPAN_SCAN_COOLDOWN_SEC` | Spending guards. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Optional shared rate limits across serverless instances. |

Then run `npm run doctor`. It checks your keys with free read-only calls, prints what each YouCam call costs, and never prints a secret.

Gemini, OpenRouter and any OpenAI-compatible endpoint (`LLM_PROVIDER=custom` with `LLM_BASE_URL`) also work.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Standard Next.js. |
| `npm run check` | Typecheck, lint, claim linter, build, then all unit tests. This is what CI runs. |
| `npm test` | About 650 unit tests (vitest). The CSP test needs a build first. |
| `npm run e2e` | Playwright smoke tests against the production build (build first). |
| `npm run mock:youcam` | A local stand-in for the YouCam API on port 4010. Its numbers are made up. |
| `npm run doctor` | Validate keys and limits before a demo. |

To try the live path without spending units:

```bash
npm run mock:youcam
YOUCAM_API_KEY=mock-key YOUCAM_BASE_URL=http://127.0.0.1:4010 DARPAN_ALLOW_HTTP_UPSTREAM=1 npm run dev
```

## Honesty and privacy

- **Photos leave the device only after a tap or a Settings switch, never after a spoken "yes".** A spoken "yes" to the consent card is heard and politely declined. The e2e suite checks this.
- **Demo Mode sends nothing.** The e2e suite checks there are no outside requests and no scan calls.
- **Nothing is stored server-side.** Scores, ritual history and the ledger live in this browser's local storage. A photo is never saved, and neither is any skin-tone reading. "Forget me" erases everything.
- **Every spoken line passes the claim linter** (`src/lib/persona/lint.ts`): no medical claims, no promises, no shaming, referrals are the one generic sentence. The same rules run on built-in lines (tested), on model output at runtime, and are written into the model's prompt.
- **Readings are cosmetic, not a diagnosis**, and the app says so next to the numbers.
- Chrome sends microphone audio to Google's speech service for recognition; the privacy page says so.

See `ARCHITECTURE.md`, `PROMPTS.md`, `docs/DEPLOY.md` and `/privacy` in the running app.

## Design

"Jharokha", a palace window: pearl `#F8F5FF`, indigo ink `#221A52`, with rani pink, peacock, marigold, amethyst and sapphire as the gem colours. A cusped-arch camera frame crowned by a gem orb that shows listening, thinking and speaking. Rozha One for the wordmark, Eczar for the mirror's speech, Figtree for the interface, Noto Sans Devanagari for Hindi. Reduced-motion is respected; every text colour passes WCAG AA on pearl and white (`tests/contrast.test.ts`).

## Status

Verified: unit tests, production build, and Playwright smoke tests in headless Chromium with a fake camera and stubbed speech, in Demo Mode and against the mock YouCam server. **Not verified here:** real YouCam, Groq and xAI calls, real speech recognition and synthesis, Safari and Firefox, real faces through the face detector. See `SUBMISSION_CHECKLIST.md` for what to test first.

MIT licensed.
