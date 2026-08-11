#!/bin/bash
set -e
set -u

cd "$(dirname "$0")"

DOMAIN="persandstrom.com"

./prep_repo_for_deploy.sh

mkdir -p "/apps/$DOMAIN"

# --chmod sets the permissions on the deployed copy, so we never have to touch
# the permissions of the files in the repo (which git tracks, and which would
# otherwise show up as a mode change on every single file after a deploy).
rsync -a --delete --chmod=D755,F644 site/ "/apps/$DOMAIN/"

# nginx
# Only install the config if it isn't there yet. Once nginx is set up on a
# server, certbot owns that file (it adds the 443 block and cert paths), so
# overwriting it on every deploy would break https. The repo copy is the
# bootstrap config for a fresh server: plain http, which is what certbot
# needs to issue the first cert. After that, leave it alone.
NGINX_CONF="/etc/nginx/conf.d/$DOMAIN.conf"

if [ -f "$NGINX_CONF" ]
then
	echo "nginx config already exists, leaving it untouched: $NGINX_CONF"
else
	echo "Installing nginx config: $NGINX_CONF"
	rsync "nginx/$DOMAIN.conf" /etc/nginx/conf.d/
	chmod 644 "$NGINX_CONF"
	nginx -t
	systemctl reload nginx.service
fi