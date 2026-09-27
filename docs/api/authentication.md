# Authentication

Every request except `GET /v1/status`, `/docs` and `/openapi.json` needs a token.

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

> **Coming in M14:** long-lived **API keys** you can create and revoke in **Settings → Developer**, so scripts can talk to the voxd that the app manages.

## Why a token on localhost?
Any website open in your browser can try to send requests to `127.0.0.1`. The token makes sure only VoxStudio and the tools you authorize can use your voices. voxd also allows cross-origin requests only from the VoxStudio app itself.
