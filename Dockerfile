# ProofGate command-line image. Node 22.12 is the minimum supported runtime, so the image is pinned to it.
# Build:  docker build -t proofgate:local .
# Run:    docker run --rm --network none proofgate:local --version
# ProofGate never needs the network at run time; run containers with --network none.
# The base image is pinned by digest (the multi-architecture index of node:22.12-bookworm-slim), so a moved tag cannot change the build.
# To update it deliberately: docker pull node:22.12-bookworm-slim, read the new digest, change both FROM lines and record it in CHANGELOG.md.

FROM node:22.12-bookworm-slim@sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY schemas ./schemas
COPY fixtures ./fixtures
COPY docs ./docs
COPY README.md LICENSE CHANGELOG.md SECURITY.md CONTRIBUTING.md ./
# The image installs the same `npm pack` tarball that a release ships, not the working tree.
RUN mkdir /out && npm run build && npm pack --pack-destination /out

FROM node:22.12-bookworm-slim@sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213
ENV NODE_ENV=production
COPY --from=build /out/proofgate-*.tgz /tmp/
# Installing globally puts the demo fixtures at /opt/proofgate/fixtures for the synthetic smoke.
RUN npm install --global --no-audit --no-fund /tmp/proofgate-*.tgz \
    && rm -f /tmp/proofgate-*.tgz \
    && ln -s "$(npm root --global)/proofgate" /opt/proofgate \
    && mkdir /work \
    && chown node:node /work
USER node
WORKDIR /work
ENTRYPOINT ["proofgate"]
CMD ["--help"]
