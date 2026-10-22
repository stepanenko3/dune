#!/bin/sh
# У контейнері jmap (спільний pid-простір із замороженим сервером): знайти глобальні змінні UE й зняти рефлексію в usmap.
# Вихід — /out/dune.jmap.gz і /out/dune.usmap. BUILD — номер збірки (changelist).
set -eu
pid=$(pgrep -x DuneSandboxServ | head -n 1)
[ -n "$pid" ] || { echo "процесу сервера нема" >&2; exit 3; }
g=$(python3 -I /opt/find_globals.py "$pid")
val() { printf '%s' "$g" | python3 -I -c "import json,sys; print(json.load(sys.stdin)[sys.argv[1]])" "$1"; }
jmap_dumper --skip-vtables --pid "$pid" \
  --fname-pool "$(val fnamePool)" --guobject-array "$(val guobjectArray)" --image-base "$(val imageBase)" \
  --engine-version 5.2 --target x86_64-unknown-linux-gnu --build-changelist "${BUILD:-unknown}" /out/dune.jmap.gz
jmap_dumper --jmap /out/dune.jmap.gz /out/dune.usmap
