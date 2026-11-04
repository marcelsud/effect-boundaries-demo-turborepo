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
import { Effect, Layer } from "effect";
import { Catalog, CatalogLive } from "@shop/catalog";
import { LogisticsLive } from "@shop/logistics";
import { PricingLive } from "@shop/pricing";

const CommerceLive = CatalogLive.pipe(
  Layer.provide(Layer.mergeAll(LogisticsLive, PricingLive)),
);

const product = await Effect.runPromise(
  Effect.gen(function* () {
    const catalog = yield* Catalog;
    return yield* catalog.getProduct({ productId: "p-1" });
  }).pipe(Effect.provide(CommerceLive)),
);
```

Each team controls its service interface, exported DTOs/errors, and public Layer.
The application composes these Layers. TypeScript checks that the actual
application wiring supplies every required Effect service. A missing provider
fails the application build; there is no separate whitelist of permitted Layer
input types.

## Folder and file naming

Each team package has one public entry point and groups its implementation:

```text
packages/
  catalog/src/
    index.ts
    internal/
      catalog.service.ts
      product.aggregate.ts
      product.projection.ts
      product.repository.ts
    public/
      products.view.ts
      products.stream.ts
      rename-product.command.ts
      product-listing.product.ts
  logistics/src/
    index.ts
    internal/
      logistics.service.ts
      inventory.repository.ts
      stockout.policy.ts
    public/
      inventory.view.ts
      inventory.stream.ts
      set-inventory.command.ts
      request-delivery.command.ts
    external/
      carrier.external.ts
      demo-carrier.client.ts
  pricing/src/
    index.ts
    internal/
      pricing.service.ts
      price.repository.ts
    public/
      price.view.ts
apps/demo/src/
  main.ts
  capabilities.demo.ts
  product-listing.projection.ts
