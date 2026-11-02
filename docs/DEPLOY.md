# Deploying Darpan

Ten minutes, free tier, no card. You need a GitHub account and a Vercel account.

## 1. Get the keys (optional, the app works without them)

- **YouCam API key** from the Perfect Corp. YouCam API console (see docs.perfectcorp.com). Needed for real skin scans and look previews.
- **Groq API key** from console.groq.com. Free tier, no card. Needed only for natural conversation and bottle reading; without it the mirror uses built-in rules.

## 2. Push and import

1. Push this folder to a GitHub repository.
2. In Vercel choose **Add New, Project**, import the repository. The framework is detected as Next.js; keep the defaults (`npm run build`).

## 3. Environment variables

In Project Settings, Environment Variables, add (Production at least):

| Name | Value |
| --- | --- |
| `YOUCAM_API_KEY` | your YouCam key |
| `GROQ_API_KEY` | your Groq key |
| `DARPAN_DAILY_UNITS` | a cap that fits your free allowance (default 240) |

Optional: `XAI_API_KEY` and `LLM_PROVIDER=xai` for Grok; `DARPAN_DEMO_ONLY=true` to run a public Demo Mode site that never calls anything; Upstash Redis variables for limits shared across instances (the in-memory limits are per serverless instance).

Never set `DARPAN_ALLOW_HTTP_UPSTREAM` in production.

Redeploy after changing variables. Environment variables are read on the server and never reach the browser.

## 4. Check it

Open the deployed URL. The badge on the first screen reads **Live** when a YouCam key is found, **Demo Mode** otherwise. Locally you can validate the same variables before deploying:

```bash
cp .env.example .env.local   # fill it in
npm run doctor
```

`doctor` reads the real credit balance and price table (free, read-only calls), sends one 8-token model reply, and prints warnings for any mistyped value. It never prints a secret.

## HTTPS is required

Browsers expose the camera and microphone only on HTTPS (or `localhost`). Vercel provides HTTPS automatically. A plain `http://` address on your network will show Demo Mode but cannot open the camera. The app sends `Strict-Transport-Security` and a Content-Security-Policy in production.

## Browser support

| Browser | Screen, camera, scan | Mirror's voice | Listening |
| --- | --- | --- | --- |
| Chrome and Edge, desktop and Android | Yes | Yes | Yes (audio goes to Google's speech service) |
| Safari (macOS, iOS) | Expected to work | Expected to work | Limited or unavailable; type or tap instead |
| Firefox | Expected to work | Expected to work | Not available; type or tap instead |

"Expected" means the code degrades by design (typing and tapping always work, a missing voice falls back to captions), but only Chromium has been tested for this project. Test Safari on a real device before you promise it in a demo. The face-framing check uses MediaPipe, then the browser's FaceDetector, then a manual "Capture now" button.

## Costs and safety

Each skin scan costs YouCam units (estimates in `.env.example`, real table via `npm run doctor`). The server enforces a daily cap, a per-visitor cap and a scan cooldown, and falls back to labelled sample numbers when a cap is reached. For a public demo, set `DARPAN_DAILY_UNITS` deliberately.

## Offline face detector model

`npm install` copies the MediaPipe runtime into `public/mediapipe` and tries to download the small detector model. If the download is blocked, the browser fetches it from Google's model host at runtime (allowed by the CSP) or falls back to manual capture.
