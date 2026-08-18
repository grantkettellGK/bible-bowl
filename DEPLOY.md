# Deploying to DigitalOcean

Recommended setup: a **$6/mo Basic Droplet** running Docker, with Caddy providing
automatic HTTPS. SQLite lives on the droplet's disk, so there's no separate
database to pay for or manage.

> Why not DO App Platform? App Platform containers have an **ephemeral filesystem** —
> the SQLite database would be wiped on every deploy/restart. It would require a
> managed Postgres database (~$15/mo extra) and code changes. A droplet keeps the
> app exactly as-is.

## 1. Create the droplet

1. DigitalOcean → **Create → Droplets**
2. Image: **Marketplace → Docker on Ubuntu** (or plain Ubuntu 24.04 and `apt install docker.io docker-compose-v2`)
3. Size: Basic / Regular — **$6/mo (1 GB RAM)** is plenty
4. Choose a datacenter near your students
5. Authentication: SSH key (recommended)
6. Create, and note the droplet's public IP

## 2. Point a domain at it (needed for HTTPS)

Add an **A record** for e.g. `biblebowl.yourdomain.com` → your droplet's IP.
(You can run IP-only over plain HTTP for a quick test, but use HTTPS for real use —
students are typing passwords.)

## 3. Get the code onto the droplet

From this project folder on your PC:

```bash
scp -r server.js package.json Dockerfile lib public docker-compose.yml Caddyfile root@YOUR_IP:/opt/bible-bowl/
```

(Or push the folder to a private GitHub repo and `git clone` it on the droplet.)

## 4. Configure and launch

SSH in, set your domain in the Caddyfile, and start:

```bash
ssh root@YOUR_IP
cd /opt/bible-bowl
sed -i 's/biblebowl.example.com/biblebowl.yourdomain.com/' Caddyfile
docker compose up -d
```

That's it. Caddy fetches a TLS certificate automatically. Visit
`https://biblebowl.yourdomain.com`, **create your account first** (the first
account becomes the coach/admin), upload your scripture JSON, and share the link
with students.

## 5. Backups

Everything is in one SQLite file. From your PC:

```bash
scp root@YOUR_IP:/opt/bible-bowl/data/biblebowl.db ./biblebowl-backup.db
```

Run that on a schedule (or enable DO's droplet backups, +20% of droplet cost).

## Updating the app

```bash
cd /opt/bible-bowl
docker compose up -d --build
```

(After re-copying changed files. The `data/` volume is untouched by rebuilds.)

## Firewall (recommended)

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```