```

Files use Nest-style `kebab-case.role.ts`; exported services and Layers keep
PascalCase names such as `Catalog` and `CatalogLive`. This borrows naming from
[Nest](https://docs.nestjs.com/first-steps) and capability vocabulary from
[Alchemy Domain](https://alchemy.run/domain/project-layout/), using plain Effect.

- `internal/` contains service implementations, repositories, aggregates,
  projections, and policies. Services keep their Live layers alongside them.
- `public/` contains published capabilities: products, views, streams, and
  commands. Only explicit exports from `src/index.ts` are public; placing a file
  here does not export it. The entry point also selects schemas, errors, and
  Layers from implementation files when they are part of the public contract.
- `external/` contains the private domain-facing carrier port, its schemas, and
  its vendor adapter Layer. Consumers use `RequestDelivery`, which hides both
  the SDK and the carrier service tag.

Package boundaries cover every folder. Consumers import `@shop/catalog`,
`@shop/logistics`, or `@shop/pricing`, never another package's source or compiled
implementation path. Native configs discover nested TypeScript files, so new
capabilities require no central authorization or extra boundary rule.

## Run the capability examples

`bun run check` also runs
[the capability demo](apps/demo/src/capabilities.demo.ts). It uses one coherent
flow across all three team packages:

| Capability                                           | Owner and implementation                 | Behavior                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `RenameProduct`                                      | Catalog, `rename-product.command.ts`     | Validates a request and asks the private aggregate to decide a rename. Missing products and blank names are domain rejections. |
| `ProductsView` / `ProductsStream`                    | Catalog                                  | Exposes a product query view and rename events with consumer-owned cursors.                                                    |
| `SetInventory` / `InventoryView` / `InventoryStream` | Logistics                                | Updates stock and exposes a stock query view and inventory events.                                                             |
| `PriceView`                                          | Pricing                                  | Exposes the existing schema-validated price query as a read-only view.                                                         |
| `ProductListing`                                     | Catalog, `product-listing.product.ts`    | Combines the product, inventory, and price views into a listing query and publishes both change feeds.                         |
| `StockoutPolicy`                                     | Logistics, `stockout.policy.ts`          | Reacts to zero inventory by requesting a replenishment delivery of 12 units.                                                   |
| `RequestDelivery`                                    | Logistics, `request-delivery.command.ts` | Validates input, calls a private carrier facade, and returns a domain-shaped delivery.                                         |

`product.aggregate.ts` makes a pure decision that emits `ProductRenamed`.
`product.projection.ts` applies events to the private product read model.
The repository updates the read model, event history, and cursor in one Effect
`Ref.modify`. Inventory uses the same atomic state-and-history pattern.
The existing Catalog and Logistics services read those same stores; the demo
verifies that a rename is visible through `Catalog.getProduct` too.

### Query views and consumer projections

A view answers a read question with state derived from events. This follows
[Alchemy's view vocabulary](https://alchemy.run/domain/view/), implemented here
with plain Effect:

- `ProductsView.list` answers which products exist and their current names.
- `InventoryView.list` answers how much stock each product has.
- `PriceView.get` answers the current price of one product. This is a thin adapter
  around the existing Pricing query, not an independently materialized read model.
- `ProductListing.list` joins those public capabilities into the data a product
  listing needs. It returns products, quantities, and prices, without offsets.

The demo updates its materialized state inline with each write. It does not
implement Alchemy's asynchronous view delivery, keyed runtime, or consistency
receipts. Adding a read-only screen does not require a change to command rules.

Stream offsets are a separate concern. Cursor `0` means before the first event;
`events(after)` emits events with a strictly greater cursor. Each read captures a
finite batch of retained history. Poll again with your saved cursor for subsequent
changes. Future or invalid cursors produce schema-backed application errors.

`ProductListing.changes({ products, inventory })` concatenates the two event
batches. It preserves order within each source without promising a global event
order. Pricing is read-only in this demo, so its price is available through the
query view without a price-change feed.

[The consuming app's projection](apps/demo/src/product-listing.projection.ts)
starts empty and folds changes into the latest observed name and quantity for
each product, plus its own cursor vector. It ignores redelivered events and
rejects sequence gaps. It records observed changes; seeded products that have
never changed are available through query views rather than the change history.
Query results are not used to initialize the consumer's offsets.

The example queries views, issues commands, folds both feeds, continues from its
own offsets, and rebuilds the same projection by replaying history from cursor
zero. It also verifies independent consumers, duplicate delivery, sequence gaps,
invalid events/cursors, rejected commands, and concurrent inventory writes.

Histories, projections, and carrier idempotency records are in memory and reset
when their Layer is rebuilt. A production worker needs durable producer history
and transactional consumer state/offset storage; add an expired-cursor contract
before pruning events.

### Policies and private external adapters

The app runs `StockoutPolicy` over inventory events separately from its
projection. The policy performs an external action; replaying the pure listing
projection does not book deliveries.

`carrier.external.ts` defines a private domain-facing Effect service.
`demo-carrier.client.ts` maps domain requests to a Promise-based vendor SDK shape,
validates its unknown response, and maps it back to a `Delivery`. The SDK is a
deterministic local simulation, so the demo needs no network or credentials.
The adapter also simulates an unavailable vendor and a malformed vendor response.

Each stockout uses `inventory:<cursor>` as its delivery idempotency key.
Replaying that event returns the same delivery; reusing a key with a different
payload fails. This exercises replay-safe policy reactions without claiming
exactly-once execution. Production retries require durable keys and idempotency
support from the actual provider.

Schema and SDK failures preserve this diagnostic chain, including stacks:

```text
StockoutPolicyError [dependency]
  cause: DeliveryError [external]
    cause: CarrierError [transport or response]
      cause: original SDK Error or SchemaError
