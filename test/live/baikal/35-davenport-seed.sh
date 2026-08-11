#!/bin/sh
# Gives Baikal the configuration and the one DAV account its web installer
# would otherwise have to be clicked through to produce. The image runs
# every executable script in this directory before starting the web
# server; this one numbers after the script that creates the database
# folder and before the one that fixes ownership. It does nothing when the
# volumes already hold an instance.
#
# The version below must match the image tag in docker-compose.yml: Baikal
# sends a browser to its installer when it finds a configuration written
# by an older release than the one running.

set -e

version=0.10.1
realm=BaikalDAV
username=davenport
password=davenport

config=/var/www/baikal/config/baikal.yaml
database=/var/www/baikal/Specific/db/db.sqlite
schema=/var/www/baikal/Core/Resources/Db/SQLite/db.sql

# Baikal stores passwords as the HTTP Digest A1 hash, for both Basic and
# Digest authentication.
digest() {
	printf '%s:%s:%s' "$1" "$realm" "$2" | md5sum | cut -d ' ' -f 1
}

mkdir -p "$(dirname "$config")" "$(dirname "$database")"

if [ ! -f "$config" ]; then
	echo "35-davenport-seed.sh: writing $config"
	cat >"$config" <<CONFIG
system:
    configured_version: '$version'
    timezone: 'UTC'
    card_enabled: false
    cal_enabled: true
    invite_from: ''
    dav_auth_type: 'Basic'
    admin_passwordhash: '$(digest admin "$password")'
    failed_access_message: 'user %u authentication failure for Baikal'
    auth_realm: '$realm'
    base_uri: ''
database:
    encryption_key: 'davenport-live-verification'
    backend: 'sqlite'
    sqlite_file: '$database'
CONFIG
fi

if [ ! -s "$database" ]; then
	echo "35-davenport-seed.sh: creating $database for $username"
	sqlite3 "$database" <"$schema"
	sqlite3 "$database" <<SQL
INSERT INTO users (username, digesta1)
    VALUES ('$username', '$(digest "$username" "$password")');
INSERT INTO principals (uri, displayname, email)
    VALUES ('principals/$username', 'Davenport', '$username@localhost');
INSERT INTO calendars (components) VALUES ('VEVENT,VTODO');
INSERT INTO calendarinstances
    (calendarid, principaluri, access, displayname, uri, description,
     calendarorder, transparent, share_invitestatus)
    VALUES (last_insert_rowid(), 'principals/$username', 1, 'Default',
            'default', 'Live verification calendar', 0, 0, 2);
SQL
fi
