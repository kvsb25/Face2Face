# Software Requirements Specification
## Face2Face — Authentication, Rate Limiting and Input Validation

| Field | Value |
|---|---|
| Document version | 1.0 (draft for review) |
| Date | 2026-09-01 |
| Author | Kovidh |
| Status | Proposed — no implementation started |
| Applies to commit | `eb39ae7` (branch `main`) |
| Keyword convention | MUST / SHOULD / MAY per RFC 2119 |

---

## 1. Introduction

### 1.1 Purpose

Face2Face is currently an anonymous, unauthenticated 1-to-1 WebRTC video/chat/file-sharing app. This document specifies the requirements for making it deployable on the public internet by adding:

1. A first-party **JWT authentication** layer (email + password signup/login) with salted password hashing.
2. **Google OAuth 2.0 / OIDC** signup and login, with account linking.
3. **Strict input validation** across every externally reachable endpoint, to eliminate SQL/NoSQL/command/header/template injection and to reduce XSS exposure.
4. A **Redis-backed, IP- and time-window-based rate limiter** that survives multi-IP, distributed request floods.
5. **PostgreSQL** as the system of record for user, credential, session and audit data.
6. An automated **test suite (Jest)** that runs fully against locally installed dependencies, with Docker used only as a final verification gate.

### 1.2 Scope

**In scope:** a new `authService` microservice; auth-related changes to `httpServer`, `wsServer`, `roomManager` and the browser client; PostgreSQL schema and migrations; Redis keyspace design; validation schemas; the rate limiter; the test suite; local and Docker Compose run configurations; deployment configuration requirements.

**Out of scope (explicitly):** changing the WebRTC media path; multi-party (>2) rooms; recording; TURN/STUN server operation (flagged as a deployment risk in §12); billing; admin UI; mobile apps; email delivery infrastructure beyond a pluggable interface (§4.2.7).

### 1.3 Definitions and abbreviations

| Term | Meaning |
|---|---|
| **AT** | Access token — short-lived JWT proving identity to `httpServer` / `wsServer` |
| **RT** | Refresh token — long-lived, opaque, single-use token that mints a new AT |
| **Token family** | Chain of RTs derived from one login; reuse of a consumed RT invalidates the whole family |
| **Member** | Authenticated user (local password or Google) |
| **Guest** | Unauthenticated visitor; may join an existing room, may not create one |
| **Room code** | `abc-def-ghi` room identifier produced by `roomManager` |
| **ws ticket** | Single-use, 60-second token authorising one WebSocket handshake |
| **PoLP** | Principle of least privilege |

### 1.4 References

- RFC 7519 (JWT), RFC 9068 (JWT access tokens), RFC 6749/6750 (OAuth 2.0), RFC 7636 (PKCE), OpenID Connect Core 1.0
- RFC 9331 / `draft-ietf-httpapi-ratelimit-headers` (RateLimit header fields)
- OWASP ASVS 4.0 (V2 Authentication, V3 Session Management, V5 Validation), OWASP Password Storage Cheat Sheet
- NIST SP 800-63B §5.1.1 (memorised secrets)

### 1.5 Current system (baseline)

| Service | Port | Responsibility | State |
|---|---|---|---|
| `httpServer` ([server/httpServer/app.js](../server/httpServer/app.js)) | 3000 | Serves the static client and the room REST API | stateless |
| `wsServer` ([server/wsServer/app.js](../server/wsServer/app.js)) | 3001 | WebRTC signalling; counts joins/leaves | in-memory socket map |
| `roomManager` ([server/roomManager/app.js](../server/roomManager/app.js)) | 3002 | Room existence + live participant count | in-memory `Map` |
| client ([client/](../client/)) | — | Vanilla JS + Tailwind CDN + axios | — |

Baseline gaps this SRS addresses: no identity, no authorisation, no persistence, no rate limiting, no validation, no tests, room codes generated with `Math.random()`, `roomManager` reachable without authentication, chat messages rendered into the DOM with `innerHTML`.

---

## 2. Overall description

### 2.1 Target architecture

```
                       ┌──────────────────────────────┐
  browser  ───TLS───►  │  reverse proxy (nginx/Caddy) │
                       └───────┬───────────────┬──────┘
                               │               │
                 /  /room/*  /api/room/*       │  /ws  (wss upgrade)
                               │               │
                    ┌──────────▼──────┐   ┌────▼──────────┐
                    │   httpServer    │   │   wsServer    │
                    │      :3000      │   │     :3001     │
                    └───┬────────┬────┘   └───┬───────┬───┘
        /api/auth/* ────┘        │            │       │
                                 │            │       │
              ┌──────────────────▼────────────▼───┐   │
              │          roomManager :3002        │◄──┘
              │   (internal only, S2S auth)       │
              └───────────────────────────────────┘
                    ┌──────────────────┐
   /api/auth/*  ──► │   authService    │ ──► PostgreSQL :5432  (users, credentials,
                    │      :3003       │ ──► Redis      :6379   sessions, audit)
                    └──────────────────┘                       (limits, state, tickets)
```

- `authService` is the **only** service that connects to PostgreSQL and the only holder of the JWT signing key.
- `httpServer` and `wsServer` **verify** tokens offline using the public key fetched from `authService`'s JWKS endpoint (cached, with `kid`-based rotation). They never call `authService` on the request hot path.
- Redis is shared by `authService` (OAuth state, ws tickets, lockout counters) and `httpServer`/`wsServer` (rate limiting).
- `roomManager` remains in-memory for live counts but MUST become reachable only from inside the network and MUST require a service-to-service credential.

### 2.2 User classes

| Class | Capabilities |
|---|---|
| Guest | View home page; join an existing room with a valid code; use chat/file transfer in that room |
| Member | Everything a guest can do, plus: create rooms, see own room history (Phase 3), manage sessions, change password, link/unlink Google |
| Service (internal) | `httpServer`/`wsServer` → `roomManager` calls; `authService` → DB/Redis |
| Operator | Runs migrations, rotates keys, reads logs/metrics (CLI only; no admin UI in scope) |

### 2.3 Operating environment

- Node.js ≥ 20 (verified locally: v20.17.0), npm 10.
- PostgreSQL ≥ 16 (verified locally: 18.6 listening on `127.0.0.1:5432`).
- Redis ≥ 7 — **not currently installed locally** (see §2.5 A-3).
- Deployment: Linux container hosts behind a TLS-terminating reverse proxy. Modern evergreen browsers with WebRTC + `getUserMedia` (requires a secure context).

### 2.4 Design constraints

| ID | Constraint |
|---|---|
| C-1 | Keep the existing service decomposition; add auth as a fourth service rather than folding it into `httpServer`. |
| C-2 | The client stays dependency-light vanilla JS. No SPA framework, no build step. |
| C-3 | All primary development and testing happen against **locally installed** Postgres/Redis/Node. Docker Compose runs are a verification gate executed **only after** the local suite is green. |
| C-4 | Secrets are supplied by environment only; no secret is committed. `.env` files stay untracked. |
| C-5 | JWTs are signed asymmetrically (RS256) so verifiers never hold signing material. |
| C-6 | The database user used by the application is not the schema owner and has no DDL rights (PoLP). |
| C-7 | Node 20 has no stable `crypto.timingSafeEqual` on unequal-length buffers — comparisons MUST hash-then-compare fixed-length digests. |

