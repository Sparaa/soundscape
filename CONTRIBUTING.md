# Contributing

- Issues and PRs welcome. Keep the sidecar HTTP contracts stable (other apps share them); change them in their repos.
- Run `make test` before a PR. API tests never touch a GPU (fake sidecars); web tests are pure helpers + `tsc`.
- Style: small pure functions with tests for anything that decides something (planning, gating, profiling, visuals).
- No weights, no audio, no `.env` in the repo (`.gitignore` covers `library/`).
