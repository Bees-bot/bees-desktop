FROM node:24.7.0-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/bees
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY dsh-runtime/package.json dsh-runtime/package-lock.json ./dsh-runtime/
COPY dsh-runtime/plugin ./dsh-runtime/plugin
COPY dsh-runtime/plugins ./dsh-runtime/plugins
RUN npm ci --omit=dev --prefix dsh-runtime --ignore-scripts --legacy-peer-deps && npm rebuild --prefix dsh-runtime node-pty
COPY scripts ./scripts
COPY src/brand-mark.png ./src/brand-mark.png
COPY dsh-runtime/start.mjs dsh-runtime/headless.mjs ./dsh-runtime/
COPY dsh-runtime/client-cloud.mjs ./dsh-runtime/
COPY dsh-runtime/hosted-clients.mjs dsh-runtime/hosted-kubernetes.mjs dsh-runtime/hosted-api.mjs ./dsh-runtime/
COPY dsh-runtime/profile ./dsh-runtime/profile
ARG BEES_BUILD_REVISION=unversioned
ARG BEES_BUILD_DIRTY=false
RUN node scripts/install-dsh-runtime.mjs && node scripts/stage-dsh-plugin.mjs && node scripts/prepare-dsh-runtime.mjs --headless && BEES_BUILD_REVISION="$BEES_BUILD_REVISION" BEES_BUILD_DIRTY="$BEES_BUILD_DIRTY" node scripts/build-hosted-ui.mjs

FROM node:24.7.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates bash procps && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/bees
COPY --from=build /opt/bees/dsh-runtime ./dsh-runtime
COPY --from=build /opt/bees/dist/hosted ./dist/hosted
COPY --from=build /opt/bees/scripts/check-headless.mjs ./scripts/check-headless.mjs
COPY --from=build /opt/bees/scripts/fixtures ./scripts/fixtures
COPY deploy/headless/config.json /etc/bees/config.json
RUN mkdir -m 700 /var/lib/bees && chown node:node /var/lib/bees
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["node", "dsh-runtime/headless.mjs", "/etc/bees/config.json"]