### 2.5 Assumptions and dependencies

| ID | Assumption / dependency |
|---|---|
| A-1 | The deployment terminates TLS. `Secure` cookies and `getUserMedia` both require it; the app is unusable over plain HTTP in production. |
| A-2 | A Google Cloud OAuth client (Web application type) is registered, with authorised redirect URIs for `http://localhost:3000/api/auth/oauth/google/callback` (dev) and the production equivalent. |
| A-3 | Redis MUST be installed locally before development starts (Memurai on Windows, or Redis inside WSL2, or `docker run redis:7` as a standalone container). This is the one required dependency currently missing from the local machine. |
| A-4 | A single logical Redis instance is shared by all services; rate-limit correctness depends on all counters landing in one keyspace. |
| A-5 | Number of concurrent users at launch is small (< 1000 sessions); a single Postgres primary with no read replica is sufficient. |
| A-6 | No email/SMTP provider is available yet, which defers email verification and password reset (§4.2.7). |

---

## 3. External interface requirements

### 3.1 User interfaces

| ID | Requirement |
|---|---|
| UI-1 | A `/login` page MUST offer email + password login and a "Continue with Google" button. |
| UI-2 | A `/signup` page MUST offer email, password, confirm-password, display name, plus "Continue with Google". Password strength MUST be shown live and MUST match server-side policy (FR-AUTH-02). |
| UI-3 | The home page MUST show auth state: signed-out visitors see "Join" enabled and "Create a new room" replaced by "Sign in to create a room" (linking to `/login?next=/`). Signed-in users see their display name and a sign-out control. |
| UI-4 | Validation errors MUST be rendered as text content, never as HTML, and MUST be field-scoped (`{ field, message }`). |
| UI-5 | On `429`, the UI MUST show a human-readable cooldown derived from `Retry-After` and MUST disable the offending control until it elapses. |
| UI-6 | The room page MUST work for guests; when the signed-in user's display name is available it MUST be used as the chat name instead of the current client-side `userName`. |

### 3.2 HTTP API — `authService` (:3003, proxied at `/api/auth/*`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | none | Create local account; issues AT+RT |
| POST | `/api/auth/login` | none | Password login; issues AT+RT |
| POST | `/api/auth/refresh` | RT cookie | Rotate RT, issue new AT |
| POST | `/api/auth/logout` | AT + CSRF | Revoke current RT + `jti` |
| POST | `/api/auth/logout-all` | AT + CSRF | Revoke every RT family for the user |
| GET | `/api/auth/me` | AT | Current user profile |
| GET | `/api/auth/oauth/google/start` | none | 302 to Google with `state` + PKCE |
| GET | `/api/auth/oauth/google/callback` | none | Code exchange, account create/link, issues AT+RT |
| POST | `/api/auth/link/google` | AT + CSRF | Link Google to a signed-in local account |
| DELETE | `/api/auth/link/google` | AT + CSRF | Unlink (blocked if it would leave no login method) |
| POST | `/api/auth/password` | AT + CSRF | Change password (requires current password) |
| GET | `/api/auth/sessions` | AT | List active RT families (device, IP prefix, last used) |
| DELETE | `/api/auth/sessions/:id` | AT + CSRF | Revoke one session |
| GET | `/.well-known/jwks.json` | none | Public keys for AT verification |
| GET | `/healthz`, `/readyz` | none | Liveness / readiness |

**Response envelope.** Success: `{ "data": <object> }`. Failure: `{ "error": { "code": "<STABLE_SNAKE_CODE>", "message": "<safe text>", "details": [{ "field": "...", "message": "..." }] } }`. Error codes MUST be stable strings (`INVALID_CREDENTIALS`, `RATE_LIMITED`, `VALIDATION_FAILED`, `EMAIL_TAKEN`, `TOKEN_REUSE_DETECTED`, …). Messages MUST NOT leak stack traces, SQL, or which of email/password was wrong.

### 3.3 HTTP API — `httpServer` changes

| Method | Path | Change |
|---|---|---|
| POST | `/api/room` | Now **members only** — 401 for guests |
| GET | `/api/room?roomId=` | Open to guests; `roomId` MUST match `^[a-z]{3}-[a-z]{3}-[a-z]{3}$` before any downstream call |
| GET | `/room/:roomId` | Unchanged behaviour; same `roomId` validation |
| POST | `/api/room/:roomId/ws-ticket` | **New.** Issues a single-use ws ticket after re-checking room existence/capacity |
| GET | `/login`, `/signup` | New static pages |

### 3.4 WebSocket interface (`wsServer`)

| ID | Requirement |
|---|---|
| WS-1 | The handshake MUST carry a ws ticket (`?ticket=` query parameter or `Sec-WebSocket-Protocol` value). Connections without a valid, unexpired, unconsumed ticket MUST be rejected during `verifyClient` with HTTP 401 — before any socket is allocated. |
| WS-2 | Tickets MUST be single-use (`GETDEL` in Redis) and bound to `{ roomId, subject }` where subject is a user id or `guest:<opaque-id>`. |
| WS-3 | The `roomId` in the first `join-room` message MUST equal the ticket's `roomId`; a mismatch MUST close the socket with code 1008. |
| WS-4 | Every inbound frame MUST be size-capped (`maxPayload` 64 KiB), `JSON.parse`d inside try/catch, and schema-validated by `type` before use. Unknown types MUST be dropped and counted, not echoed. |
| WS-5 | Signalling relay MUST forward only `offer`, `answer`, `ice-candidate` payloads, and only to peers in the same room. |
| WS-6 | `Origin` MUST be checked against an allow-list on handshake. |

### 3.5 Internal interface — `roomManager`

| ID | Requirement |
|---|---|
| SVC-1 | `roomManager` MUST NOT publish a host port; it stays on the internal network only (already true in [docker-compose.yml](../docker-compose.yml)). |
| SVC-2 | Every `roomManager` request MUST carry a shared service credential (`X-Internal-Token`, compared with a constant-time digest comparison). Requests without it MUST get 401. |
| SVC-3 | `roomManager` MUST validate `:roomId` against the room-code pattern and reject anything else with 400 before touching its map. |

---

## 4. Functional requirements

### 4.1 Account and credential management

