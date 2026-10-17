# Hosted Bees Clients

The hosted runtime is the same Client as desktop. See [README](../README.md#hosted-clients), `dsh-runtime/client-cloud.mjs`, and `dsh-runtime/hosted-clients.mjs`. The old Server-owned fleet runner and shared Drive flow have been removed. Each hosted account has a separate persistent container. `npm run check:headless` tests the real runtime with a synthetic model; gateway account routing is checked by `npm run check`.
