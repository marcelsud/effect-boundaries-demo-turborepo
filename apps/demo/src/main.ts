import assert from "node:assert/strict"
import { Effect, Layer } from "effect"
import { Catalog, CatalogLive, ProductUnavailable } from "@shop/catalog"
import { Logistics, LogisticsLive } from "@shop/logistics"
import { Pricing, PricingLive, PriceUnavailable } from "@shop/pricing"

// One process, with all construction through each package's public barrel.
const Dependencies = Layer.mergeAll(LogisticsLive, PricingLive)
const CommerceLive = CatalogLive.pipe(Layer.provide(Dependencies))

await Effect.runPromise(Effect.gen(function* () {
  const catalog = yield* Catalog
  const product = yield* catalog.getProduct("p-1")
  assert.deepEqual(product, {
    id: "p-1", name: "Keyboard", availableQuantity: 12,
    price: { amountCents: 19900, currency: "BRL" }
  })
  console.log(JSON.stringify(product, null, 2))
  const missing = yield* catalog.getProduct("missing").pipe(Effect.flip)
  assert.ok(missing instanceof ProductUnavailable)
  assert.equal(missing.productId, "missing")
  console.log("PASS Catalog calls Logistics and Pricing directly in one process")
}).pipe(Effect.provide(CommerceLive)))

await Effect.runPromise(Effect.gen(function* () {
  const logistics = yield* Logistics
  assert.equal(yield* logistics.getAvailability("p-1"), 12)
  assert.equal(yield* logistics.getAvailability("missing"), 0)
  const pricing = yield* Pricing
  assert.deepEqual(yield* pricing.getPrice("p-1"), { amountCents: 19900, currency: "BRL" })
  const missing = yield* pricing.getPrice("missing").pipe(Effect.flip)
  assert.ok(missing instanceof PriceUnavailable)
  assert.equal(missing.productId, "missing")
  console.log("PASS public Logistics/Pricing calls and typed missing-product failures")
}).pipe(Effect.provide(Dependencies)))