| ID | Priority | Requirement |
|---|---|---|
| FR-AUTH-01 | MUST | Signup accepts `{ email, password, displayName }`, creates a `users` row with `password_hash`, and immediately issues an AT+RT pair. Email is stored case-insensitively (`citext`) and normalised (trim, Unicode NFKC, lowercase). |
| FR-AUTH-02 | MUST | Password policy: length 12–128 characters, any characters permitted (no composition rules), rejected if it appears in a bundled breached-password list or scores < 3 on `zxcvbn`, rejected if it equals or contains the email local-part. Passwords are never truncated silently. |
| FR-AUTH-03 | MUST | Passwords are hashed with **Argon2id** — `memoryCost` ≥ 19456 KiB, `timeCost` ≥ 2, `parallelism` 1, 16-byte random salt generated per password by the library, 32-byte tag. Parameters live in env so they can be raised without a code change; the encoded hash string carries its own parameters so old hashes stay verifiable. |
| FR-AUTH-04 | MUST | An optional server-side **pepper** (`PASSWORD_PEPPER`) is applied as `HMAC-SHA256(pepper, password)` before hashing. It is stored outside the database (env/secret manager) so a database-only leak is not sufficient to mount an offline attack. |
| FR-AUTH-05 | MUST | On successful password verification, if the stored hash's parameters are weaker than current config, the hash is transparently re-computed and updated. |
| FR-AUTH-06 | MUST | Login MUST take approximately constant time regardless of whether the email exists: a dummy Argon2 verification against a fixed hash runs when no user is found. |
| FR-AUTH-07 | MUST | Login failures MUST return a single generic `INVALID_CREDENTIALS` error; the response MUST NOT distinguish unknown-email from wrong-password. |
| FR-AUTH-08 | MUST | Per-account throttling: after 5 consecutive failures the account enters exponential backoff (1s, 2s, 4s … capped at 15 min) tracked in Redis, keyed by a **hash** of the email. A successful login clears the counter. Lockout MUST NOT be permanent (no denial-of-service against a known user). |
| FR-AUTH-09 | MUST | Password change requires the current password, revokes every RT family except the caller's current one, and writes an `auth_events` record. |
| FR-AUTH-10 | SHOULD | Signup with an already-registered email returns `409 EMAIL_TAKEN` in Phase 1. Once email verification exists (§4.2.7) this MUST change to a generic accepted-response to remove the enumeration oracle. The trade-off is recorded here deliberately. |
| FR-AUTH-11 | MUST | `displayName` is stored as-is (validated, §4.4) and always rendered as text, never interpolated into HTML. |
| FR-AUTH-12 | MUST | Account deletion (`DELETE /api/auth/me`) soft-deletes in one transaction: anonymise the email, clear `password_hash`, delete `oauth_accounts` rows, revoke every refresh-token family, denylist the live `jti`s, set `status = 'deleted'`. The freed email address MUST be re-registrable afterwards, and the deletion MUST be recorded in `auth_events`. Delivered in Phase 2. |

### 4.2 Sessions, JWTs and OAuth

#### 4.2.1 Token format

| ID | Priority | Requirement |
|---|---|---|
| FR-SESS-01 | MUST | The AT is a JWT signed **RS256** with `kid`, claims: `iss`, `aud` (`face2face-api`), `sub` (user uuid), `iat`, `exp`, `jti`, `sid` (session/family id), `name`, `email_verified`. TTL **15 minutes**. |
| FR-SESS-02 | MUST | Verifiers MUST check signature, `alg` against an allow-list (reject `none` and any HMAC alg), `iss`, `aud`, `exp`, `nbf`, and `jti` against the Redis revocation set. Clock skew tolerance ≤ 60 s. |
| FR-SESS-03 | MUST | The RT is 32 bytes of CSPRNG entropy, base64url-encoded, **opaque** (not a JWT). Only `SHA-256(rt)` is stored in `refresh_tokens`. TTL **30 days**, absolute lifetime not extended past 90 days from family creation. |
| FR-SESS-04 | MUST | Key rotation: `authService` MUST support two active key pairs (current + previous) published on JWKS so a rotation causes no downtime. Verifiers cache JWKS ≥ 5 min and refetch on unknown `kid` (rate-limited to 1 refetch/min). |

#### 4.2.2 Refresh rotation and reuse detection

| ID | Priority | Requirement |
|---|---|---|
| FR-SESS-05 | MUST | Every `/refresh` consumes the presented RT and issues a new one in the same family. Consumption MUST be atomic so concurrent refreshes cannot both succeed. Implemented as a **conditional update** (compare-and-swap): `UPDATE … SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`, where an affected-row count of 1 means this caller won and 0 means another already did. Two concurrent updates serialise on the row lock, and under READ COMMITTED the loser re-evaluates its `WHERE` against the committed row and matches nothing. This replaces the `SELECT … FOR UPDATE` originally specified: the guarantee is identical and no lock is held across an application round trip, so a slow client cannot pin the row. |
| FR-SESS-06 | MUST | Presenting an already-consumed or revoked RT MUST revoke the **entire family**, add every live `jti` of that family to the revocation set, return `401 TOKEN_REUSE_DETECTED`, and log a high-severity audit event. |
| FR-SESS-07 | MUST | A refresh MUST be rejected if the account is disabled or deleted. |
| FR-SESS-08 | SHOULD | RT rows record a hash of the client IP and a truncated user-agent so `/sessions` can present recognisable devices without storing raw PII. |

#### 4.2.3 Cookies and CSRF

| ID | Priority | Requirement |
|---|---|---|
| FR-SESS-09 | MUST | AT is delivered in cookie `f2f_at`: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900`. |
| FR-SESS-10 | MUST | RT is delivered in cookie `f2f_rt`: `HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=2592000`. The narrow `Path` keeps the RT off every non-auth request. |
| FR-SESS-11 | MUST | CSRF defence uses a signed double-submit token: cookie `f2f_csrf` (`Secure; SameSite=Lax`, **not** HttpOnly) whose value is `<random>.<HMAC(CSRF_SECRET, random‖sid)>`. Every state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`) MUST carry the same value in `X-CSRF-Token`; both the HMAC and the header/cookie equality MUST be verified in constant time. |
| FR-SESS-12 | MUST | In addition, state-changing requests MUST have an `Origin` (or `Referer`) header matching the allow-list; requests with neither MUST be rejected. |
| FR-SESS-13 | MUST | `Secure` MAY be relaxed only when `NODE_ENV !== 'production'` **and** the host is loopback. Production start-up MUST fail fast if `COOKIE_SECURE` is false. |
| FR-SESS-14 | MUST | Logout clears all three cookies with matching attributes, revokes the RT, and denylists the current `jti` for its remaining lifetime. |

#### 4.2.4 WebSocket tickets

| ID | Priority | Requirement |
|---|---|---|
| FR-SESS-15 | MUST | `POST /api/room/:roomId/ws-ticket` returns `{ ticket }` — a 32-byte CSPRNG id stored in Redis as `ws:ticket:<id> → {sub, roomId, ip_hash}` with a 60-second TTL. Guests receive a ticket bound to `guest:<uuid>`; members receive one bound to their user id. |
| FR-SESS-16 | MUST | `wsServer` consumes the ticket with `GETDEL` and MUST reject reuse. Rationale for tickets over cookie-on-handshake: cookies ignore port and would otherwise be replayable by any origin able to trigger a cross-site WebSocket handshake, and this keeps `wsServer` deployable on a separate host/origin. |

#### 4.2.5 Google OAuth (OIDC)

| ID | Priority | Requirement |
|---|---|---|
| FR-OAUTH-01 | MUST | Authorization Code flow with **PKCE (S256)**. `code_verifier`, `nonce`, `state`, the post-login redirect path and a hash of the client IP are stored in Redis under `oauth:state:<state>` with a 600-second TTL and are single-use. |
| FR-OAUTH-02 | MUST | The callback MUST verify: `state` exists and is consumed atomically; the id_token signature against Google's JWKS; `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}; `aud` == client id; `exp`/`iat` fresh; `nonce` matches. |
| FR-OAUTH-03 | MUST | The `next` redirect target MUST be validated as a **relative path** on this site (`^/[A-Za-z0-9/_\-?=&.]*$`, no `//`, no scheme) to prevent open redirects. |
| FR-OAUTH-04 | MUST | Identity is keyed on `(provider, provider_user_id)` — never on email alone, since provider emails can change. |
| FR-OAUTH-05 | MUST | Account linking rules: (a) known `(provider, sub)` → log in; (b) unknown `sub` and no user with that email → create user with `password_hash = NULL` and `email_verified = google's email_verified`; (c) unknown `sub` but an existing local user with the same email and `email_verified = true` on **both** sides → link automatically; (d) same email but either side unverified → do **not** auto-link; require the user to sign in with their password first and link explicitly (prevents pre-registration account takeover). |
| FR-OAUTH-06 | MUST | Provider access/refresh tokens MUST NOT be persisted; only `provider_user_id`, provider email and profile fields the app displays. |
| FR-OAUTH-07 | MUST | Unlinking Google MUST be refused when the user has no password set (would leave the account unreachable). |
| FR-OAUTH-08 | SHOULD | The provider layer is a registry (`providers/google.js` implementing a common interface) so GitHub or others can be added by configuration plus one adapter file. |
| FR-OAUTH-09 | MUST | OAuth start/callback endpoints are rate limited (§4.3) and MUST fail closed with a generic error page; provider error details go to logs only. |

