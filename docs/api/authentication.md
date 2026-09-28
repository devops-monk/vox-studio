# Authentication

Every request needs a token or an **API key**. The only exceptions are `GET /v1/status`, `/docs` and `/openapi.json`.

## Sending the token
Preferred: an HTTP header.
```
Authorization: Bearer <token>
```

For audio URLs used directly in an `<audio>` or `<video>` tag, where you can't set headers, add a query parameter instead:
```
/v1/takes/<id>/audio?token=<token>
```

A missing or wrong token returns `401` with `{"error": "unauthorized", …}`.

## Where tokens come from
| How voxd was started | Token |
|---|---|
| By the VoxStudio app | A fresh random token on every launch, shared only with the app window. |
| By you (`python -m voxd`) | Whatever you put in the `VOXD_TOKEN` environment variable. If it's unset, auth is off. |

## API keys (for your scripts and tools)
The app's token changes every launch, so for anything of your own, use an **API key**. Create one in **Developer** or **Integrations** (**Create key**).
- A key looks like `vox_sk_…`. It is shown **once**; voxd stores only a SHA-256 hash of it.
- Send it exactly like the token: `Authorization: Bearer vox_sk_…`, or `?token=vox_sk_…` for WebSockets and media URLs.
- A key can do everything except manage keys. `/v1/keys` answers `403 forbidden` to a key.
- **Revoke** a key at any time. Requests using it then fail with `401`.
- The list shows each key's name, a short hint (`vox_sk_P0F…ptw2`), and when it was last used.

See [API keys & connection](reference/keys.md) for the endpoints.

## Why a token on localhost?
Any website open in your browser can try to send requests to `127.0.0.1`. The token makes sure only VoxStudio and the tools you authorize can use your voices. voxd also allows cross-origin requests only from the VoxStudio app itself.
