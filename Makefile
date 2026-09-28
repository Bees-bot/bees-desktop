.PHONY: bees dev server build

NODE := $(HOME)/.nvm/versions/node/v$(shell cat .nvmrc)/bin/node

bees:
	PATH="$(dir $(NODE)):$$PATH" BEES_ACCOUNT_API_URL=https://app.bees.bot $(NODE) node_modules/@tauri-apps/cli/tauri.js dev --config '{"build":{"beforeDevCommand":"$(NODE) scripts/prepare-desktop.mjs"}}'

dev:
	BEES_ACCOUNT_API_URL=http://localhost:3000 npm run tauri:dev

server:
	npm --prefix ../bees-server run dev

build:
	npm run tauri:build
