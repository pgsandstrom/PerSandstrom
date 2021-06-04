#!/bin/bash
set -e
set -u

cd "$(dirname "$0")"

DOMAIN="persandstrom.com"

./prep_repo_for_deploy.sh

mkdir -p "/apps/$DOMAIN"

rm -rf "/apps/$DOMAIN/*"

rsync -a site/* "/apps/$DOMAIN"

# nginx
rsync "nginx/$DOMAIN.conf" /etc/nginx/conf.d/
chmod 755 "/etc/nginx/conf.d/$DOMAIN.conf"
systemctl restart nginx.service