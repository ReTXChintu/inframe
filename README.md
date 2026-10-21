# InFrame

Shared photo albums for trips, weddings and parties. Everyone adds photos, and InFrame uses face recognition to find every photo you, or your family, are in.

- **Sign in with your account**: one account for InFrame, SpendLog and Trippin, through the shared OpenID Connect identity server. InFrame keeps no passwords.
- **Events** (trip / wedding / party / other) with dates, a cover, albums, and roles: **owner**, **co-host**, **guest**.
- **Invite people** with an 8-character code (`XXXX-XXXX`), a link, a QR code, or by email. Email invitees join with one click, as a guest or a co-host.
- **Storage is yours, and the server keeps no files.** Each event lives in a Google Drive or MEGA folder that the owner connects:
  - **Photos and videos** from guests end up in that folder. The server only holds an upload on disk until a worker has copied it there.
  - Photos you drop into the folder directly are picked up automatically.
  - Sub-folders become albums.
  - Each photo's thumbnail and preview (a video's poster frame) are saved next to it, in a hidden `.inframe` sub-folder of the same folder.
- **Videos** are stored and played (with seeking) but never face-scanned.
- **Duplicate check:** a file with the same name, size and modified date as one already in the event (or already queued) gets a *Skip duplicates / Upload anyway* prompt.
- **Face matching** through an external model URL:
  - Take a selfie once, and InFrame finds you in every event you belong to, including photos added later.
  - Add family members with their own selfie.
  - **My photos** shows your matches across all your events.
- **Live updates** over Socket.IO: per-file upload progress (uploading → queued on server → saving to storage → making previews → finding faces → matched), a "You're in N new photos" toast, and gallery refresh.
- Gallery with **All / You / family / Favourites / Your uploads / Albums** views, multi-select, ZIP download of originals, and a full-screen viewer.
- **Privacy controls for hosts:**
  - Turn joining by code on or off, and rotate the code.
  - Allow or block guest uploads.
  - Hide the full gallery from guests, so they see only their own matches, uploads and favourites.
  - Turn face search on or off.

## How it works

```
apps/web     React 19 + Vite + Tailwind 4 + TanStack Query      (the UI)
apps/server  Fastify 5 + Postgres (Neon) + pgvector + pg-boss   (API, jobs, realtime)
                 │                         │
                 ├── Google Drive / MEGA   ├── external face model:  POST {MODEL_URL}/extract
```

| Step | What happens |
|------|--------------|
| Upload | The browser (or the Android app, as a native background upload) sends each file on its own request, so every file gets real progress. The API streams it to the **spool** (`SPOOL_DIR`), records it, queues `photo-ingest` and answers `202` right away: from then on the user can close the tab or the app. |
| Store | A **worker process** streams the spooled file into the event's Drive/MEGA folder (or its album sub-folder) and deletes the spool copy. If storage keeps failing, the spool copy is kept so *Retry* can resend it (it's cleaned up after 7 days). |
| Ingest | The worker converts HEIC and makes a 480px thumbnail and a 2000px preview in memory (for videos: a poster frame and the duration, via the bundled ffmpeg). It saves them as `<folder>/.inframe/<name>.<hash>.thumb.webp` and `.preview.webp`, then queues `photo-faces` (photos only). The hash comes from the original's storage id, so two photos with the same name never share files. |
| Faces | The preview (≤1920px JPEG) is sent to the model's `/extract`. Each face's 512-d embedding is L2-normalised and stored in `faces` (pgvector). |
| Match | A person matches a photo when any face in it has cosine similarity `> MATCH_THRESHOLD` with that person's selfie. Only people belonging to members of that event are checked. Results go in `photo_matches`. They are recomputed when a selfie changes, someone joins or leaves, or a photo is re-scanned. |
| Sync | Every `SYNC_CRON` (and on demand), each event's folder is listed, skipping `.inframe` folders. New files are ingested; files deleted from the folder disappear from InFrame, and their thumbnail and preview are trashed. |
| Serving | Thumbnails and previews are streamed from storage through a size-capped **memory** cache (`MEDIA_CACHE_MB`). Originals support HTTP `Range`, so videos seek without downloading the whole file. If someone empties a `.inframe` folder, the missing files are rebuilt automatically. Selfies (512px) are kept in the database, since guests may have no storage of their own. |