#### 4.2.6 Authorisation rules

| ID | Priority | Requirement |
|---|---|---|
| FR-AUTHZ-01 | MUST | `POST /api/room` requires a valid AT. Guests get `401 AUTH_REQUIRED`. |
| FR-AUTHZ-02 | MUST | `GET /api/room` and `GET /room/:roomId` remain open to guests. |
| FR-AUTHZ-03 | MUST | Authorisation is enforced server-side on every request; hiding the Create button client-side (UI-3) is presentation only. |
| FR-AUTHZ-04 | SHOULD | Rooms record `owner_user_id`; a future private-room feature can restrict joins to invited users (not in scope now, but the schema MUST allow it). |

#### 4.2.7 Deferred, dependency-blocked items

| ID | Priority | Requirement |
|---|---|---|
| FR-MAIL-01 | SHOULD (Phase 2) | Email verification and password reset (single-use, 30-minute, SHA-256-stored tokens; reset revokes all sessions; response is always generic). Blocked on an SMTP/provider decision (A-6). The code MUST define a `Mailer` interface now, with a console transport for dev, so Phase 2 is a transport swap. |

### 4.3 Rate limiting and abuse control

| ID | Priority | Requirement |
|---|---|---|
| FR-RL-01 | MUST | All rate limiting is **Redis-backed** so limits are global across service instances. Counter updates MUST be atomic — implemented as a single Lua script (read → decide → increment → set TTL) so concurrent requests cannot exceed the limit through a check-then-act race. |
| FR-RL-02 | MUST | The algorithm is a **sliding window**: a sorted-set log (`ZREMRANGEBYSCORE` + `ZADD` + `ZCARD`) for low-volume, high-value auth routes (exact, auditable), and a two-bucket weighted sliding-window counter for high-volume routes (constant memory). |
| FR-RL-03 | MUST | Limiters key on, and enforce independently at, four scopes: **IP**, **subnet** (IPv4 `/24`, IPv6 `/64` and `/48`), **identity** (user id, or email hash on login/signup), and **global per route-class**. Subnet and global scopes are what make a distributed flood from many IPs ineffective — a per-IP-only limiter does not defend against it. |
| FR-RL-04 | MUST | Client IP is derived from `X-Forwarded-For` by taking the **(TRUST_PROXY_HOPS + 1)-th address from the right**, never the leftmost value, and only when the direct peer is a configured trusted proxy. Otherwise the socket address is used. |
| FR-RL-05 | MUST | Default limits (all configurable; window/limit pairs): |

| Route class | Per IP | Per subnet | Per identity | Global |
|---|---|---|---|---|
| `POST /api/auth/signup` | 5 / hour | 20 / hour (/24) | — | 500 / hour |
| `POST /api/auth/login` | 10 / 15 min | 60 / 15 min | 5 failures → backoff (FR-AUTH-08) | 2000 / 15 min |
| `POST /api/auth/refresh` | 60 / hour | 300 / hour | 30 / hour per `sid` | — |
| OAuth start/callback | 20 / 15 min | 100 / 15 min | — | 1000 / 15 min |
| `POST /api/auth/password` | 10 / hour | — | 5 / hour | — |
| `POST /api/room` (create) | 20 / hour | 100 / hour | 10 / min, 50 / hour | 1000 / hour |
| `GET /api/room` (join check) | 60 / min | 300 / min | — | 5000 / min |
| ws ticket + ws handshake | 20 / min | 100 / min | — | — |
| Any other API route | 300 / min | 1500 / min | — | — |
| Static assets | 600 / min | — | — | — |

