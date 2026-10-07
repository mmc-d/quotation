# MMC Core — production (this PC now, a VPS later)

One Docker Compose stack, identical on both machines:

```
Caddy (80/443, automatic HTTPS) ─┬─ /api/*  → api      (NestJS + Better Auth)
                                 └─ the rest → web      (Next.js)
worker (background jobs) · migrate (one-shot: schema + seed) · postgres · gotenberg (PDF)
```

Data lives in Docker volumes: `pgdata` (database), `files` (PDFs, stamp, logo), `caddy_data` (certificates).

## 1. Run it on this PC

```bash
cd infra/prod
./mmc.sh init          # creates .env with random secrets
#   edit .env: OWNER_EMAIL=<your e-mail>, ALLOW_SANDBOX=true (local testing only)
./mmc.sh build         # builds mmc-api and mmc-web for this machine
./mmc.sh up
```

Open **http://localhost:8090** and choose **فعّل حسابك** (activate your account) with `OWNER_EMAIL`. Without SMTP, the verification link appears in the API log:

```bash
./mmc.sh logs api | grep verify-email
```

Other commands: `./mmc.sh ps`, `logs [service]`, `restart`, `down`, `backup`, `restore <dir>`, `import-legacy <folder>`.

## 2. Move it to a VPS

**Pick a VPS in Saudi Arabia** (PDPL; plan decision D4). For example: Google Cloud Dammam, Oracle Jeddah/Riyadh, or a local Saudi provider. Minimum size: 2 vCPU, 4 GB RAM, 40 GB disk, Ubuntu 24.04.

On **this PC**, build x86 images and package them:

```bash
cd infra/prod
./mmc.sh export amd64        # → mmc-images-<tag>.tar.gz
scp mmc-images-*.tar.gz docker-compose.yml Caddyfile mmc.sh .env.example  user@VPS:/opt/mmc/
```

On the **VPS**:

```bash
curl -fsSL https://get.docker.com | sh          # Docker + compose plugin
sudo ufw allow 22,80,443/tcp && sudo ufw enable  # only SSH and web open
cd /opt/mmc
./mmc.sh init
nano .env   # see below
./mmc.sh import mmc-images-<tag>.tar.gz
./mmc.sh up
```

Set these in the VPS `.env`:

| Setting | Value |
|---------|-------|
| `PUBLIC_URL` | `https://mmc.your-domain.sa` |
| `SITE_ADDRESS` | `mmc.your-domain.sa` (Caddy then obtains the HTTPS certificate automatically) |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` |
| `OWNER_EMAIL` | the first owner's e-mail |
| `ALLOW_SANDBOX` | **`false`**. On a public server the sandbox "pay now" and signing pages would let anyone fake a payment or a signature. |
| `SMTP_URL`, `MAIL_FROM` | Needed so staff receive verification e-mails. Without them the link only appears in `./mmc.sh logs api`. |
| `GOOGLE_CLIENT_ID/SECRET` | Optional: Google sign-in (OAuth origin = `PUBLIC_URL`) |

Before `./mmc.sh up`, point the domain's **DNS A record** at the VPS IP.

## 3. Updates

```bash
# PC
git pull && cd infra/prod && ./mmc.sh export amd64 && scp mmc-images-<tag>.tar.gz user@VPS:/opt/mmc/
# VPS
./mmc.sh backup && ./mmc.sh import mmc-images-<tag>.tar.gz && ./mmc.sh up
```

`up` re-runs `migrate`, which applies new migrations and the idempotent seed, before the API starts.

## 4. Backups

```bash
./mmc.sh backup                 # → backups/<timestamp>/{mmc.dump, files.tar.gz}
./mmc.sh restore backups/<timestamp>
```

On the VPS, schedule a nightly backup and copy it off the server:

```bash
( crontab -l 2>/dev/null; echo '30 2 * * * cd /opt/mmc && ./mmc.sh backup >> backups/cron.log 2>&1' ) | crontab -
```

## 5. Move the PC's data to the VPS (optional)

To go live with what you entered while testing:

1. On the PC, run `./mmc.sh backup`.
2. Copy the backup folder to the VPS.
3. On the VPS, run `./mmc.sh up` once (it creates the schema), then `./mmc.sh restore <folder>`.

## Notes

- Until `ERPNEXT_URL` is set, invoices come from the built-in **development back office**. They are numbered and calculated correctly, but **nothing is sent to ZATCA**.
- With `ERPNEXT_URL` set, purchasing and stock records are also pushed to ERPNext every 15 minutes (Settings → status at `GET /api/erp-sync/status`). The implementer must create the custom fields listed in `packages/erp-connector/src/erpnext.ts` (`PHASE5_DEFAULTS`).
- **AI** stays in a free sandbox until `ANTHROPIC_API_KEY` is set in `.env`; `AI_DAILY_USD` caps the daily spend (default 20).
- **ThingsBoard**: set `THINGSBOARD_WEBHOOK_SECRET` (the rule chain signs each alarm with it — payload and header in `apps/api/src/modules/iot.service.ts`) and, to acknowledge/clear alarms from MMC, `THINGSBOARD_URL`, `THINGSBOARD_USERNAME`, `THINGSBOARD_PASSWORD`.
- The API image also contains the legacy importer: `./mmc.sh import-legacy /path/to/old-json-folder [--dry-run]`.
