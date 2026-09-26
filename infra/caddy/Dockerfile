# Caddy + katman-4 eklentisi (caddy-l4): 443 portunu HTTPS siteleri ile TURN/TLS arasında
# TLS alan adına (SNI) göre paylaştırmak için.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-l4

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
