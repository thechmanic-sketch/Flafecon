# Flafecon — AI Operating System

> Idea → Plan → Brand → Website → Business. One workspace, five engines.

Flafecon turns a single prompt into a real deliverable: a responsive website, a structured research brief, a business model, a brand system, or a content kit. A lightweight intent **router** picks the right engine automatically, or you can lock one.

---

## What's in this build

| File | Role |
|---|---|
| `index.html` | The complete frontend — sidebar, create/chat workspace, right-hand assets panel, all 5 engines, copy/download, history, projects, dashboard, settings. Single file, no build step. |
| `server.js` | Express API. `POST /api/generate { engine, prompt } → { text }`, backed by OpenAI, with the same engine routing as the client. |
| `package.json` | Backend dependencies + scripts. |
| `.env.example` | Copy to `.env`, add your `OPENAI_API_KEY`. |
| `vercel.json` | One-click Vercel deploy (serves the frontend + API). |

---

## Architecture

```
Browser (index.html)
  │  prompt + engine
  ▼
intent router  ──►  picks: website | research | business | brand | content
  │
  ├── API_MODE 'inline'   →  in-app model endpoint        (demo / no backend)
  └── API_MODE 'backend'  →  POST /api/generate  →  Express  →  OpenAI
                                                       │
                              system prompt per engine ┘
  ▼
renderer
  ├── markdown engines → formatted output + Copy / Download .md / Save
  └── website engine   → JSON {html,css,js} → tabs + live preview + .zip export
```

The frontend ships in **two modes**, set at the top of the script in `index.html`:

```js
const CONFIG = { API_MODE: 'inline', BACKEND_URL: '/api/generate', ... };
```

- `inline` — generation runs against the in-app model endpoint. Good for trying it instantly with no server. If unreachable (e.g. opened as a local file), it falls back to a demo template so every button still works.
- `backend` — production mode. Set this, deploy `server.js`, and all generation flows through your own OpenAI key. The engine prompts live in **both** files so the contract stays identical.

---

## Run it

**Frontend only (instant):** open `index.html` in a browser.

**Full stack:**
```bash
cp .env.example .env        # add your OPENAI_API_KEY
npm install
mkdir public && cp index.html public/   # backend serves /public
# in index.html set CONFIG.API_MODE = 'backend'
npm run dev                 # http://localhost:3000
```

**Deploy (Vercel):**
```bash
# put index.html in /public, set API_MODE='backend', then:
vercel            # add OPENAI_API_KEY in project env vars
```

---

## The five engines

1. **Website** — full responsive site as `index.html` + `styles.css` + `script.js`, live preview, per-file and `.zip` download (with `/assets/{images,icons,logos}` scaffolding).
2. **Research** — Executive Summary · Key Findings · Analysis · Opportunities · Risks · Recommendations.
3. **Business** — Concept · Target Market · Revenue Model · Pricing · Growth · Execution Roadmap.
4. **Brand** — Name · Positioning · Audience · Tone of Voice · Messaging · Visual Direction · Marketing.
5. **Content** — blogs, social, ad copy, product descriptions, email campaigns.

---

## Roadmap (what's here vs. next)

**Done in this build (Phase 1–2 + parts of 3–4)**
- Full UI layout, sidebar, chat workspace, right-side assets panel
- Live AI integration + auto-routing across all 5 engines
- Website builder with preview + real file/zip export
- Copy / download on every output; in-session history; save-to-project; dashboard; settings
- Cross-session persistence (projects + history) when storage is available

**Next**
- **Auth + multi-user** (Supabase): per-user projects, row-level security.
- **Persistent project store** (Postgres via Supabase) replacing client storage.
- **Streaming** responses (SSE) for token-by-token output.
- **Asset uploads & image gen** for the brand/website engines.
- **Team workspaces, sharing, export to GitHub / one-click site deploy.**

### Suggested Supabase schema
```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  engine text not null,
  title text,
  prompt text,
  output text,
  created_at timestamptz default now()
);
alter table projects enable row level security;
create policy "own rows" on projects
  for all using (auth.uid() = user_id);
```

---

## Notes & honesty

This is a strong, runnable **foundation**, not a finished commercial SaaS. The generation, routing, exports, and persistence are real. Production hardening still to do: authentication, rate limiting, server-side input validation/sanitization, abuse controls, billing, error monitoring, and tests. Treat `server.js` as a starting point and never ship an OpenAI key to the client.

MIT licensed.
