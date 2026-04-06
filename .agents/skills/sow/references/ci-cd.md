# CI/CD Integration

## Prerequisites

- Docker available in CI (most CI providers support this)
- sow CLI installed (`npm install -g @bugster/sow`)
- `DATABASE_URL` available as a CI secret or environment variable

## GitHub Actions

```yaml
name: Test with sow
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      docker:
        image: docker:dind
        options: --privileged

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Install sow
        run: npm install -g @bugster/sow

      - name: Create test database
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          sow connect $DATABASE_URL --quiet
          echo "BRANCH_URL=$(sow branch create ci-${{ github.sha }} --quiet)" >> $GITHUB_ENV

      - name: Run tests
        env:
          DATABASE_URL: ${{ env.BRANCH_URL }}
        run: npm test

      - name: Show diff
        if: always()
        run: sow branch diff ci-${{ github.sha }} --json || true

      - name: Cleanup
        if: always()
        run: sow branch delete ci-${{ github.sha }} || true
```

### Caching the Connector Snapshot

To avoid re-analyzing production on every CI run, cache the `~/.sow` directory:

```yaml
      - name: Cache sow snapshots
        uses: actions/cache@v4
        with:
          path: ~/.sow
          key: sow-${{ hashFiles('.sow.yml') }}
          restore-keys: sow-

      - name: Create connector (if not cached)
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          if ! sow connector list --quiet | grep -q "mydb"; then
            sow connect $DATABASE_URL --name mydb --quiet
          fi
```

## GitLab CI

```yaml
test:
  image: node:20
  services:
    - docker:dind
  variables:
    DOCKER_HOST: tcp://docker:2375
  before_script:
    - npm ci
    - npm install -g @bugster/sow
  script:
    - sow connect $DATABASE_URL --quiet
    - export BRANCH_URL=$(sow branch create ci-$CI_COMMIT_SHA --quiet)
    - DATABASE_URL=$BRANCH_URL npm test
  after_script:
    - sow branch delete ci-$CI_COMMIT_SHA || true
```

## Generic CI Script

```bash
#!/bin/bash
set -e

BRANCH_NAME="ci-$(date +%s)-$$"

cleanup() {
  sow branch delete "$BRANCH_NAME" 2>/dev/null || true
}
trap cleanup EXIT

# Create connector if needed
if ! sow connector list --quiet 2>/dev/null | grep -q .; then
  sow connect "$DATABASE_URL" --quiet
fi

# Create branch and run tests
BRANCH_URL=$(sow branch create "$BRANCH_NAME" --quiet)
DATABASE_URL=$BRANCH_URL "$@"

# Show what changed
sow branch diff "$BRANCH_NAME" --json
```

Usage: `./ci-test.sh npm test`

## Docker-in-Docker Considerations

sow requires Docker to run branch containers. In CI environments that use Docker-in-Docker (DinD):

1. **Privileged mode**: The CI runner needs `--privileged` or appropriate capabilities
2. **Docker socket**: Either mount the host Docker socket or run a DinD service
3. **Network**: The branch container must be reachable from the test runner. In DinD, use the Docker service hostname instead of `localhost`
4. **Ports**: Ensure ports 54320-54399 are not blocked by CI network policies

### GitHub Actions with Docker socket

```yaml
    container:
      image: node:20
      options: --privileged
      volumes:
        - /var/run/docker.sock:/var/run/docker.sock
```

### Kubernetes-based CI

If your CI runs in Kubernetes pods, you'll need either:
- A sidecar Docker daemon container
- Docker socket mounting from the host node
- A remote Docker host via `DOCKER_HOST` environment variable

## Caching Strategies

### Cache the snapshot
The `~/.sow/snapshots/` directory contains the init.sql files. Cache this to skip the analyze + sample + sanitize steps on subsequent runs.

### Cache the Docker image
If your CI caches Docker images, `postgres:16-alpine` (~80MB) will be pulled from cache instead of Docker Hub.

### Pre-built snapshot in the repo
For maximum speed, commit the snapshot to your repo:
```bash
# One-time: generate and commit
sow connect $DATABASE_URL --quiet
cp ~/.sow/snapshots/mydb/init.sql ./test/fixtures/sow-snapshot.sql
git add test/fixtures/sow-snapshot.sql
```

Then in CI, copy it to the expected location:
```bash
mkdir -p ~/.sow/snapshots/mydb
cp ./test/fixtures/sow-snapshot.sql ~/.sow/snapshots/mydb/init.sql
```

This eliminates the need for production database access in CI entirely.
