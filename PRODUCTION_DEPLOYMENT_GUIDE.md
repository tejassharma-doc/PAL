# 🚀 Production Deployment Guide - Ubuntu Server

## ❌ DO NOT: Drag-and-Drop Files!

**Why not:**
- ❌ Exposes secrets (.env files)
- ❌ Transfers unnecessary files (node_modules, uploads, etc.)
- ❌ Database won't work
- ❌ Wrong file permissions
- ❌ Can't rollback changes

---

## ✅ CORRECT: Git-Based Deployment

### Prerequisites on Ubuntu Server:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
sudo apt install -y docker.io docker-compose

# Add your user to docker group (so you don't need sudo)
sudo usermod -aG docker $USER

# Logout and login again for group to take effect
# Then verify:
docker ps
```

---

## Step 1: Push Code to Git (Windows)

```bash
cd c:/PAL

# Create .gitignore
cat > .gitignore << 'EOF'
# Environment
.env
.env.local
.env.production

# Python
__pycache__/
*.py[cod]
*$py.class
*.pyc

# Uploads
uploads/*
!uploads/.gitkeep

# MDT source (too large)
mdt-source/

# Documentation (optional - you can include these)
*.md
!README.md

# Logs
*.log

# Database
*.sql
*.db

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Node
node_modules/
.next/
dist/

# Docker
docker-compose.override.yml
EOF

# Initialize git (if not already)
git init

# Add all files
git add .

# Commit
git commit -m "Production ready - PAL Medical Platform"

# Add remote (replace with your GitHub repo)
git remote add origin https://github.com/YOUR_USERNAME/pal-medical.git

# Push
git push -u origin main
```

---

## Step 2: Deploy to Ubuntu Server

### A. Clone Repository

```bash
# SSH into your server
ssh your_username@your_server_ip

# Clone repo
cd /home/your_username
git clone https://github.com/YOUR_USERNAME/pal-medical.git
cd pal-medical
```

### B. Create Production .env File

```bash
# Create .env with production settings
nano .env
```

**Paste this (CHANGE THE VALUES!):**

```bash
# Database - ⚠️ CHANGE PASSWORD!
POSTGRES_USER=pal
POSTGRES_PASSWORD=YOUR_STRONG_PASSWORD_HERE_123456!@#$
POSTGRES_DB=pal

# Redis
REDIS_URL=redis://redis:6379/0

# MCP API - ⚠️ GENERATE NEW KEY!
PAL_API_KEY=pal-prod-$(openssl rand -hex 16)
MCP_API_URL=http://mcp-api:3001

# LiteLLM Proxy (Your existing endpoint)
OPENAI_API_BASE=http://34.14.174.141:4000/v1
OPENAI_API_KEY=sk-8cxtPKSUF-ENMMTD7pTnKg
GEMINI_MODEL=vertex_ai/google/gemma-4-26b-a4b-it-maas

# Feature Flags
DEPLOYMENT_MODE=self_hosted
AI_KEY_MODE=byo
MULTI_USER=false
ADMIN_DASHBOARD=true

# Hindsight
HINDSIGHT_ENABLED=false
HINDSIGHT_LLM_PROVIDER=openai
HINDSIGHT_LLM_MODEL=vertex_ai/google/gemma-4-26b-a4b-it-maas
HINDSIGHT_LLM_API_KEY=sk-8cxtPKSUF-ENMMTD7pTnKg
HINDSIGHT_API_BASE=http://34.14.174.141:4000/v1

# MDT
MDT_ENABLED=true
MDT_URL=http://mdt:8080
GEMINI_API_KEY=AIzaSyDUd-lkQq4A25xWTkuXT8HoIKBZtYi-Uyo
MDT_MODEL=gemini-2.5-flash
upload_dir=./uploads

# Security - ⚠️ GENERATE NEW SECRET!
SECRET_KEY=$(openssl rand -hex 32)
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30

# App
APP_NAME=PAL
ENVIRONMENT=production

# Next.js - ⚠️ CHANGE TO YOUR SERVER IP!
NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP:8000
NEXT_PUBLIC_APP_NAME=PAL
```

**Save: Ctrl+O, Enter, Ctrl+X**

### C. Build Custom MDT Image

**Option 1: Build on Server (Recommended)**

```bash
# Clone MDT source
git clone https://github.com/Google-Health/medical-data-toolkit.git mdt-source

# Update config
nano mdt-source/src/config.yaml
# Change both model lines to: "gemini-2.5-flash"

# Build
cd mdt-source
docker build -t medical-data-toolkit-custom:latest .
cd ..
```

**Option 2: Transfer Pre-built Image (If you already built it)**

On Windows:
```bash
# Save image
docker save medical-data-toolkit-custom:latest | gzip > mdt-custom.tar.gz

# Transfer to server (using SCP)
scp mdt-custom.tar.gz your_username@your_server_ip:/home/your_username/
```

On Ubuntu:
```bash
# Load image
docker load < mdt-custom.tar.gz
```

### D. Deploy Application

```bash
# Make deploy script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

**OR manually:**

```bash
# Build images
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Create audit_logs table
cat create_audit_log_table.sql | docker exec -i pal-db psql -U pal -d pal

# Check status
docker ps
```

---

## Step 3: Setup Firewall

```bash
# Allow HTTP, HTTPS, SSH
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw allow 3000/tcp # Frontend (temporary - use nginx later)
sudo ufw allow 8000/tcp # API (temporary - use nginx later)

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## Step 4: Setup Nginx Reverse Proxy (Optional but Recommended)

```bash
# Install Nginx
sudo apt install -y nginx

# Create configuration
sudo nano /etc/nginx/sites-available/pal
```

**Paste:**

```nginx
server {
    listen 80;
    server_name your_domain.com;  # Or server IP

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # API
    location /api {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Increase upload size for medical documents
    client_max_body_size 20M;
}
```

**Enable and restart:**

```bash
sudo ln -s /etc/nginx/sites-available/pal /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## Step 5: Setup SSL (HTTPS) - CRITICAL for Production!

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d your_domain.com

# Auto-renewal is setup automatically
# Test renewal
sudo certbot renew --dry-run
```

---

## Step 6: Setup Automatic Backups

```bash
# Create backup script
nano /home/your_username/backup.sh
```

**Paste:**

```bash
#!/bin/bash
BACKUP_DIR="/home/your_username/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
docker exec pal-db pg_dump -U pal pal | gzip > $BACKUP_DIR/pal_db_$DATE.sql.gz

# Backup uploads
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz -C /home/your_username/pal-medical uploads/

# Keep only last 7 days
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
```

**Make executable and add to cron:**

```bash
chmod +x /home/your_username/backup.sh

# Add to crontab (daily at 2 AM)
crontab -e

# Add this line:
0 2 * * * /home/your_username/backup.sh >> /home/your_username/backup.log 2>&1
```

---

## Step 7: Monitoring & Logs

### Check Service Status

```bash
# All containers
docker ps

# Logs
docker logs pal-api-v2 --tail 50
docker logs pal-web --tail 50
docker logs pal-mdt --tail 50
docker logs pal-db --tail 50

# Follow logs in real-time
docker logs -f pal-api-v2
```

### Check Application

```bash
# Test API
curl http://localhost:8000/docs

# Test Frontend
curl http://localhost:3000

# Test Database
docker exec pal-db psql -U pal -d pal -c "SELECT COUNT(*) FROM lab_tests;"
```

---

## Step 8: Create Default User

```bash
# Access API container
docker exec -it pal-api-v2 bash

# Run Python
python

# Create user
from models import User
from database import SessionLocal
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
db = SessionLocal()

user = User(
    username="admin",
    email="admin@yourcompany.com",
    hashed_password=pwd_context.hash("CHANGE_THIS_PASSWORD"),
    is_active=True,
    roles=["admin"]
)
db.add(user)
db.commit()

print("Admin user created!")
exit()
exit
```

---

## Troubleshooting:

### Service Won't Start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs

# Restart specific service
docker-compose -f docker-compose.prod.yml restart api
```

### Database Connection Error

```bash
# Check database is running
docker ps | grep pal-db

# Check database logs
docker logs pal-db

# Test connection
docker exec pal-db psql -U pal -d pal -c "SELECT 1;"
```

### MDT Not Working

```bash
# Check MDT container
docker logs pal-mdt

# Rebuild MDT
cd mdt-source
docker build -t medical-data-toolkit-custom:latest .
cd ..
docker-compose -f docker-compose.prod.yml restart mdt
```

### Cannot Access from External

```bash
# Check firewall
sudo ufw status

# Check nginx
sudo nginx -t
sudo systemctl status nginx
```

---

## Updating Application:

```bash
# Pull latest code
cd /home/your_username/pal-medical
git pull

# Rebuild and restart
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

---

## Security Checklist:

✅ Changed all default passwords  
✅ Generated new SECRET_KEY  
✅ Generated new PAL_API_KEY  
✅ .env file not committed to git  
✅ Firewall enabled  
✅ SSL certificate installed  
✅ Database only accessible from localhost  
✅ Regular backups configured  
✅ Docker containers auto-restart  
✅ Nginx reverse proxy setup  
✅ Strong admin password  

---

## Production URLs:

After deployment:
- **Frontend**: https://your_domain.com
- **API**: https://your_domain.com/api
- **API Docs**: https://your_domain.com/api/docs

---

## Important Files to Keep Secret:

❌ NEVER commit to git:
- `.env`
- `*.sql` (database dumps)
- `uploads/*` (patient files)
- API keys
- Passwords

---

**Ready to deploy? Follow steps 1-8 above!**
