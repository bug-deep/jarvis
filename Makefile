# Проверки и запуск: make check
SECRETS_SCANNER ?= ./bin/scan-secrets.py

.PHONY: install run app cloud desktop pack portable rebrand installer lint format test audit secrets check hooks

install:
	npm ci

run: app

app:
	npm run app

cloud:
	npm run cloud

desktop:
	npm run desktop

pack:
	npm run pack

portable:
	bin/build-portable.sh

rebrand:
	node bin/rebrand-exe.js dist/Jarvis/Jarvis.exe dist/Jarvis/Jarvis.exe build/icon.ico

installer:
	makensis build/installer.nsi

lint:
	npm run lint

format:
	npm run format

test:
	npm test

audit:
	npm audit --audit-level=high || true

secrets:
	@test -x $(SECRETS_SCANNER) && python3 $(SECRETS_SCANNER) . || echo "сканер секретов не найден"

hooks:
	npx --yes pre-commit install

check: lint test secrets
