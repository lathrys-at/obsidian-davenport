#!/bin/sh
# Baikal needs a configuration file and one DAV account before Baikal can
# answer CalDAV requests. The web installer of Baikal makes both, and a
# person must click through that installer. This script makes both
# instead, so no person opens the installer.
#
# The image runs every executable script in the entrypoint directory
# /docker-entrypoint.d before the image starts the web server. The name
# of this script starts with 35. This number puts the script after the
# script that makes the database folder, and before the script that
# corrects the ownership.
#
# The script does nothing if the volumes already hold a Baikal instance.
# An instance here is the configuration file together with the database.
#
# The version value below must match the image tag in docker-compose.yml.
# Baikal compares the release that wrote the configuration against the
# release that runs. If the release that wrote the configuration is the
# older release, Baikal sends the browser to the installer.

set -e

version=0.10.1
realm=BaikalDAV
username=davenport
password=davenport

config=/var/www/baikal/config/baikal.yaml
database=/var/www/baikal/Specific/db/db.sqlite
schema=/var/www/baikal/Core/Resources/Db/SQLite/db.sql

# The digest function makes the HTTP Digest A1 hash of a username and a
# password. Baikal stores every password in this form. Baikal uses this
# form for Basic authentication and for Digest authentication.
digest() {
	printf '%s:%s:%s' "$1" "$realm" "$2" | md5sum | cut -d ' ' -f 1
}

mkdir -p "$(dirname "$config")" "$(dirname "$database")"

if [ ! -f "$config" ]; then
	echo "35-davenport-seed.sh: the script writes $config"
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
	echo "35-davenport-seed.sh: the script makes $database for the user $username"
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
