# Devpost submission text

## Name
Darpan

## Tagline
A talking magic mirror that measures your skin with YouCam AI, coaches your ritual aloud, and tells you honestly whether it helped.

## Inspiration
Skincare advice is full of promises and short on honesty. The mirror is where the ritual actually happens, so we asked: what if the mirror itself were the coach, spoke in the language you think in, and refused to claim more than the numbers support? "Darpan" is Hindi for mirror.

## What it does
- Measures seven skin concerns from one photo using **YouCam AI skin analysis**, shown as ring gauges with a printed number and band for each (never colour alone), plus a stated confidence.
- Speaks and listens in English, Hindi and Hinglish. It coaches a morning or evening ritual step by step on a bead-garland timeline, with timers, and logs what you say you are applying.
- **Did it work?** compares two scans and says so when the change is inside the noise, when scans were taken too close together, or when either one was a sample.
- **Look Studio** previews five makeup looks on your photo through **YouCam makeup try-on** and gives a step-by-step recipe.
- **Royal Ledger** follows a product across scans and says "too early to say" until it can say more.
- Reads a bottle label with a vision model, only after you allow it.

## How we built it
Next.js 16 and React 19. All decisions live in a pure controller behind interfaces (ear, voice, camera, storage), so the whole conversation is unit-tested without a browser. A rule-based intent parser understands commands offline in three languages; Groq (free by default) or xAI Grok is consulted only when the rules cannot decide, and everything it returns is validated and passed through the same claim linter as the built-in lines. YouCam calls go through our server, which enforces rate limits and a spending budget and falls back to labelled sample numbers. Nothing is stored server-side.

## Honesty and privacy by design
- Photos are sent only after a tap or a setting, never after a spoken "yes".
- Demo Mode works with zero keys: sample numbers made on the device, labelled as samples, nothing sent anywhere.
- Every spoken line passes a claim linter (no diagnosis, no promises, no shaming).
- "Forget me" erases everything on the device.

## Challenges
Making a voice interface that is trustworthy: browsers need a tap before they will speak, the mirror must not hear itself, and a "yes" must never be able to authorize sending a photo. Keeping seven rings readable for colour-blind users and in Hindi. Staying inside a free API allowance without ever blocking the demo.

## Accomplishments
Over 650 unit tests and Playwright smoke tests covering wake, scan, report, ritual, verify, looks, ledger, a Hindi session and forget-me, in Demo Mode and against a local mock of the YouCam API. WCAG AA contrast checked in a test.

## What we learned
Honest UX is mostly subtraction: every sentence the mirror does not say is a claim we do not have to defend.

## What's next
Longer-term ledger charts, more looks and regional languages, a shared kiosk mode for retail counters, and real-user testing across Safari and Firefox.

## Built with
Next.js, React, TypeScript, Tailwind CSS, YouCam AI Skin Analysis API, YouCam Makeup Virtual Try-On API, Groq, xAI Grok, MediaPipe, Web Speech API, Playwright, Vitest, Vercel.

## Try it
Deployed URL: (add yours). Repository: (add yours). Judges can open it with no keys: it starts in Demo Mode.
