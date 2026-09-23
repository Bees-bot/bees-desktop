.PHONY: bees dev server build

bees:
	BEES_ACCOUNT_API_URL=https://app.bees.bot npm run tauri:dev

dev:
	BEES_ACCOUNT_API_URL=http://localhost:3000 npm run tauri:dev

server:
	npm --prefix ../bees-server run dev

build:
	npm run tauri:build
