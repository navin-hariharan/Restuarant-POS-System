# syntax=docker/dockerfile:1
# Restaurant POS: one container with the Rust server and the web app.
# Developed by Navin Hariharan.
#
# Build:  docker build -t restaurant-pos .
# Run:    docker run -p 8080:8080 -v pos-data:/data \
#           -e DATABASE_URL=mysql://pos:secret@db-host:3306/pos restaurant-pos

ARG RUST_VERSION=1.97
ARG NODE_VERSION=22

# ---- web app ---------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build:app

# ---- server ----------------------------------------------------------------
FROM rust:${RUST_VERSION}-slim-trixie AS server
WORKDIR /src/server
# Dependencies first, so code changes don't rebuild them
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
 && cargo build --release --locked \
 && rm -rf src target/release/deps/pos_server* target/release/pos-server*
COPY server/ ./
RUN touch src/main.rs && cargo build --release --locked

# ---- runtime ---------------------------------------------------------------
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends mariadb-client ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 pos \
 && useradd --system --uid 10001 --gid pos --home-dir /data --shell /usr/sbin/nologin pos \
 && mkdir -p /data /app \
 && chown pos:pos /data
COPY --from=server /src/server/target/release/pos-server /usr/local/bin/pos-server
COPY --from=web /src/web/dist /app/web

ENV PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/web \
    LOG_LEVEL=info
VOLUME ["/data"]
EXPOSE 8080
USER pos
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["pos-server", "healthcheck"]
ENTRYPOINT ["pos-server"]
