#!/bin/bash
# =====================================================================
#  pw-https: sets the game's web address (Caddy gets the HTTPS certificates by itself).
#  usage:  sudo pw-https
#              -> free address based on this server's IP (e.g. 3-15-20-7.sslip.io)
#          sudo pw-https polyweave.gg
#              -> your own domain (its DNS "A record" must point at the server's static IP first)
#          sudo pw-https polyweave.gg www.polyweave.gg polyweave.duckdns.org
#              -> the FIRST address is the main one; every other address sends visitors to it
#                 (so old links and "www." keep working)
#  Install / update on the server:  sudo install -m 755 /opt/polyweave/pw-https.sh /usr/local/bin/pw-https
# =====================================================================
set -e
MAIN="$1"
if [ -z "$MAIN" ]; then
  IP=$(curl -s https://checkip.amazonaws.com)
  MAIN="${IP//./-}.sslip.io"
fi
shift || true
CF=/etc/caddy/Caddyfile
[ -f "$CF" ] && cp "$CF" "$CF.bak"
{
  echo "$MAIN {"
  echo "	encode gzip"
  echo "	reverse_proxy 127.0.0.1:3000"
  echo "}"
  if [ $# -gt 0 ]; then
    echo "$(echo "$*" | sed 's/ /, /g') {"
    echo "	redir https://$MAIN{uri} permanent"
    echo "}"
  fi
} > "$CF"
if ! caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
  echo "That address didn't work - nothing changed."
  [ -f "$CF.bak" ] && cp "$CF.bak" "$CF"
  exit 1
fi
systemctl reload caddy || systemctl restart caddy
echo
echo "PolyWeave is at:  https://$MAIN"
[ $# -gt 0 ] && echo "(these now send visitors there: $*)"
echo "(HTTPS certificates can take up to a minute the first time)"