```

Successful execution ends with these additional assertions:

```text
PASS public product composes team views/streams; consumer projections replay with independent cursors, redelivery and gap checks
PASS stockout policy requests an idempotent delivery through a private carrier adapter; schema and SDK failures retain their cause chain
```

## Schemas and Live layers

Each service's schemas, Context service, and Live layer are in the same file:

```text
packages/catalog/src/internal/catalog.service.ts       GetProductRequest, Product, ProductUnavailable, Catalog, CatalogLive
packages/logistics/src/internal/logistics.service.ts   GetAvailabilityRequest, Quantity, Logistics, LogisticsLive
packages/pricing/src/internal/pricing.service.ts       GetPriceRequest, Price, PriceUnavailable, Pricing, PricingLive
```

Repositories stay private in `src/internal`. There are no `Module.ts` files.
They return raw `unknown` storage values; each Live layer decodes those values
before using them as domain data.

- Requests use `Schema.Struct` and non-empty product IDs.
- Price amounts and inventory quantities use `Schema.Natural`; the demo's
  supported currency is `BRL`.
- Catalog's Product schema composes Pricing's public Price schema and Logistics'
  public Quantity schema.
- DTO types are derived from schemas. Domain and application errors use
  `Schema.TaggedError` (Effect 4.1.2). Each service maps schema validation failures
  to its own public error: `CatalogError`, `LogisticsError`, or `PricingError`.
- The application decodes a JSON request and encodes/decodes products and domain
  errors using the same public schemas. No transport or RPC is introduced.

The runtime assertions cover invalid requests, invalid amounts/currency and
quantities, missing products/prices, JSON round trips, and a provider returning
an invalid numeric refinement. Catalog wraps dependency failures with the
original cause and maps Pricing not-found failures into its own public error
schema, retaining their cause too. The final Catalog response is validated too.

Run `bun run format` to apply Prettier, or `bun run format:check` to verify it.
Generated outputs, Bun's lockfile, patch files, and captured terminal output are
excluded from formatting. Example patch contents use the same formatter as the
source files.

## Application errors and traceable causes

Public service signatures expose service-owned errors instead of generic
`Schema.SchemaError`. For example, Catalog returns
`Effect<Product, ProductUnavailable | CatalogError>`.

Each application error includes:

- `operation`: the public operation, such as `Catalog.getProduct`.
- `stage`: `request`, `storage`, `dependency`, or `response`.
- `message`: the operation and stage in a readable form.
- `cause`: the exact original Error object, including its validation details and
  stack trace. Dependency wrappers retain the nested application's error too.

Inside a service, schema decoding maps the typed failure:

```ts
const decodeRequest = (request: unknown) =>
  Schema.decodeUnknownEffect(GetProductRequest)(request).pipe(
    Effect.mapError(catalogFailure("request")),
  );
```

`catalogFailure` constructs a `CatalogError` with the stage and original cause.
This remains a typed Effect failure; it does not turn validation into a defect.
An unhandled `Effect.runPromise` rejects with the application error.

The methods use named `Effect.fn` operations for Effect's span and stack-frame
metadata. The demo verifies this nested failure path:

```text
CatalogError: Catalog.getProduct [dependency]
  cause: PricingError: Pricing.getPrice [storage]
    cause: SchemaError: invalid amountCents
```

For diagnostic JSON, use
`Schema.fromJsonString(Schema.toCodecJson(CatalogError))`. The cause schema is
`Schema.ErrorInstance({ includeStack: true })`, preserving error names,
messages, stacks, and nested causes. JSON-decoded nested causes are ordinary
Error objects; the original typed error objects and SchemaError issues remain
available in memory before encoding. The demo tests both forms.

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
git add packages/catalog/src/internal/catalog.service.ts
git commit -m "Read Pricing internals from Catalog"
```

The patch changes Catalog to import and internally provide
`../../../pricing/dist/internal/price.repository.js`. TypeScript alone accepts
the Layer because its private provider is already satisfied. The native boundary
check rejects the import, so the hook rejects the commit. HEAD stays unchanged.
See [the captured commit output](examples/rejected-commit.txt).
Additional [native boundary check output](examples/boundary-checks.txt) covers
direct imports into the real public view, private projection, and external
adapter files, TypeScript export checks, and the allowed public dependency
example. Temporary caller files are removed after verification; no custom
boundary runner is shipped.

Restore only the demonstration change:

```sh
git restore --staged --worktree -- packages/catalog/src/internal/catalog.service.ts
```

A second patch, `examples/public-dependency.patch`, makes Logistics consume
Pricing's public service and Layer, adding both the package dependency and
TypeScript project reference. `bun install` updates the generated lockfile.
This is allowed: the native check and runtime demo pass without changing any
shared tool configuration.

```sh
git apply examples/public-dependency.patch
bun install
bun run check
git restore --worktree -- bun.lock packages/logistics/package.json packages/logistics/tsconfig.json packages/logistics/src/internal/logistics.service.ts
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