| ID | Priority | Requirement |
|---|---|---|
| FR-RL-06 | MUST | A rejected request returns `429` with `Retry-After` (seconds) and `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. The body MUST NOT reveal which scope tripped. |
| FR-RL-07 | MUST | Rate limiting runs **before** any expensive work — specifically before Argon2 hashing, which is otherwise a CPU-exhaustion vector (~100–250 ms of CPU per request by design). |
| FR-RL-08 | MUST | Password hashing MUST additionally be guarded by a concurrency semaphore (`ARGON2_MAX_CONCURRENCY`, default = CPU cores); requests beyond it queue with a bounded wait and then return `503` with `Retry-After`. |
| FR-RL-09 | MUST | Redis failure policy: **fail closed** (reject with 503) for auth write routes (signup/login/refresh/password/OAuth callback); **fail open with a per-process in-memory fallback limiter** for read routes and static assets, so a Redis blip does not take the whole app down. The chosen mode per route class MUST be explicit in config. |
| FR-RL-10 | SHOULD | Adaptive defence: when global 429 rate or request rate for a class exceeds a configured threshold, the service enters *defensive mode* — limits drop to a stricter tier and unauthenticated write routes require an additional proof (CAPTCHA hook or proof-of-work). Entering/leaving defensive mode MUST be logged and exposed as a metric. |
| FR-RL-11 | MUST | Successful logins MAY be exempted from consuming the login IP budget (configurable) so a shared NAT does not lock out legitimate users; failures always consume it. |
| FR-RL-12 | MUST | Body size limits: 10 KiB for auth routes, 1 KiB for room routes, 64 KiB per WebSocket frame. Oversized requests are rejected with `413` before parsing. |
| FR-RL-13 | SHOULD | The reverse proxy SHOULD apply a coarse connection/request cap as a first line (`limit_req`), documented in the deployment guide; the app limiter is authoritative for per-identity logic. |

### 4.4 Input validation and injection prevention

| ID | Priority | Requirement |
|---|---|---|
| FR-VAL-01 | MUST | Every externally reachable input — body, query, route params, headers used in logic, cookies, and WebSocket frames — MUST be validated by a declarative schema (**Zod**) at the service edge, before any business logic. |
| FR-VAL-02 | MUST | Validation is **allow-list** based: `.strict()` objects that reject unknown keys, explicit types, explicit max lengths, explicit enums. Nothing is coerced silently. |
| FR-VAL-03 | MUST | Field rules: `email` ≤ 254 chars, RFC-5322-practical pattern, normalised (NFKC, trim, lowercase); `password` 12–128 chars, no trimming, rejected if it contains `\0`; `displayName` 1–50 chars, Unicode letters/digits/space/`-`/`_`/`'`, collapsed whitespace, no control characters or bidi overrides; `roomId` exactly `^[a-z]{3}-[a-z]{3}-[a-z]{3}$`; `state`/`code`/`ticket` base64url with length bounds. |
| FR-VAL-04 | MUST | **SQL injection:** all database access goes through the **Prisma** client, which parameterises every value it sends. `$queryRawUnsafe` and `$executeRawUnsafe` are forbidden outright, and `$queryRaw`/`$executeRaw` may be used only as tagged templates (which parameterise their interpolations) — an ESLint rule in CI MUST enforce both. Table/column identifiers are never taken from user input. Stored procedures/dynamic SQL are not used. |
| FR-VAL-05 | MUST | The application database role has `CONNECT`, `SELECT/INSERT/UPDATE/DELETE` on application tables only — no `CREATE`, no superuser, no access to other databases. Migrations run under a separate owner role. The split is expressed in `schema.prisma` as `url` (the application role, used by the running client) and `directUrl` (the owner role, used only by the Prisma Migrate CLI), so the serving process holds no DDL rights at all. |
| FR-VAL-06 | MUST | **Redis injection:** every user-derived key component MUST be validated against its schema or hashed before being concatenated into a key; commands are issued via the client's parameterised API (never `sendCommand` with a user-built string). |
| FR-VAL-07 | MUST | **Header/log injection:** values echoed into headers or logs MUST have CR/LF stripped; logs are structured JSON (no string concatenation of user input into a log line). |
| FR-VAL-08 | MUST | **XSS:** the client MUST render all peer-supplied content (chat text, display names, file names) with `textContent`. The existing `addChat(user, a.outerHTML)` path in [client/js/roomFeatures.js](../client/js/roomFeatures.js) MUST be replaced by DOM construction with `createElement` + `textContent`; downloaded file names MUST be sanitised (strip path separators and control characters) before being used as a download name. |
| FR-VAL-09 | MUST | Security headers on every HTML response: `Content-Security-Policy` (no `unsafe-eval`; explicit allow-list for the Tailwind/axios CDNs currently used by [client/html/home.html](../client/html/home.html), or, preferred, vendor those two files locally and use a strict policy), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` allowing `camera`/`microphone` for self only, and HSTS in production. |
| FR-VAL-10 | MUST | CORS: an explicit origin allow-list with `credentials: true`. Wildcard origins are forbidden. |
| FR-VAL-11 | MUST | The `express` JSON parser MUST have `limit` set and `strict: true`; malformed JSON MUST produce a `400 VALIDATION_FAILED`, not a stack trace (the current catch-all handler in [server/httpServer/app.js](../server/httpServer/app.js) returns the error page for every error and MUST be replaced by a typed error handler). |
| FR-VAL-12 | MUST | Prototype-pollution guard: reject bodies containing `__proto__`, `constructor`, `prototype` keys. |
| FR-VAL-13 | MUST | Validation failures MUST be logged with the field names and rejection reason but **never** with the field values for `password` or token fields. |

### 4.5 Room and signalling changes

| ID | Priority | Requirement |
|---|---|---|
| FR-ROOM-01 | MUST | Room codes MUST be generated with `crypto.randomInt`/`randomBytes`, not `Math.random()` — the current generator in [server/roomManager/app.js](../server/roomManager/app.js) is predictable, so an attacker can enumerate/predict codes and join others' rooms. |
| FR-ROOM-02 | MUST | Room creation MUST record `{ room_code, owner_user_id, created_at }` in Postgres for auditing and per-user quota accounting; live participant counts stay in `roomManager`'s memory. |
| FR-ROOM-03 | MUST | Room codes MUST expire: a room with 0 participants for more than `ROOM_IDLE_TTL` (default 30 min) is removed, so the in-memory map cannot grow without bound (a current unbounded-growth DoS). |
| FR-ROOM-04 | MUST | `roomManager` state MUST move to Redis (hash per room) so the service can be restarted or scaled without dropping rooms. |

### 4.6 Observability and audit

| ID | Priority | Requirement |
|---|---|---|
| FR-OBS-01 | MUST | Structured JSON logging (`pino`) with a request id propagated across services via `X-Request-Id`. |
| FR-OBS-02 | MUST | Passwords, tokens, cookies, `Authorization` headers, `code`/`state` values and full IPs MUST be redacted at the logger level, not at call sites. IPs are logged as a salted hash (raw IP only in the proxy's own access log). |
| FR-OBS-03 | MUST | `auth_events` records: signup, login success/failure, logout, refresh, reuse detection, password change, OAuth link/unlink, lockout. Retention 90 days. |
| FR-OBS-04 | SHOULD | Counters exposed for: 401/403/429 by route class, login failures, reuse detections, defensive-mode transitions, Argon2 queue depth, Redis/Postgres error rate. |
| FR-OBS-05 | MUST | `/healthz` (process alive) and `/readyz` (Postgres + Redis reachable) on every service; Compose healthchecks use them. |

---

## 5. Data requirements

### 5.1 PostgreSQL schema (`face2face` database, schema `app`)

The canonical definition is [`prisma/schema.prisma`](../prisma/schema.prisma); the SQL below is what it produces, and is the shape any reviewer should check the migration against. Constraints Prisma cannot express (the length and room-code checks) are appended to the migration by hand.

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE TABLE app.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE NOT NULL,
  email_verified  boolean NOT NULL DEFAULT false,
  password_hash   text,                       -- NULL for OAuth-only accounts
  display_name    text NOT NULL,
  avatar_url      text,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','locked','deleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz,
  CONSTRAINT email_len CHECK (length(email) <= 254),
  CONSTRAINT name_len  CHECK (length(display_name) BETWEEN 1 AND 50)
);

CREATE TABLE app.oauth_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  provider          text NOT NULL,            -- 'google'
  provider_user_id  text NOT NULL,            -- Google 'sub'
  provider_email    citext,
  linked_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX ON app.oauth_accounts (user_id);

CREATE TABLE app.refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,                 -- == JWT 'sid'
  token_hash   bytea NOT NULL UNIQUE,         -- sha256(rt)
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  revoked_at   timestamptz,
  replaced_by  uuid REFERENCES app.refresh_tokens(id),
  ip_hash      bytea,
  user_agent   text
);
CREATE INDEX ON app.refresh_tokens (user_id);
CREATE INDEX ON app.refresh_tokens (family_id);
CREATE INDEX ON app.refresh_tokens (expires_at);

CREATE TABLE app.auth_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES app.users(id) ON DELETE SET NULL,
  event_type  text NOT NULL,
  success     boolean NOT NULL,
  ip_hash     bytea,
  user_agent  text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.auth_events (user_id, created_at DESC);
CREATE INDEX ON app.auth_events (created_at);

CREATE TABLE app.rooms (
  room_code      text PRIMARY KEY CHECK (room_code ~ '^[a-z]{3}-[a-z]{3}-[a-z]{3}$'),
  owner_user_id  uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz
);
CREATE INDEX ON app.rooms (owner_user_id, created_at DESC);
```

| ID | Priority | Requirement |
|---|---|---|
| FR-DB-01 | MUST | Schema changes are applied by versioned migrations (**Prisma Migrate**), checked into git as plain SQL under `prisma/migrations/`, and applied with `prisma migrate deploy` as a deploy step — never automatically at application boot in production. Migrations MUST create their own extensions (`CREATE EXTENSION IF NOT EXISTS citext`) so a fresh database provisions itself. |
| FR-DB-02 | MUST | Connection pooling is configured on the connection string — `connection_limit`, `pool_timeout`, `connect_timeout` — since Prisma manages the pool internally. `statement_timeout` is set at the role level (`ALTER ROLE f2f_app SET statement_timeout`), not per connection. |
| FR-DB-03 | MUST | TLS is required for database connections in production (`PGSSLMODE=require` or stricter). |
| FR-DB-04 | SHOULD | A scheduled job deletes expired/revoked refresh tokens and `auth_events` older than 90 days. |