What a folder looks like in Drive/MEGA:

```
InFrame · Goa trip/
  IMG_2041.jpg
  IMG_2042.jpg
  .inframe/
    IMG_2041.3fa9c1.thumb.webp
    IMG_2041.3fa9c1.preview.webp
    IMG_2042.b27e04.thumb.webp
    …
  Beach day/            ← an album
    IMG_2050.jpg
    .inframe/…
```

Jobs run on **pg-boss**, a queue stored in the same Postgres database (no Redis), served by separate worker processes (`npm run worker`). Workers report progress back to the API process through Postgres `NOTIFY`, and the API pushes it to browsers. Failed jobs retry with backoff. A face-detection failure is recorded as *failed*, never as "no faces", so hosts can retry it from the event page.

## Setup

Requirements: Node.js 20+ (22 LTS recommended; Node 20 is past end-of-life), and a Neon (or any) Postgres with the `vector` and `citext` extensions available. Neon has both.

```bash
npm install
cp .env.example .env      # then fill it in (below)
npm run db:migrate        # optional: the server also migrates on start
npm run dev               # API on :4000, web on http://localhost:5173
```

### 1. Database (Neon)
Create a project and copy the **direct** connection string. That's the host *without* `-pooler`: the job queue keeps long-lived connections, which PgBouncer would break. Put it in `DATABASE_URL`.

### 2. Secrets
Generate `JWT_SECRET`, `ENCRYPTION_KEY` and `MEDIA_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`ENCRYPTION_KEY` encrypts stored Google refresh tokens and MEGA passwords. Changing it means everyone reconnects their storage.

### Sign-in (identity server)
InFrame, SpendLog and Trippin share one OpenID Connect identity server; InFrame has no sign-up or passwords of its own. Register two clients there:

| Client | Type | Redirect URI | Post-logout redirect URI |
|--------|------|--------------|--------------------------|
| `inframe-web` | confidential | `{APP_URL}/api/auth/oidc/callback` | `{APP_URL}/login` |
| `inframe-mobile` | public, PKCE | `app.inframe.android:/oauth2redirect` | `app.inframe.android:/oauth2redirect` |

Both use the scopes `openid email profile offline_access`. Then set `OIDC_ISSUER` and `OIDC_CLIENT_SECRET` in `.env` (`OIDC_REDIRECT_URI` / `OIDC_POST_LOGOUT_URI` only if they differ from the defaults above).

The identity server only proves who someone is. After that InFrame runs on its own tokens as before: a 15-minute access token, a rotating refresh session, and 24-hour upload tickets. On first sign-in an account is found by the identity server's `sub`, else an existing InFrame account with the same **verified** email is linked, else a new one is created. Unverified emails are refused.

### The super admin
The **first account that signs in becomes the super admin**. It gets an **Admin** page (header menu, or Settings on a phone) that manages, without touching `.env` or restarting:
- **Face model:** URL, API key and header, timeout, and match strictness, with a *Test connection* button.
- **Google Drive:** the OAuth client ID and secret, with the redirect URI ready to copy.
- **Email (SMTP):** host, port, TLS, username, password and from-address, with a *Send test email* button.

Values saved there override `.env`. Secrets (client secret, SMTP password, model API key) are stored encrypted with `ENCRYPTION_KEY` and are never sent back to the browser. "Use .env values" removes the saved ones. So steps 3, 4 and 6 below can be done either in the Admin page or in `.env`.

### 3. Face model
Set the model URL, in Admin → Settings or as `MODEL_URL`, to the base URL of the face service. Until it's set, uploads still work but faces aren't scanned; after you set it, use *Retry failed* on an event to scan its photos. InFrame needs **one endpoint**:

```
POST {MODEL_URL}/extract
Content-Type: multipart/form-data, field "file" = a JPEG image

