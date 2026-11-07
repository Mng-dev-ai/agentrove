#!/bin/sh
case "$1" in
"Username for 'https://github.com': ") echo "x-access-token" ;;
"Password for 'https://x-access-token@github.com': ") echo "$GITHUB_TOKEN" ;;
esac
