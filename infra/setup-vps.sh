#!/usr/bin/env bash
# Ubuntu 22.04/24.04 VPS için tek seferlik hazırlık: Docker kurulumu + güvenlik duvarı.
# Kullanım: sudo bash infra/setup-vps.sh
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH
  ufw allow 80/tcp            # HTTPS sertifikası (Let's Encrypt)
  ufw allow 443/tcp           # API + LiveKit sinyal (WSS)
  ufw allow 7881/tcp          # WebRTC TCP yedeği
  ufw allow 3478/udp          # TURN
  ufw allow 50000:60000/udp   # WebRTC medya (ses/görüntü)
  ufw --force enable
fi

cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
  sed -i "s/^LIVEKIT_API_SECRET=.*/LIVEKIT_API_SECRET=$(openssl rand -hex 32)/" .env
  echo ".env oluşturuldu. DISKORT_DOMAIN ve LIVEKIT_DOMAIN değerlerini düzenle, sonra:"
  echo "  docker compose up -d --build"
fi