200 → {"faces": {"face1": {"descriptor": [512 floats]}, "face2": {...}}}
      ("faces" may also be an array; the vector may be "descriptor", "embedding" or "normed_embedding";
       optional "det_score")
4xx → {"detail": "..."}  (treated as "this image can't be processed", not retried)
5xx / timeout            (retried with backoff)
```

Any InsightFace-style service with 512-d embeddings works, including the antelopev2 `/extract` contract. Embeddings don't need to be normalised; InFrame normalises them. If the service needs a key, set `MODEL_API_KEY` (sent in the `MODEL_API_KEY_HEADER` header, default `x-api-key`). Tune `MATCH_THRESHOLD` (default `0.5`): higher means fewer false matches but more missed photos.

### 4. Google Drive (optional)
Google Cloud console:
1. Create a project.
2. Enable the **Google Drive API**.
3. Configure the OAuth consent screen. While in "Testing", add your Google accounts as test users.
4. Create credentials → **OAuth client ID** → *Web application*.
5. Add the authorised redirect URI `{APP_URL}/api/storage/google/callback`, e.g. `http://localhost:5173/api/storage/google/callback`.
6. Paste the client ID and secret into **Admin → Settings → Google Drive**, or put them in `.env`.

This is used only to reach the storage folder; sign-in to InFrame goes through the identity server. It uses the full `drive` scope because owners can point an event at an existing folder that already holds photos. A public launch needs Google's verification for that scope.

### 5. MEGA (optional)
Nothing to configure on the server. Owners connect MEGA in **Settings → Storage** with their MEGA email and password; InFrame stores them encrypted. MEGA accounts with two-factor login can't be used, because the login can't be kept alive.

### 6. Email (optional in development)
Set SMTP in **Admin → Settings → Email**, or with `SMTP_*` / `MAIL_FROM` in `.env`, for event invites. Without `SMTP_HOST`, emails are printed to the server log, so you can click the links locally.

### Trying it without Google or MEGA
Set `DEV_MEMORY_STORAGE=true`. A **Dev memory storage** option then appears when you create an event, and the whole flow works against it: upload, thumbnails, faces, sync, ZIP. Everything in it is lost when the server restarts, and the server refuses to start with it in production. Since those files live in the API process's memory, the API then runs the workers itself (`npm run dev` still starts a worker process, which exits straight away in this mode).

## Production

```bash
npm run build                                   # builds apps/web/dist and apps/server/dist
pm2 startOrReload ecosystem.config.cjs --update-env   # "inframe" (API + realtime + web) and "inframe-worker" × INFRAME_WORKERS
```

`npm start` runs just the API. Without workers nothing gets stored, so either run `npm run worker` next to it or set `RUN_WORKERS_IN_API=true` for a single-process setup.

- Set `NODE_ENV=production` and `APP_URL` to the public HTTPS URL.
- Put a TLS-terminating proxy (Caddy, Nginx, Traefik) in front, and forward websockets for `/socket.io`.
- Files live in Drive/MEGA and data in Postgres. The only disk use is the spool: uploads waiting for a worker. Give `SPOOL_DIR` room for a backlog of videos. Workers must run on the same machine as the API, since they read the spool.
- Limits: `MAX_UPLOAD_MB` per photo (default 50), `MAX_VIDEO_MB` per video (default 4096).
- Scale with more worker processes (`INFRAME_WORKERS`, default 2) and `WORKER_CONCURRENCY` jobs each. `WORKER_QUEUES=store,faces,sync` picks which queues a worker serves, e.g. a dedicated face-scanning worker.
- Memory to plan for: `MEDIA_CACHE_MB` for the thumbnail cache, plus a photo being processed per worker job.

## Android app (`apps/mobile`)

