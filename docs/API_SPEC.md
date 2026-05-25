# API Specification

Base URL: `http://localhost:5000/api`

All responses: `{ success: boolean, message: string, data?: T }`

---

## Auth

### POST /auth/register
**Body:** `{ email, password, username }`
**Success 201:** `{ data: { user } }`
**Errors:** 400 validation, 409 duplicate email/username

Password rules: min 8 chars, 1 uppercase, 1 number.

### POST /auth/login
**Body:** `{ email, password }`
**Success 200:** `{ data: { access_token, refresh_token, user } }`
**Errors:** 401 invalid credentials

Tokens: access expires 1h, refresh expires 7d.

### POST /auth/refresh
**Body:** `{ refresh_token }`
**Success 200:** `{ data: { access_token } }`
**Errors:** 401 invalid/expired token

### GET /auth/me
**Header:** `Authorization: Bearer <access_token>`
**Success 200:** `{ data: { user } }`
**Errors:** 401 unauthorized

### POST /auth/logout
**Header:** `Authorization: Bearer <access_token>`
**Success 200:** `{ message: "Logged out successfully" }`

---

## Phase 2+ (coming)

- `POST /drive/auth-url`
- `POST /drive/auth-callback`
- `GET /drive/files`
- `POST /drive/sync`
- `GET|POST|PUT|DELETE /files`
- `GET|POST|PUT|DELETE /projects`
- `GET /graph`
- `POST /connections`
- `GET|POST /crawler/status|start`