### 5.2 Redis keyspace

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `rl:{class}:ip:{ip}` | zset/string | window | Per-IP limiter |
| `rl:{class}:net:{cidr}` | zset/string | window | Per-subnet limiter |
| `rl:{class}:uid:{userId}` | zset/string | window | Per-identity limiter |
| `rl:{class}:global` | string | window | Global class limiter |
| `auth:fail:{sha256(email)}` | string | ≤ 15 min | Failed-login backoff counter |
| `oauth:state:{state}` | hash | 600 s | PKCE verifier, nonce, `next`, ip hash — single use |
| `ws:ticket:{id}` | hash | 60 s | WebSocket handshake ticket — single use (`GETDEL`) |
| `jwt:revoked:{jti}` | string | remaining AT TTL | Access-token denylist after logout/reuse |
| `defense:mode` | string | 5 min | Adaptive defensive-mode flag |

| ID | Priority | Requirement |
|---|---|---|
| FR-RD-01 | MUST | Every key MUST have a TTL; unbounded keys are forbidden. |
| FR-RD-02 | MUST | Redis MUST require a password (and TLS when not on a private network) and MUST NOT be exposed on a public interface. `maxmemory-policy` MUST be `noeviction` for the auth keyspace (or auth data isolated to its own instance/db) — evicting a rate-limit or state key silently disables a control. |
| FR-RD-03 | MUST | Tests use a dedicated Redis logical database (`REDIS_TEST_DB`, default 15) and flush only that db. |

---

## 6. Non-functional requirements

### 6.1 Security

| ID | Priority | Requirement |
|---|---|---|
| NFR-SEC-01 | MUST | The system MUST satisfy OWASP ASVS 4.0 Level 1 for V2 (authentication), V3 (session), V5 (validation), and the L2 items covering credential storage and session rotation. |
| NFR-SEC-02 | MUST | No secret (JWT private key, DB password, OAuth client secret, pepper, CSRF secret, internal service token) appears in the repository, in an image layer, or in logs. Start-up MUST fail fast when a required secret is missing or is a known default. |
| NFR-SEC-03 | MUST | All randomness used for tokens, room codes, salts, state and tickets comes from `crypto` CSPRNG. |
| NFR-SEC-04 | MUST | All secret comparisons are constant-time over fixed-length digests (C-7). |
| NFR-SEC-05 | MUST | Containers run as a non-root user, with a read-only root filesystem where feasible; `npm ci --omit=dev` is used for production images. |
| NFR-SEC-06 | MUST | Dependencies are pinned via lockfile; `npm audit --audit-level=high` runs in CI and blocks on high/critical. |
| NFR-SEC-07 | SHOULD | Automated security tests (§7.4) MUST be part of the standard suite, not a separate optional job. |

### 6.2 Performance and capacity

| ID | Priority | Requirement |
|---|---|---|
| NFR-PERF-01 | MUST | p95 latency excluding password hashing: `/api/auth/refresh` ≤ 150 ms, `/api/auth/me` ≤ 50 ms, `GET /api/room` ≤ 100 ms, measured at 50 concurrent users on the target host. |
| NFR-PERF-02 | MUST | Argon2 parameters MUST be tuned so a single verification takes 100–250 ms on the deployment host; `/api/auth/login` p95 ≤ 600 ms end-to-end. |
| NFR-PERF-03 | MUST | Rate-limiter overhead ≤ 5 ms p95 per request (one Redis round trip, pipelined across scopes). |
| NFR-PERF-04 | SHOULD | The system sustains 200 req/s of mixed API traffic on a 2-vCPU host without limiter false positives. |

### 6.3 Reliability and availability

| ID | Priority | Requirement |
|---|---|---|
| NFR-REL-01 | MUST | Postgres unavailability degrades gracefully: room join (guest path) and existing sessions with unexpired ATs keep working; only auth writes fail, with `503`. |
| NFR-REL-02 | MUST | Redis unavailability follows FR-RL-09 policy per route class. |
| NFR-REL-03 | MUST | Services handle `SIGTERM` with graceful shutdown: stop accepting, drain in-flight requests, close pools, close sockets with code 1001. |
| NFR-REL-04 | MUST | No unhandled promise rejection may crash a service; a top-level handler logs and exits deliberately only for unrecoverable states. |

### 6.4 Maintainability, portability, privacy

| ID | Priority | Requirement |
|---|---|---|
| NFR-MNT-01 | MUST | Layered structure per service: `routes → validators → controllers → services → repositories`. SQL exists only in repositories. |
| NFR-MNT-02 | MUST | Shared code (JWT verification, limiter, validators, logger) lives in `server/shared/` and is copied/mounted into each image; no duplicated crypto logic. Note: [.gitignore](../.gitignore) currently ignores `server/httpServer/redis.js`, which MUST be resolved when the shared Redis client is introduced. |
| NFR-MNT-03 | MUST | All configuration comes from environment variables, parsed and validated by one Zod schema at boot; unknown/missing/invalid config fails fast with a clear message. |
| NFR-MNT-04 | MUST | The same image runs locally and in Compose; only environment differs. |
| NFR-PRIV-01 | MUST | Personal data stored is limited to email, display name, avatar URL, hashed IPs and truncated user agents. Raw IPs are not persisted in application tables. |
| NFR-PRIV-02 | SHOULD | A documented data-deletion path exists (FR-AUTH-12) and completes within 30 days. |

---

## 7. Testing requirements

### 7.1 Framework

**Jest** is the chosen runner, with **Supertest** for HTTP-level tests. Rationale: it covers unit, integration and API testing in one tool with built-in mocking, coverage (V8), watch mode, and per-project configuration for a multi-service repo — no extra assertion/coverage/mocking dependencies. (`node:test` was considered — lighter but weaker for coverage thresholds and module mocking; Vitest offers no advantage here since the project has no bundler.) Supporting tools: `nock` for outbound HTTP stubbing (Google token/JWKS endpoints), the Prisma client against a real local test database, a real local Redis logical db, and — optionally, Phase 3 — **Playwright** for one browser end-to-end path.

| ID | Priority | Requirement |
|---|---|---|
| FR-TEST-01 | MUST | Jest projects: `unit`, `integration`, `security`, `e2e`. `npm test` runs unit + integration + security. |
| FR-TEST-02 | MUST | Tests run **against locally installed** Postgres and Redis by default (C-3). No Docker is required for `npm test`. |
| FR-TEST-03 | MUST | Integration tests use database `face2face_test` and Redis db 15, created/migrated by a global setup script. Each test file runs in a transaction that is rolled back, or truncates tables in an `afterEach`; tests MUST be order-independent and safe to run with `--runInBand` for DB-touching projects. |
| FR-TEST-04 | MUST | No test may reach the public internet. Google endpoints are stubbed with `nock`, with `nock.disableNetConnect()` (localhost allowed). |
| FR-TEST-05 | MUST | Coverage thresholds enforced in config: `authService` ≥ 85% lines/branches; validation schemas and the rate limiter ≥ 95% branches; overall repo ≥ 75%. A failing threshold fails the build. |
| FR-TEST-06 | MUST | Deterministic time: Jest fake timers (or an injected clock) for TTL/expiry/window-boundary tests. No `sleep`-based flakiness. |
| FR-TEST-07 | MUST | Test fixtures MUST use reduced Argon2 parameters (via env) so the suite stays fast, while at least one test asserts the **production** parameter values are what config produces. |

