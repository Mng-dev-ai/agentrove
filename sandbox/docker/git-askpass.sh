#!/bin/sh
case "$1" in
"Username for '"*"': ")
    answer=x-access-token
    url=${1#"Username for '"}
    ;;
"Password for '"*"': ")
    answer=$GITHUB_TOKEN
    url=${1#"Password for '"}
    ;;
*) exit 0 ;;
esac
url=${url%"': "}
case "$url" in
https://*) ;;
*) exit 0 ;;
esac
authority=${url#https://}
authority=${authority%%/*}
case "$authority" in
*@*@*) exit 0 ;;
esac
case "${authority#*@}" in
github.com | www.github.com) echo "$answer" ;;
esac
