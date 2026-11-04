# Effect boundaries demo — Turborepo

Three teams own Catalog, Logistics, and Pricing in one monorepo. Catalog calls
Logistics and Pricing directly through Effect services in the same process.
Each team has one package, one public entry point, and private repositories.

This variant uses Turborepo's native tasks and boundary features. There is no
custom import scanner, metadata validator, lint adapter, or test runner.
The original implementation is at
[effect-boundaries-demo](https://github.com/marcelsud/effect-boundaries-demo).

## Run the example

Requires Node.js 24+, Bun 1.4.4, and Git for the commit demonstration.

```sh
git clone https://github.com/marcelsud/effect-boundaries-demo-turborepo.git
cd effect-boundaries-demo-turborepo
bun install --frozen-lockfile
bun run check
bun run setup:hooks
```

`check` runs native boundary enforcement, builds all four projects, and runs
the application assertions. `build` checks boundaries before compiling, and
`demo` builds its dependencies before running the application.

```text
packages/catalog       @shop/catalog       Catalog, CatalogLive
packages/logistics     @shop/logistics     Logistics, LogisticsLive
packages/pricing       @shop/pricing       Pricing, PricingLive
apps/demo              @shop/demo          Application and runtime assertions
```

Each team may consume another team's declared public API by adding that package
as a dependency. There is no central team-dependency allowlist or architecture
package. Private implementation files remain behind each package boundary.

The application prints:

```json
{
  "id": "p-1",
  "name": "Keyboard",
  "availableQuantity": 12,
  "price": { "amountCents": 19900, "currency": "BRL" }
}
```

It also checks missing product/price failures and zero inventory for an unknown
product. These assertions live in the application, not a custom test runner.

## Public interfaces and Effect Layers

Each service package exports only `.` in `package.json`. Its `src/index.ts`
exports the service, public DTO/error types, and its implementation Layer.
TypeScript resolves the public source barrel; Node resolves `dist/index.js`.
There are no separate API packages or RPC definitions.

```ts
import { Effect, Layer } from "effect"
import { Catalog, CatalogLive } from "@shop/catalog"
import { LogisticsLive } from "@shop/logistics"
import { PricingLive } from "@shop/pricing"

const CommerceLive = CatalogLive.pipe(
  Layer.provide(Layer.mergeAll(LogisticsLive, PricingLive))
)

const product = await Effect.runPromise(
  Effect.gen(function* () {
    const catalog = yield* Catalog
    return yield* catalog.getProduct("p-1")
  }).pipe(Effect.provide(CommerceLive))
)
```

Each team controls its service interface, exported DTOs/errors, and public Layer.
The application composes these Layers. TypeScript checks that the actual
application wiring supplies every required Effect service. A missing provider
fails the application build; there is no separate whitelist of permitted Layer
input types.

## Team-owned API changes

- Consuming an existing public API requires a dependency declaration in the
  caller's package and its TypeScript project reference. No central approval or
  tool-configuration edit is needed.
- Changing Pricing's API means changing files inside `packages/pricing`. Another
  team may open that PR; Pricing's owners review it.
- Copy `.github/CODEOWNERS.example` to `.github/CODEOWNERS`, replace the sample
  owner handles, and require [code-owner approval in GitHub's branch rules](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
  Each owner controls its entire package, including exports and build metadata.
- Build all consumers in CI. TypeScript catches incompatible API changes and
  incomplete Layer composition before merge.

The shared native lint rule protects package encapsulation. It does not decide
which team is authorized to consume another team's public service.

## Native Turborepo configuration

- `turbo.json` defines `build` tasks with `^build` dependency ordering and caches
  `dist` together with TypeScript incremental metadata.
- `turbo boundaries` uses its built-in package encapsulation and dependency
  checks. There are no team tags or `boundaries.tags` authorization rules.
- Every build depends on the uncached root `boundaries` task, which invokes
  `turbo boundaries`. Cached build outputs do not skip boundary enforcement.
- Package-manager dependencies form the task graph. Shared compiler settings
  participate in task hashes through `globalDependencies`.

Useful native commands:

```sh
bun run boundaries
bunx turbo run build --filter=@shop/catalog
bunx turbo run build --affected
bunx turbo run build --graph=graph.html
bunx turbo run build --dry=json
```

`turbo boundaries` rejects imports that leave a package directory and undeclared
package imports. Package exports and TypeScript enforce the declared public API.
There is no ESLint/Oxlint boundary plugin in this variant.

This example pins Turborepo 2.11.10 and TypeScript 6.0.3. Turborepo documents
`boundaries` as experimental.

## Simulate a rejected commit using Git

Start with a clean working tree, run `bun run check`, then install the hook
with `bun run setup:hooks`. Apply the included patch:

```sh
git apply examples/private-import.patch
bunx tsc -p packages/catalog --noEmit --tsBuildInfoFile packages/catalog/type-probe.tsbuildinfo
git add packages/catalog/src/internal/Module.ts
git commit -m "Read Pricing internals from Catalog"
```

The patch changes Catalog to import and internally provide
`../../../pricing/dist/internal/PriceRepository.js`. TypeScript alone accepts
the Layer because its private provider is already satisfied. The native boundary
check rejects the import, so the hook rejects the commit. HEAD stays unchanged.
See [the captured commit output](examples/rejected-commit.txt).

Restore only the demonstration change:

```sh
git restore --staged --worktree -- packages/catalog/src/internal/Module.ts
```

A second patch, `examples/public-dependency.patch`, makes Logistics consume
Pricing's public service and Layer, adding both the package dependency and
TypeScript project reference. `bun install` updates the generated lockfile. This is allowed: the native check and runtime
demo pass without changing any shared tool configuration.

```sh
git apply examples/public-dependency.patch
bun install
bun run check
git restore --worktree -- bun.lock packages/logistics/package.json packages/logistics/tsconfig.json packages/logistics/src/internal/Module.ts
```

Apply the patches separately. The restore commands discard the listed files'
demonstration changes, so use them only after starting from a clean checkout.

## Enforcement limits

These are native static architecture checks, not a sandbox against arbitrary
JavaScript. This variant does not retain the original custom regression runner
or claim identical coverage for computed module loaders, arbitrary tsconfig
alias remapping, or source excluded from native discovery. Changing public
exports changes the package's public interface.

The pre-commit hook runs `bun run check`; Git hooks can be skipped. Require the
same command in CI. API ownership comes from the package's code owners and
GitHub review rules, rather than an additional architecture project.