### 7.2 Required test cases (minimum)

**Unit** — password policy accept/reject table; Argon2 hash/verify round-trip, wrong password, rehash-on-parameter-change; pepper application; email/displayName/roomId normalisation and rejection sets; JWT sign/verify, and rejection of: `alg: none`, HMAC-signed token against RSA key, expired, `nbf` in future, wrong `iss`, wrong `aud`, tampered payload, unknown `kid`; RT hashing; CSRF token generation/verification; `X-Forwarded-For` parsing with 0/1/2 trusted hops and spoofed values; sliding-window arithmetic at window edges; `next`-redirect validator against `//evil.com`, `https://evil.com`, `/\evil`, encoded variants.

**Integration** — full signup → login → refresh → logout cycle asserting cookie attributes (`HttpOnly`, `Secure`, `SameSite`, `Path`, `Max-Age`) on every `Set-Cookie`; refresh rotation issues a new RT and invalidates the old one; **reuse of a consumed RT revokes the family and rejects subsequent refreshes**; concurrent double-refresh — exactly one succeeds; login with unknown email vs wrong password return identical bodies and comparable timing; account backoff after 5 failures and clearing after success; guest `POST /api/room` → 401; member `POST /api/room` → 201; guest `GET /api/room` → 200; ws handshake without ticket → 401, with a used ticket → 401, with a valid ticket → connected; `join-room` with a `roomId` other than the ticket's → closed 1008; OAuth start sets state+PKCE and redirects with correct params; callback with wrong `state`, replayed `state`, bad `nonce`, invalid id_token signature, mismatched `aud` — each rejected; callback happy path creates a user, and a second callback for the same `sub` logs into the same user; auto-link only when both sides verified; unlink refused for password-less accounts.

**Security** — SQL injection corpus (`' OR 1=1--`, `'; DROP TABLE app.users;--`, `\'`, `%27`, unicode variants, null bytes) submitted to every string field of every endpoint, asserting a 400/401 and that `app.users` still exists and no row leaked; unknown-key and prototype-pollution bodies rejected; oversized bodies → 413; XSS payloads in `displayName` and chat rendered as text (asserted at DOM level via jsdom); CSRF: state-changing request without header, with mismatched header, with foreign `Origin` — all rejected; rate limiter: N+1 requests → 429 with correct headers, parallel burst of N+10 never lets more than N through (atomicity), limits are enforced across two app instances sharing one Redis, subnet limiter trips when many distinct IPs in one /24 flood, global limiter trips across distinct subnets, fail-closed/fail-open behaviour with Redis stopped; security headers present on HTML responses.

**E2E (Phase 3, optional)** — Playwright: sign up in a browser, create a room, join it in a second context as a guest, exchange one chat message.

### 7.3 Docker verification gate

| ID | Priority | Requirement |
|---|---|---|
| FR-TEST-08 | MUST | `npm run test:docker` brings up the full Compose stack (including Postgres and Redis service containers), waits on healthchecks, runs migrations, and executes the integration + security suites against the composed stack. It MUST be run **only after** the local suite passes (C-3), and MUST be the last gate before a deploy. |
| FR-TEST-09 | MUST | The Compose test run MUST use a separate project name/volumes so it never touches local development data. |
| FR-TEST-10 | SHOULD | CI runs: lint → unit → integration (service containers) → security → `npm audit` → Docker gate. |

### 7.4 npm scripts (target)

```
test               jest --selectProjects unit integration security
test:unit          jest --selectProjects unit
test:integration   jest --selectProjects integration --runInBand
test:security      jest --selectProjects security --runInBand
test:coverage      jest --coverage
test:e2e           playwright test
test:docker        docker compose -p f2f-test -f docker-compose.yml -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from tests
db:generate        prisma generate
db:migrate         prisma migrate deploy
db:migrate:dev     prisma migrate dev
db:migrate:test    node scripts/migrate-test.js   (deploys to TEST_DATABASE_URL)
```

---

## 8. Deployment and configuration

### 8.1 Environment variables

| Variable | Service(s) | Example / default | Notes |
|---|---|---|---|
| `NODE_ENV` | all | `development` | `production` enables strict cookie/TLS checks |
| `AUTH_PORT` | auth | `3003` | |
| `DATABASE_URL` | auth | `postgres://f2f_app:…@localhost:5432/face2face?schema=app&connection_limit=10&pool_timeout=10&connect_timeout=5` | app role, no DDL; `url` in schema.prisma; pool settings ride on the query string |
| `DATABASE_URL_MIGRATIONS` | migrations | owner role, same database | `directUrl` in schema.prisma; used only by the Prisma Migrate CLI |
| `TEST_DATABASE_URL` / `TEST_DATABASE_URL_MIGRATIONS` | tests | the `face2face_test` equivalents | selected automatically when `NODE_ENV=test` |
| `PGSSLMODE` | auth | `require` in prod | |
| `REDIS_URL` | auth, http, ws | `redis://:pw@localhost:6379/0` | |
| `REDIS_TEST_DB` | tests | `15` | |
| `JWT_PRIVATE_KEY` / `JWT_PRIVATE_KEY_PREV` | auth | PEM | RS256, rotation pair |
| `JWT_PUBLIC_KEYS` / `JWKS_URL` | http, ws | JWKS endpoint | verifiers only |
| `JWT_ISSUER`, `JWT_AUDIENCE` | all | `https://face2face…`, `face2face-api` | |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` | auth | `900`, `2592000` | seconds |
| `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`, `ARGON2_MAX_CONCURRENCY` | auth | `19456`, `2`, `1`, `<cores>` | |
| `PASSWORD_PEPPER` | auth | 32-byte base64 | never in DB |
| `CSRF_SECRET` | auth, http | 32-byte base64 | |
| `COOKIE_DOMAIN`, `COOKIE_SECURE`, `COOKIE_SAMESITE` | auth, http | `localhost`, `true`, `lax` | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | auth | — | |
| `OAUTH_STATE_TTL`, `WS_TICKET_TTL` | auth, http | `600`, `60` | seconds |
| `TRUST_PROXY_HOPS` | http, ws, auth | `1` | see FR-RL-04 |
| `RATE_LIMIT_PROFILE` | all | `default` \| `strict` | selects the limits table tier |
| `ALLOWED_ORIGINS` | all | `https://app.example` | CORS + ws `Origin` check |
| `INTERNAL_SERVICE_TOKEN` | http, ws, rooms | 32-byte base64 | SVC-2 |
| `ROOM_MANAGER_URL` | http, ws | `http://roommanager:3002` | existing |
| `ROOM_IDLE_TTL` | rooms | `1800` | seconds |
| `LOG_LEVEL` | all | `info` | |

