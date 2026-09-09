# Timothy Connect and Finance

This repository currently contains the production Connect, Giving, Finance, Serve, and Scheduler
application plus the separately deployable Finance staging alpha. Connect remains the system of
record for people and Giving. The Finance alpha is isolated, read-only, and synthetic-only.

Start with [AGENTS.md](AGENTS.md) for development and release boundaries. Current reference docs:

- [Architecture](docs/ARCHITECTURE.md)
- [Data ownership](docs/DATA-OWNERSHIP.md)
- [Operations](docs/OPERATIONS.md)
- [Security](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Finance alpha](apps/finance/README.md)

Use Node 22. Install and validate with:

```sh
npm ci
npm test
node .github/scripts/check-built-scripts.js
```

Production deployment is manual-only and requires an explicitly approved full `main` SHA and
release reason. An ordinary branch or pull request does not deploy production.
