# Games

Small games are served from `persandstrom.com/games/<name>/` instead of getting their own
subdomain. A game is either static only, or static plus a small Node backend for WebSockets.

```
browser ── https://persandstrom.com/games/<name>/   ──► nginx ──► /apps/persandstrom.com/games/<name>/  (static files)
browser ── wss://persandstrom.com/games/<name>/ws   ──► nginx ──► /run/games/<name>/server.sock
                                                                    └─ game@<name>.service: node /apps/game-servers/<name>/server.cjs
```

No Docker: games are released often and are tiny, so each one is a single bundled JS file run by
systemd. Every game repo is the source of truth for its game, nothing on the server needs
backing up (see [Rebuilding the server](#rebuilding-the-server-from-scratch)).

## How it works

### Static part

- Each game is its own repo with a static build (Vite).
- The game's `scripts/release.sh` builds it locally and rsyncs `dist/` to
  `/apps/persandstrom.com/games/<name>/` on the server.
- `do_complete_deploy.sh` excludes `/games/` from its `rsync --delete`, so deploying the home
  page never removes the games.
- nginx falls back to each game's own `index.html` for unknown paths, so client side routing
  works. See `nginx/persandstrom.com.conf`.

### Backend (optional)

- The game's `server/main.ts` is bundled by esbuild into one file, `dist-server/server.cjs`,
  dependencies included. So the server needs Node, but no `npm install` and no `node_modules`.
- `release.sh` rsyncs it to `/apps/game-servers/<name>/`. That is outside the web root on
  purpose, so nginx can never serve the server code.
- It runs as `game@<name>.service`, an instance of the template unit `systemd/game@.service`
  (installed by `do_complete_deploy.sh`). systemd starts it on boot, restarts it if it crashes,
  and collects its logs.
- The service gets `SOCKET=/run/games/<name>/server.sock` and must listen there (with
  `readableAll`/`writableAll`, since nginx runs as another user). systemd creates
  `/run/games/<name>/` on start and removes it on stop, so there is never a stale socket.
- nginx proxies `/games/<name>/ws` to that socket. One generic block for all games, so adding a
  game never touches nginx. A game without a backend just gets a 502 on that path.
- The service runs with `DynamicUser=yes`: a throwaway user and a read only file system (except
  `/tmp`). If a game ever needs to keep data, add `StateDirectory=games/%i` to the unit, which
  gives it a writable `/var/lib/games/<name>/` that survives restarts (and needs a backup).
- A release restarts the service, which drops all WebSocket connections. Clients must reconnect
  (fightgame's `src/useOnlineCount.ts` does). The server should ping clients more often than
  nginx's `proxy_read_timeout` (1h), or nginx drops idle connections.

## Adding a game

Copy `../fightgame` as a starting point. The game's name in `package.json` is its URL, and
`vite.config.ts` sets `base` from it. A router needs that base too:
`<Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>`.

The name ends up in an nginx regex and a systemd unit name, so keep it to `a-z`, `0-9`, `-`
and `_`.

- **With a backend:** keep `server/`, `src/protocol.ts` and `src/useOnlineCount.ts` as examples.
  Dev is `pnpm dev` plus `pnpm dev:server`. Vite proxies `/games/<name>/ws` to the dev server,
  so the client uses the same URL in dev and production.
- **Static only:** delete `server/` and the files above, the `ws`/`esbuild`/`@types/ws`
  dependencies, `build:server` and `dev:server` and the `&& npm run build:server` in `build`,
  and the proxy in `vite.config.ts`. `release.sh` skips the backend when `server/main.ts` is
  missing.

Then `pnpm release`. The first release of a game with a backend also enables its service.

## Operating game backends

On the server:

```sh
systemctl status game@fightgame         # running?
journalctl -u game@fightgame -f         # logs (console.warn/error from the server)
systemctl restart game@fightgame
systemctl list-units 'game@*'           # all game backends
```

Removing a game:

```sh
systemctl disable --now game@fightgame
rm -r /apps/game-servers/fightgame /apps/persandstrom.com/games/fightgame
```

## One time setup on the existing server

certbot owns the live nginx config, so the repo copy is only used on a fresh server. On the
existing server, add the three `location ~ ^/games/...` blocks from `nginx/persandstrom.com.conf`
to the **443** server block in `/etc/nginx/conf.d/persandstrom.com.conf`, in the same order (the
`/ws` block must come first), then:

```sh
nginx -t
systemctl reload nginx.service
```

For backends, also:

1. Install Node 24 so that it is at `/usr/bin/node` (the unit runs that path), for example from
   the NodeSource packages. Check with `/usr/bin/node --version`.
2. Run `./do_complete_deploy.sh` once, which installs `game@.service` and creates
   `/apps/game-servers/`.

## Rebuilding the server from scratch

Everything comes back from the repos: this one for the home page, nginx and systemd, each game's
repo for the game. As root on the new server:

1. Install the packages: `nginx`, `rsync`, `git`, `certbot` with its nginx plugin, and Node 24
   at `/usr/bin/node` (see above).
2. Allow the release SSH key: add the public half of the key the game repos use (`./id_rsa`
   there) to `/root/.ssh/authorized_keys`.
3. Clone this repo anywhere and run `./do_complete_deploy.sh`. It deploys the home page,
   installs `game@.service`, and, since there is no nginx config yet, installs the repo's
   (plain http) `nginx/persandstrom.com.conf`.
4. Point DNS for `persandstrom.com` and `www.persandstrom.com` at the server, then get the
   certificate: `certbot --nginx -d persandstrom.com -d www.persandstrom.com`. certbot adds
   https to the existing server block, so the `/games/` blocks carry over and no manual nginx
   edit is needed.
5. Release every game again: `pnpm release` in each game repo. Backends are enabled by their
   first release.
6. Check: https://persandstrom.com/, each game, and `systemctl list-units 'game@*'`.
