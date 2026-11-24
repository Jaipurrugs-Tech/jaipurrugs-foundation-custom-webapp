# Deploying survey.jaipurrugs.org

The app runs on the foundation's server under PM2 as `jaipurrugs-foundation` (port 3002, behind Nginx).

## Deploy

```bash
ssh jrf-server '~/jrf/current/scripts/deploy.sh'
```

`scripts/deploy.sh`:

1. Checks out `origin/main` into a new folder, `~/jrf/releases/<time>-<sha>/` (a git worktree of `~/jaipurrugs-foundation-custom-webapp`).
2. Links in the secrets from `~/jrf/shared/.env.local`, runs `npm ci` and `npm run build` **in that folder**. If either fails, it stops: the live site is untouched.
3. Points `~/jrf/current` at the new folder and restarts PM2.
4. Checks the site answers on `http://127.0.0.1:3002/auth/login` within a minute. If not, it points `current` back at the previous release and restarts again.
5. Keeps the last 3 releases and 10 build logs (`~/jrf/logs/`).

Only one deploy can run at a time. To change a secret, edit `~/jrf/shared/.env.local` and run `pm2 restart jaipurrugs-foundation`.

**Never** run `npm run build` in the live folder (`~/jrf/current`) or restart PM2 halfway through a build: that is what caused the ~390-restart crash loop on 17 Nov 2026.

## Roll back by hand

```bash
ls ~/jrf/releases                     # pick an earlier release
ln -sfn ~/jrf/releases/<name> ~/jrf/current && pm2 restart jaipurrugs-foundation
```

## PM2 crash-loop protection

`ecosystem.config.cjs` sets `min_uptime 30s`, `max_restarts 10` and an exponential back-off, so a broken start stops after 10 quick crashes instead of looping hundreds of times (PM2 then shows the app as `errored`). It also restarts the app if memory passes 1.5 GB.

After changing `ecosystem.config.cjs`, deploy it, then:

```bash
pm2 delete jaipurrugs-foundation && pm2 start ~/jrf/current/ecosystem.config.cjs && pm2 save
```

## Not covered yet (needs a server admin with sudo)

- `pm2 startup`: so PM2 and every app come back by themselves after the server reboots.
- `pm2 install pm2-logrotate`: log rotation is a PM2-wide setting shared by every app on this server, so agree it with whoever runs the other apps first. Logs are small for now (~9 MB).
