# CryptoPay — Self-Hosted Deployment Guide

## What you need on your server
- Docker + Docker Compose
- Nginx
- Certbot (free SSL)
- Node.js 20+ (only to build the widget once)

---

## 1. Install Docker (if not already installed)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. Clone / upload the project

Upload the `saas/` folder to your server (via VS Code Remote SSH, SCP, or Git).

```bash
# Example with SCP from your local machine
scp -r ./saas user@YOUR_SERVER_IP:/var/www/cryptopay
```

Or use VS Code's Remote-SSH extension — connect to your server, open the folder directly.

---

## 3. Edit docker-compose.yml

Open `docker-compose.yml` and replace these values:

```yaml
# postgres service
POSTGRES_PASSWORD: YOUR_STRONG_DB_PASSWORD

# backend service
DATABASE_URL: postgres://cryptopay:YOUR_STRONG_DB_PASSWORD@postgres:5432/cryptopay
ADMIN_JWT_SECRET: run `openssl rand -base64 64` and paste result
CLIENT_JWT_SECRET: run `openssl rand -base64 64` and paste result (different from above)
ADMIN_EMAIL: admin@yourdomain.com
ADMIN_PASSWORD: YourStrongAdminPassword
ADMIN_DASHBOARD_URL: https://admin.yourdomain.com
CLIENT_DASHBOARD_URL: https://app.yourdomain.com
PLATFORM_URL: https://api.yourdomain.com

# admin service
NEXT_PUBLIC_API_URL: https://api.yourdomain.com

# client service
NEXT_PUBLIC_API_URL: https://api.yourdomain.com
NEXT_PUBLIC_PLATFORM_URL: https://api.yourdomain.com
```

**Generate secure secrets:**
```bash
openssl rand -base64 64  # run twice, use each output for one secret
```

---

## 4. Build and start all services

```bash
cd /var/www/cryptopay
docker compose up -d --build
```

Check everything is running:
```bash
docker compose ps
docker compose logs backend   # watch for "Server running on port 4000"
```

---

## 5. Build the widget JS

The widget is a plain JS file your clients embed. Build it once (and rebuild whenever you update the widget code):

```bash
cd /var/www/cryptopay/widget
npm install
npm run build
# Output: dist/widget.js
```

Copy it somewhere Nginx can serve it:
```bash
sudo mkdir -p /var/www/widget
sudo cp dist/widget.js /var/www/widget/widget.js
```

---

## 6. Install Nginx

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## 7. Nginx config

Create `/etc/nginx/sites-available/cryptopay`:

```nginx
# ── API / Backend ────────────────────────────────────────────────────────────
server {
    server_name api.yourdomain.com;

    location / {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    # Serve widget.js as a static file with CORS so any website can load it
    location /widget.js {
        alias        /var/www/widget/widget.js;
        add_header   Access-Control-Allow-Origin *;
        add_header   Cache-Control "public, max-age=300";
        gzip_static  on;
    }

    listen 80;
}

# ── Admin Panel ──────────────────────────────────────────────────────────────
server {
    server_name admin.yourdomain.com;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    listen 80;
}

# ── Client Dashboard ─────────────────────────────────────────────────────────
server {
    server_name app.yourdomain.com;

    location / {
        proxy_pass         http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    listen 80;
}
```

Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/cryptopay /etc/nginx/sites-enabled/
sudo nginx -t          # check for syntax errors
sudo systemctl reload nginx
```

---

## 8. Point your DNS to the server

Go to your domain registrar / DNS panel and add three A records:

| Name             | Type | Value              |
|------------------|------|--------------------|
| api.yourdomain.com  | A    | YOUR_SERVER_IP  |
| admin.yourdomain.com| A    | YOUR_SERVER_IP  |
| app.yourdomain.com  | A    | YOUR_SERVER_IP  |

DNS propagation takes 2–30 minutes.

---

## 9. Get free SSL certificates

```bash
sudo certbot --nginx -d api.yourdomain.com -d admin.yourdomain.com -d app.yourdomain.com
```

Certbot edits your Nginx config automatically and sets up auto-renewal. Done.

---

## 10. Test everything

| URL | Should show |
|-----|-------------|
| `https://api.yourdomain.com/health` | `{"status":"ok"}` (if you have a health route) |
| `https://admin.yourdomain.com` | Admin login page |
| `https://app.yourdomain.com` | Client login / register page |
| `https://api.yourdomain.com/widget.js` | The minified widget JS |

---

## 11. The embed snippet your clients will use

Once live, your clients paste this on their website:

```html
<script
  src="https://api.yourdomain.com/widget.js"
  data-api-key="THEIR_API_KEY"
  data-plan-id="THEIR_PLAN_ID"
></script>
```

Or to attach to their own button:

```html
<script
  src="https://api.yourdomain.com/widget.js"
  data-api-key="THEIR_API_KEY"
  data-plan-id="THEIR_PLAN_ID"
  data-container="pay-btn-div"
></script>
<div id="pay-btn-div"></div>
```

Or open it programmatically:
```js
CryptoPay.open();
```

---

## Updating the widget after code changes

```bash
cd /var/www/cryptopay/widget
npm run build
sudo cp dist/widget.js /var/www/widget/widget.js
```

No restart needed — Nginx serves the file directly.

## Updating the backend / dashboards after code changes

```bash
cd /var/www/cryptopay
docker compose up -d --build backend     # restart only backend
docker compose up -d --build admin       # restart only admin
docker compose up -d --build client      # restart only client dashboard
```

## View logs

```bash
docker compose logs -f backend    # live backend logs
docker compose logs -f postgres   # database logs
```

## Database backup

```bash
docker exec cryptopay-postgres-1 pg_dump -U cryptopay cryptopay > backup_$(date +%Y%m%d).sql
```

---

## Firewall (recommended)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
# Do NOT expose ports 4000, 3001, 3002 — Nginx proxies them
```

---

## Subdomains summary

| Subdomain | What it is |
|-----------|-----------|
| `api.yourdomain.com` | Backend + widget.js file |
| `admin.yourdomain.com` | Your internal admin panel |
| `app.yourdomain.com` | Your clients' login dashboard |