| ID | Priority | Requirement |
|---|---|---|
| FR-CFG-01 | MUST | A committed `.env.example` documents every variable with safe placeholder values; real `.env` files stay untracked. |
| FR-CFG-02 | MUST | Boot-time config validation rejects: missing secrets, secrets shorter than 32 bytes, `COOKIE_SECURE=false` in production, `ALLOWED_ORIGINS` containing `*`. |

### 8.2 Docker Compose additions

| ID | Priority | Requirement |
|---|---|---|
| FR-DEP-01 | MUST | Compose gains `postgres:16` (named volume, healthcheck `pg_isready`), `redis:7` (`--requirepass`, `appendonly yes`, healthcheck `redis-cli ping`), and `authservice`. Neither datastore publishes a host port in the production compose file. |
| FR-DEP-02 | MUST | `depends_on` uses `condition: service_healthy` for datastores. A one-shot `migrate` service runs migrations before `authservice` starts. |
| FR-DEP-03 | MUST | `httpServer` gains `/api/auth/*` proxying (or the reverse proxy routes it directly); `wsServer` gains `JWKS_URL` and `REDIS_URL`. |
| FR-DEP-04 | MUST | Production deployment sits behind a TLS reverse proxy that also proxies the WebSocket upgrade as `wss://`; the client MUST derive its WebSocket URL from `window.location.protocol` rather than the hard-coded `ws://…:3001` currently in [client/js/room.js](../client/js/room.js). |
| FR-DEP-05 | SHOULD | A backup policy for Postgres (daily dump, 7-day retention) is documented before go-live. |

---

## 9. Acceptance criteria

The work is complete when all of the following hold:

1. A new user can sign up, log out, log back in, refresh a session silently for 30 days, and log in with Google — in both a local run and the Compose run.
2. A guest can join an existing room by code and use chat/file transfer; a guest attempting to create a room receives 401 from the API, not merely a hidden button.
3. Every MUST-priority requirement in §4–§6 has at least one automated test, mapped in §10.
4. `npm test` passes on the local machine with no Docker running, and `npm run test:docker` passes afterwards.
5. Coverage thresholds in FR-TEST-05 are met.
6. The SQL injection corpus, JWT tampering, CSRF, and rate-limit concurrency tests all pass.
7. No secret is present in the repository or in `docker history` output for any built image; boot fails fast with defaults missing.
8. A load test of 200 req/s for 5 minutes shows no limiter false positives and p95 within NFR-PERF-01.

---

## 10. Traceability (requirement → verification)

| Requirement group | Verified by |
|---|---|
| FR-AUTH-01…12 | unit (policy, hashing) + integration (`signup/login/password` suites) |
| FR-SESS-01…16 | integration (cookie attributes, rotation, reuse detection, concurrent refresh, ws ticket) + unit (JWT tampering matrix) |
| FR-OAUTH-01…09 | integration with `nock`-stubbed Google (state/PKCE/nonce/id_token matrix, linking rules) |
| FR-AUTHZ-01…04 | integration (guest vs member matrix on every route) |
| FR-RL-01…13 | security project (burst concurrency, subnet flood, global cap, two-instance sharing, Redis-down policy) |
| FR-VAL-01…13 | security project (injection corpus, unknown keys, prototype pollution, headers) + jsdom XSS tests |
| FR-ROOM-01…04 | unit (CSPRNG generator distribution/pattern) + integration (idle expiry, ownership row) |
| FR-OBS-01…05 | unit (redaction serialiser) + integration (`/healthz`, `/readyz`) |
| FR-DB / FR-RD | integration (migration up/down round-trip, TTL presence assertions) |
| NFR-PERF | load test script (k6 or autocannon), run manually before release |
| NFR-SEC-02, FR-CFG-02 | boot-time config test asserting fail-fast on bad config |

---

## 11. Delivery phases

| Phase | Contents | Exit criterion |
|---|---|---|
| **P0 — Foundations** | Config schema, logger, shared Redis/Prisma clients, Jest projects, Prisma Migrate setup, `.env.example`, CI skeleton | `npm test` green with one trivial test per project |
| **P1 — Local auth** | Schema, Argon2, signup/login/refresh/logout, cookies + CSRF, JWKS, verification middleware in `httpServer`, login/signup pages, `POST /api/room` gating | Acceptance items 1–3 for the password path |
| **P2 — Validation & hardening** | Zod schemas everywhere, error envelope, security headers/CSP, XSS fix in chat, CSPRNG room codes, `roomManager` service auth, ws tickets, frame validation | Security project green |
| **P3 — Rate limiting** | Lua sliding-window limiter, four scopes, limits table, headers, fail-open/closed policy, Argon2 semaphore, adaptive defensive mode | Rate-limit test suite green, load test clean |
| **P4 — Google OAuth** | PKCE flow, callback, linking rules, `/link/google`, UI buttons | OAuth integration matrix green |
| **P5 — Ops & Docker gate** | Compose additions, healthchecks, migrate job, backups, `test:docker`, reverse-proxy config, `wss://` client change | Acceptance item 4 and 7 |
| **P6 — Deferred** | Email verification, password reset, session list UI, room history, Playwright E2E | — |

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **No TURN server.** `new RTCPeerConnection()` in [client/js/room.js](../client/js/room.js) has no ICE servers, so calls will fail for most users behind NAT once deployed — independent of auth, but a go-live blocker. | High | Add STUN + a TURN credential service before launch; out of this SRS's scope but must be tracked. |
| Redis is a single point of failure for limits and OAuth state | High | Explicit per-route fail-open/fail-closed policy (FR-RL-09); managed Redis or persistence + monitoring |
| Argon2 as a CPU-DoS vector | High | Rate limit before hashing (FR-RL-07), concurrency semaphore (FR-RL-08), 503 with `Retry-After` |
| Distributed flood from many IPs defeats a per-IP limiter | High | Subnet + global scopes (FR-RL-03), adaptive defensive mode (FR-RL-10), proxy-level caps (FR-RL-13) |
| Pre-registration account takeover via OAuth email matching | High | Strict linking rules (FR-OAUTH-05); never auto-link on unverified email |
| Refresh-token theft | High | Rotation with family reuse detection (FR-SESS-06), HttpOnly/Strict cookies, narrow `Path` |
| XSS in the existing chat renderer defeats every cookie protection's benefit for in-page actions | High | FR-VAL-08 DOM-based rendering + CSP (FR-VAL-09) |
| Shared-NAT users (offices, campuses) hitting IP limits | Medium | Successful logins exempt from IP budget (FR-RL-11); per-identity limits carry the strictness |
| In-memory `roomManager` loses all rooms on restart / grows unbounded | Medium | Idle expiry (FR-ROOM-03), Redis-backed state (FR-ROOM-04) |
| Local Redis missing on the dev machine (A-3) blocks P0 | Medium | Install Memurai/WSL Redis, or run a standalone `redis:7` container, before starting P0 |
| Migration drift between local and Compose | Medium | Single migration tool, run in both paths; `test:docker` re-runs them from scratch |

---

## 13. Open questions

1. Production domain and whether `authService` is exposed through the reverse proxy at `/api/auth/*` or as a separate subdomain (affects cookie `Domain` and CORS).
2. Should display names be unique? (Current spec: not unique; chat identifies peers by display name only.)
3. Retention period for `auth_events` if a compliance requirement (e.g. GDPR request handling) appears — currently 90 days by choice.
4. Whether room history (P6) should store peer identities or only ownership, given the privacy stance in NFR-PRIV-01.
