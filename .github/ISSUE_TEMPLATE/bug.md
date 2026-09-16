---
name: Bug
about: Something broke
---
**What happened**

**What you expected**

**Setup**: GPU / driver, `docker compose version`, LLM endpoint + model, sidecar image tags, `curl localhost:3021/healthz` output

**Logs**: `docker logs soundscape-api --tail 100` (and the sidecar's, if it is a render/analysis problem)