A Flutter app for the same API:
- sign in with your account (the identity server, through `flutter_appauth`)
- events with invites
- join by code or by **scanning the QR**
- galleries with a pinch-zoom viewer and save-to-phone
- **its own gallery picker** (albums, photos and videos, select all, long-press-and-drag to select a run; no 100-file limit)
- **background uploads**: each file is a native upload (WorkManager foreground service with a progress notification), so it carries on with the app in the background or closed. It authenticates with a 24-hour *upload ticket* (`POST /api/events/:id/upload-ticket`, sent as `x-upload-ticket`) instead of the short-lived access token
- the duplicate check, and video playback in the viewer
- **selfies with the phone camera** (works even when the website runs on plain http)
- family members, cross-event "My photos", basic event settings, and MEGA connections

It keeps its refresh token in the phone's secure storage: it sends `x-inframe-client: mobile`, and the API returns the token in the body instead of a cookie. The app checks `/app-version.json` and offers an update when a newer build is published.

```bash
cd apps/mobile
flutter run --dart-define=API_BASE_URL=https://<server>:<port> --dart-define=OIDC_ISSUER=https://<identity-server>     # on a phone or emulator
```

### Releasing
One command bumps **every app to the same version**: root, server, web, `package-lock.json`, and the mobile `pubspec.yaml` (where the build number goes up by one). It then commits, tags `vX.Y.Z` and pushes:

```bash
npm run release:patch     # 0.1.0 → 0.1.1   (fixes)
npm run release:minor     # 0.1.0 → 0.2.0   (features)
npm run release:major     # 0.1.0 → 1.0.0
npm run release -- 1.0.0  # exact version
# add  -- --dry-run  to preview, -- --no-push to tag locally only
```

It refuses to run off `main`, with uncommitted changes, when behind `origin/main`, or if the tag already exists.

### Releases → APK on the server
`.github/workflows/android-release.yml` runs on every **pushed `v*` tag** (as above) or **release published on GitHub**:
1. Builds a signed APK (version = tag, build number = run number), creates the GitHub release if it doesn't exist, and attaches the APK.
2. Streams it over SSH to the server, where the deploy key can only run `scripts/deploy-from-ci.sh`.
3. That script saves it as `apps/web/public/inframe.apk` with `app-version.json`, runs `git pull`, then `npm ci`, `npm run build`, and `pm2 startOrReload ecosystem.config.cjs` (the API and the workers).

The web app then shows **Get the Android app** (header, account menu, Settings, sign-in page). Run the workflow manually to get a test APK as an artifact without deploying.

Secrets the workflow needs:
- **Signing:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- **Deploy:** `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`
- **Optional variables:** `API_BASE_URL`, `OIDC_ISSUER` (the identity server the app signs in with)

**Keep the signing keystore safe.** Android only installs updates signed with the same key.

## Project layout

```
apps/server/src
  config.ts            env validation
  db/                  pool, migrator, migrations/*.sql
  auth/                OpenID Connect sign-in, access/refresh tokens, request guard
  model/client.ts      the external face-model client
  storage/             StorageProvider interface + Google Drive, MEGA and dev-memory adapters
  jobs/                pg-boss queues and the ingest / faces / sync workers
  services/            access rules, matching (pgvector), photo listing
  realtime/io.ts       Socket.IO (JWT-authenticated rooms per user and event)
  routes/              auth, me+people, storage, events, members+invites, photos, media
apps/web/src
  pages/               one file per screen
  components/          UI kit, photo grid, viewer, selfie capture, share sheet, storage picker
  lib/                 API client, auth, socket, upload queue, formatting
```

## Security notes
- No passwords are stored: sign-in is through the identity server (code flow with PKCE, RS256 ID tokens checked against its JWKS). Refresh tokens are httpOnly cookies (`Secure` when `APP_URL` is https), single-use and stored hashed.
- Every route checks event membership and role. Non-members get 404s, so event ids can't be probed.
- Image URLs are HMAC-signed and expire within 12 hours. ZIP links are one-time.
- Socket connections require a valid access token, and event rooms check membership.
- Auth, join and invite endpoints are rate-limited.
