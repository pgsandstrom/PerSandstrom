# Games

Small games are served from `persandstrom.com/games/<name>/` instead of getting their own
subdomain.

## How it works

- Each game is its own repo with a static build (Vite).
- The game's `scripts/release.sh` builds it locally and rsyncs `dist/` to
  `/apps/persandstrom.com/games/<name>/` on the server. Nothing runs on the server.
- `do_complete_deploy.sh` excludes `/games/` from its `rsync --delete`, so deploying the home
  page never removes the games.
- nginx falls back to each game's own `index.html` for unknown paths, so client side routing
  works. See `nginx/persandstrom.com.conf`.

## Adding a game

Copy `../fightgame` as a starting point. The game's name in `package.json` is its URL, and
`vite.config.ts` sets `base` from it. A router needs that base too:
`<Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>`.

## One time server setup

certbot owns the live nginx config, so the repo copy is only used on a fresh server. On the
existing server, add the two `location ~ ^/games/...` blocks from `nginx/persandstrom.com.conf`
to the **443** server block in `/etc/nginx/conf.d/persandstrom.com.conf`, then:

```sh
nginx -t
systemctl reload nginx.service
```
