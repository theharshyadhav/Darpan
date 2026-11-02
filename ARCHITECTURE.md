# Architecture

```
Browser (React 19)                               Server (Next.js route handlers)
┌─────────────────────────────┐                  ┌───────────────────────────────┐
│ components/  UI, Jharokha   │                  │ /api/status       what is live │
│ client/controller.ts  brain │ ──fetch──────▶   │ /api/skin/scan    YouCam skin  │
│ client/flows/  scan, look   │                  │ /api/look/preview YouCam VTO   │
│ client/browser/ ears, voice,│                  │ /api/mirror/chat  LLM plan     │
│   eyes (camera, detector)   │                  │ /api/mirror/look  LLM vision   │
│ localStorage  all history   │                  │ guard: origin + rate limit     │
└─────────────────────────────┘                  │ budget: daily and per-IP units │
                                                 └──────┬──────────────┬─────────┘
                                                        │              │
                                              YouCam REST API     Groq / xAI / ...
```

## Ideas that shape the code

**A pure controller behind ports.** `src/client/controller.ts` holds every decision (what the mirror says, what a tap or a sentence means, when to ask). It talks to the world only through the interfaces in `src/client/ports.ts` (ear, voice, eyes, storage, clock, API). The browser implementations live in `src/client/browser/`; tests drive the controller with fakes in `tests/fakes.ts`. This is why 650+ tests run in seconds without a browser.

**Rules first, model second.** `src/client/intents.ts` understands English, Hindi and Hinglish commands offline. The LLM (`src/server/llm/`) is only asked for a structured plan when the rules cannot decide, and its output is validated with zod, then passed through the claim linter. With no key, the rules alone run the whole app.

**One linter, three places.** `src/lib/persona/lint.ts` defines the claim rules. Built-in lines are tested against it (`npm run lint:claims`), model output is sanitized with it at runtime, and the same rules are spelled out in the prompt.

**Consent is a tap.** The scan flow (`client/flows/scan.ts`) checks `settings.consentScan`. If absent it asks with a consent card whose Allow button is a real button; the spoken path cannot set the flag.

**Demo Mode is a first-class source.** `lib/skin/demo.ts` makes stable sample scores on the device. Every scan carries `source: "demo" | "youcam"`; reports, the verify comparison and the ledger all read it, so samples are labelled everywhere and never count towards a verdict.

**Server is stateless.** `server/budget.ts` and `ratelimit.ts` use an in-memory store, or Upstash Redis when configured (`server/kv.ts`). Photos stream through to YouCam and are not stored. Scan and preview are two-step (POST returns a ticket, GET polls it) so a serverless function never holds a long request.

## Layout

| Path | What lives there |
| --- | --- |
| `src/app` | Pages, API routes, manifest, global CSS (design tokens in `@theme`). |
| `src/components` | The interface. `ui-text.ts` holds every on-screen string in three languages. |
| `src/client` | Controller, flows, intent parsing, browser adapters. |
| `src/lib` | Pure shared logic: concerns, skin scoring and comparison, ritual engine, ledger verdicts, looks, persona copy and linter. |
| `src/server` | Config, YouCam client, LLM client and prompts, guards, budgets. |
| `scripts` | `doctor`, `mock-youcam`, icon and asset setup. |
| `tests`, `e2e` | Unit tests and Playwright smoke tests. |

## Security posture

Same-origin check and per-visitor rate limit on every route (`server/guard.ts`); image sniffing and size limits before upload (`lib/image/sniff.ts`); production CSP without `unsafe-eval`; keys only on the server; user text and label text are wrapped as data in prompts. `next.config.ts` documents each CSP choice.
