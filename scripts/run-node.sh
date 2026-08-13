#!/usr/bin/env bash
# Вузол PHANTOM: один процес, два слухачі.
#
#   :8000  http  — робочий стіл, лише loopback (браузер не сваритиметься
#                  на самопідписаний сертифікат)
#   :8443  https — телефони, з прибитим у QR відбитком
#
# Розділені навмисно: у браузера немає способу тихо прийняти власний
# сертифікат, а в телефона він є — і саме телефон ходить через мережу.
# TLS-слухача піднімає сам застосунок (security/tls_listener.py) на
# LAN-адресах і перепідключає їх, коли мережа змінюється; другий uvicorn
# для цього більше не потрібен.
set -euo pipefail

cd "$(dirname "$0")/../src/backend"

PORT_HTTP="${PHANTOM_HTTP_PORT:-8000}"
export PAIR_TLS_PORT="${PHANTOM_TLS_PORT:-8443}"

LAN_IP=$(.venv/bin/python - <<'PY'
import sys
sys.path.insert(0, ".")
from security.tls_identity import ensure_node_cert, cert_fingerprint_sha256
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("8.8.8.8", 53)); ip = s.getsockname()[0]
except OSError:
    ip = "127.0.0.1"
finally:
    s.close()
ensure_node_cert([ip])
print("відбиток вузла:", cert_fingerprint_sha256(), file=sys.stderr)
print(ip)
PY
)

pkill -f "uvicorn main:app" 2>/dev/null || true
sleep 1

setsid nohup .venv/bin/uvicorn main:app --host 127.0.0.1 --port "$PORT_HTTP" \
  > /tmp/phantom-http.log 2>&1 < /dev/null &

echo "робочий стіл: http://127.0.0.1:$PORT_HTTP"
echo "телефони:     https://$LAN_IP:$PAIR_TLS_PORT"
