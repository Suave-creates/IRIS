# Deploying IRIS with Docker (Windows host at 192.168.27.170)

Two containers: **server** (Fastify API + local Whisper large-v3) and **web**
(nginx serving the SPA and reverse-proxying `/api`). The database stays on the
existing MySQL at **192.168.27.157** — no data migration.

```
browser ──▶ http://192.168.27.170  ─▶ [web / nginx :80] ─▶ /api ─▶ [server :8080] ─▶ MySQL 192.168.27.157
                                          └─ serves the SPA
```

---

## 0. Prerequisites on the 192.168.27.170 box (over RDP)

- **Docker Desktop** installed and running in **Linux containers** mode (WSL 2 backend).
- Internet access on the box — the first build downloads base images, pip
  packages, and the ~3 GB Whisper `large-v3` model.
- The box can reach the DB: from PowerShell, `Test-NetConnection 192.168.27.157 -Port 3306` should succeed.
- Windows Firewall: allow **inbound TCP 80** so other LAN devices can open the app.

---

## 1. Get the code onto the box

Copy the whole `IRIS` project folder to the box (RDP clipboard/drive redirection,
a shared folder, or `git clone`). You do **not** need Node, Python, or the
`.venv` on the host — everything builds inside Docker. (The `.dockerignore`
already excludes `node_modules`, `dist`, and `server/whisper/.venv`.)

---

## 2. Create the `.env`

```powershell
cd C:\path\to\IRIS
Copy-Item .env.deploy.example .env
notepad .env
```

Fill in:

- `DB_PASSWORD`, `ANTHROPIC_API_KEY`
- `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` — generate them:

  ```powershell
  # SESSION_SECRET (48 hex chars)
  -join (1..24 | % { '{0:x2}' -f (Get-Random -Maximum 256) })
  # TOKEN_ENCRYPTION_KEY (must be exactly 64 hex chars)
  -join (1..32 | % { '{0:x2}' -f (Get-Random -Maximum 256) })
  ```

- Confirm the URLs are the box's address (`http://192.168.27.170`) and
  `COOKIE_SECURE=false` (required for plain HTTP).

> `NODE_ENV=production` enforces strong `SESSION_SECRET`/`TOKEN_ENCRYPTION_KEY`
> — the server refuses to start otherwise. That's intended.

---

## 3. Build and start

```powershell
docker compose up -d --build
```

First build is slow — it downloads the Whisper model and CPU inference libs
(image ends up ~5 GB). Subsequent builds are cached. Watch progress / health:

```powershell
docker compose logs -f server
```

Look for `server listening`. Then open **http://192.168.27.170** from any LAN machine.

---

## 4. Database

You're reusing the already-migrated MySQL at 192.168.27.157, so there's nothing
to run here. If you ever point at a **fresh** database, apply migrations from a
dev machine (they aren't bundled in the slim runtime image):

```powershell
npm run db:migrate      # against DB_* pointing at the new database
```

---

## 5. Signing in

**Password login (works now, over HTTP):** `AUTH_PASSWORD_ENABLED=true` is set.
On the login page choose email/password. To create the first account, use the
sign-up option (honors `AUTH_ALLOWED_DOMAINS`). Existing Google-provisioned
users can be given a password the same way if the email matches.

**Google SSO — read this before changing the redirect URIs:** Google's OAuth
server **rejects `http://` redirect URIs unless the host is `localhost`**. So
`GOOGLE_OAUTH_REDIRECT_URI=http://192.168.27.170/...` will fail with
`redirect_uri_mismatch`, no matter what you register. Google SSO and the Google
connectors (Calendar/Gmail/Drive) therefore need **HTTPS + a real hostname**
(see next section). Until then, use password login.

---

## 6. (Optional) HTTPS — required for Google SSO

To enable Google sign-in you need TLS and a hostname Google will accept:

1. Give the box a DNS name (e.g. `iris.yourco.internal`) with a certificate —
   an internal CA cert, or a public cert if it's internet-reachable.
2. Terminate TLS in front of nginx (add a `443` server block with your cert, or
   put Caddy/Traefik ahead of the `web` container).
3. Set in `.env`: `APP_BASE_URL`, `WEB_BASE_URL`, `CORS_ORIGINS`, and both
   `GOOGLE_*_REDIRECT_URI` to `https://iris.yourco.internal/...`, and
   `COOKIE_SECURE=true`.
4. Register those **https** redirect URIs in the Google Cloud OAuth client.
5. `docker compose up -d` to restart with the new env.

---

## 7. Operations

```powershell
docker compose ps                 # status
docker compose logs -f server     # API + Whisper logs
docker compose logs -f web        # nginx access/error logs
docker compose restart server     # restart after an .env change
docker compose down               # stop & remove containers (data is in external MySQL)
```

**Update to a new version:**

```powershell
git pull                          # or copy the new files over
docker compose up -d --build
```

**Whisper notes**

- The `large-v3` model is baked into the image. To trade accuracy for a smaller,
  faster image, rebuild with `docker compose build --build-arg WHISPER_MODEL=medium`
  and set `WHISPER_MODEL=medium` in `.env`.
- CPU transcription is deliberately accuracy-first and can take a while on long
  recordings; that's expected. If a transcription fails, the server falls back
  to the browser live-preview transcript automatically.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Server won't start, complains about `SESSION_SECRET`/`TOKEN_ENCRYPTION_KEY` | Set strong values (§2). `TOKEN_ENCRYPTION_KEY` must be exactly 64 hex chars. |
| Login "works" then immediately logged out | `COOKIE_SECURE` is true on HTTP. Set `COOKIE_SECURE=false` and restart. |
| `redirect_uri_mismatch` on Google | Expected on HTTP LAN IP — use password login or set up HTTPS (§6). |
| DB connection errors | Box can't reach 192.168.27.157:3306, or wrong `DB_PASSWORD`. Test with `Test-NetConnection`. |
| Audio upload fails (413) | Handled — nginx allows 512M. If you fronted it with another proxy, raise its body-size limit too. |
| Can't reach app from other machines | Open inbound TCP 80 in Windows Firewall on the box. |
