# jmap_dumper (знімає рефлексію UE з живого процесу → usmap) з патчем розкладки UClass для Dune: Awakening.
# Збирання: docker build --platform linux/amd64 -t sandwalkers/gd-jmap:1 tools/game-extractor/usmap
FROM --platform=linux/amd64 rust:1-bookworm AS build
ARG JMAP_COMMIT=06358743191bd3942b6824666f7a02ce07b19fe8
WORKDIR /src
RUN git clone https://github.com/trumank/jmap.git . && git checkout "$JMAP_COMMIT"
COPY jmap-dune-uclass.patch /tmp/
RUN git apply /tmp/jmap-dune-uclass.patch && cargo build --release -p jmap_dumper

FROM --platform=linux/amd64 debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 procps && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/jmap_dumper /usr/local/bin/jmap_dumper
COPY find_globals.py dump.sh /opt/
RUN chmod +x /opt/dump.sh
