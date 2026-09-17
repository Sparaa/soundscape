.PHONY: up down test test-api test-web logs deploy-web deploy-api
up: ; docker compose --profile gpu up -d --build
down: ; docker compose --profile gpu down
test: test-api test-web
test-api: ; docker run --rm -v $(PWD)/api:/app -w /app python:3.12-slim sh -c "apt-get install -y -qq ffmpeg >/dev/null 2>&1; pip install -q -r requirements.txt >/dev/null && python -m pytest -q tests -p no:cacheprovider"
test-web: ; docker run --rm -v $(PWD)/web:/app -w /app node:22-alpine sh -c "[ -d node_modules ] || npm install --silent --no-audit --no-fund; node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit -p . && echo 'tsc: clean'"
logs: ; docker compose logs -f --tail 100 api
# Rebuild ONE service without touching the other: a plain `up --build web` also rebuilds and RECREATES api (its
# dependency), which drops the radio's in-memory play state under a listening user.
deploy-web: ; docker compose up -d --build --no-deps web
deploy-api: ; docker compose up -d --build --no-deps api
