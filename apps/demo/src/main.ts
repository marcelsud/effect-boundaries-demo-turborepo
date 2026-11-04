import assert from "node:assert/strict";
import { runCapabilityExamples } from "./capabilities.demo.js";
import { Effect, Layer, Schema } from "effect";
import {
  Catalog,
  CatalogError,
  CatalogLive,
  GetProductRequest,
  Product,
  ProductUnavailable,
} from "@shop/catalog";
import {
  Logistics,
  LogisticsError,
  LogisticsLive,
  Quantity,
} from "@shop/logistics";
import {
  Pricing,
  PricingError,
  PricingLive,
  Price,
  PriceUnavailable,
} from "@shop/pricing";

const Dependencies = Layer.mergeAll(LogisticsLive, PricingLive);
const CommerceLive = CatalogLive.pipe(Layer.provide(Dependencies));

await Effect.runPromise(
  Effect.gen(function* () {
    const catalog = yield* Catalog;
    // Simulate untrusted application input. This is JSON, not a transport or RPC.
    const request = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(GetProductRequest),
    )('{"productId":"p-1"}').pipe(
      Effect.mapError(
        (cause) =>
          new CatalogError({
            operation: "Catalog.getProduct",
            stage: "request",
            message: "Catalog.getProduct failed to decode request JSON",
            cause,
          }),
      ),
    );
    const product = yield* catalog.getProduct(request);
    const encoded = yield* Schema.encodeEffect(Product)(product);
    assert.deepEqual(encoded, {
      id: "p-1",
      name: "Keyboard",
      availableQuantity: 12,
      price: { amountCents: 19900, currency: "BRL" },
    });
    const json = yield* Schema.encodeEffect(Schema.fromJsonString(Product))(
      product,
    );
    assert.deepEqual(
      yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Product))(json),
      product,
    );
    console.log(JSON.stringify(encoded, null, 2));

    const missing = yield* catalog
      .getProduct({ productId: "missing" })
      .pipe(Effect.flip);
    assert.ok(missing instanceof ProductUnavailable);
    const errorJson = yield* Schema.encodeEffect(
      Schema.fromJsonString(Schema.toCodecJson(ProductUnavailable)),
    )(missing);
    const restored = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.toCodecJson(ProductUnavailable)),
    )(errorJson);
    assert.ok(restored instanceof ProductUnavailable);
    assert.equal(restored.productId, "missing");
    const invalid = yield* catalog
      .getProduct({ productId: "" })
      .pipe(Effect.flip);
    assert.ok(invalid instanceof CatalogError);
    assert.equal(invalid.operation, "Catalog.getProduct");
    assert.equal(invalid.stage, "request");
    assert.ok(Schema.isSchemaError(invalid.cause));
    assert.equal(typeof invalid.cause.stack, "string");
    const codec = Schema.fromJsonString(Schema.toCodecJson(CatalogError));
    const encodedError = yield* Schema.encodeEffect(codec)(invalid);
    const decodedError = yield* Schema.decodeUnknownEffect(codec)(encodedError);
    assert.ok(decodedError instanceof CatalogError);
    assert.equal(decodedError.stage, "request");
    assert.equal(decodedError.cause.message, invalid.cause.message);
    assert.equal(decodedError.cause.stack, invalid.cause.stack);
    console.log(
      "PASS Catalog decodes inputs/storage, composes schemas, and round-trips products/errors",
    );
  }).pipe(Effect.provide(CommerceLive)),
);

await Effect.runPromise(
  Effect.gen(function* () {
    const logistics = yield* Logistics;
    const pricing = yield* Pricing;
    assert.equal(yield* logistics.getAvailability({ productId: "p-1" }), 12);
    assert.equal(yield* logistics.getAvailability({ productId: "missing" }), 0);
    assert.deepEqual(yield* pricing.getPrice({ productId: "p-1" }), {
      amountCents: 19900,
      currency: "BRL",
    });
    const invalidInventory = yield* logistics
      .getAvailability({ productId: "" })
      .pipe(Effect.flip);
    assert.ok(invalidInventory instanceof LogisticsError);
    assert.equal(invalidInventory.operation, "Logistics.getAvailability");
    assert.equal(invalidInventory.stage, "request");
    assert.ok(Schema.isSchemaError(invalidInventory.cause));
    const invalidPrice = yield* pricing
      .getPrice({ productId: "" })
      .pipe(Effect.flip);
    assert.ok(invalidPrice instanceof PricingError);
    assert.equal(invalidPrice.operation, "Pricing.getPrice");
    assert.equal(invalidPrice.stage, "request");
    assert.ok(Schema.isSchemaError(invalidPrice.cause));
    const missing = yield* pricing
      .getPrice({ productId: "missing" })
      .pipe(Effect.flip);
    assert.ok(missing instanceof PriceUnavailable);
    const errorJson = yield* Schema.encodeEffect(
      Schema.fromJsonString(Schema.toCodecJson(PriceUnavailable)),
    )(missing);
    assert.ok(
      (yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.toCodecJson(PriceUnavailable)),
      )(errorJson)) instanceof PriceUnavailable,
    );

    for (const raw of [{ productId: 123 }, {}, { productId: "" }]) {
      assert.ok(
        Schema.isSchemaError(
          yield* Schema.decodeUnknownEffect(GetProductRequest)(raw).pipe(
            Effect.flip,
          ),
        ),
      );
    }
    for (const raw of [
      { amountCents: -1, currency: "BRL" },
      { amountCents: 1.5, currency: "BRL" },
      { amountCents: 100, currency: "USD" },
    ]) {
      assert.ok(
        Schema.isSchemaError(
          yield* Schema.decodeUnknownEffect(Price)(raw).pipe(Effect.flip),
        ),
      );
    }
    for (const raw of [-1, 0.5, Infinity]) {
      assert.ok(
        Schema.isSchemaError(
          yield* Schema.decodeUnknownEffect(Quantity)(raw).pipe(Effect.flip),
        ),
      );
    }
    console.log(
      "PASS public schemas reject malformed requests, invalid money/currency and invalid quantities",
    );
  }).pipe(Effect.provide(Dependencies)),
);

// Keep an actual SchemaError object to verify that each application layer
// retains the exact original cause instead of replacing it with a message.
const schemaFailure = await Effect.runPromise(
  Schema.decodeUnknownEffect(Price)({ amountCents: -1, currency: "BRL" }).pipe(
    Effect.flip,
  ),
);
assert.ok(Schema.isSchemaError(schemaFailure));
assert.match(schemaFailure.message, /amountCents/);
const pricingFailure = new PricingError({
  operation: "Pricing.getPrice",
  stage: "storage",
  message: "Pricing.getPrice failed at storage",
  cause: schemaFailure,
});
const missingPrice = new PriceUnavailable({
  productId: "p-1",
  message: "Price not found",
});
const scenarios = [
  {
    pricing: Layer.succeed(Pricing, {
      getPrice: () => Effect.fail(missingPrice),
    }),
    error: ProductUnavailable,
    cause: missingPrice,
  },
  {
    pricing: Layer.succeed(Pricing, {
      getPrice: () => Effect.fail(pricingFailure),
    }),
    error: CatalogError,
    cause: pricingFailure,
  },
  {
    pricing: Layer.succeed(Pricing, {
      getPrice: () =>
        Effect.succeed({ amountCents: -1, currency: "BRL" as const }),
    }),
    error: CatalogError,
    cause: undefined,
  },
];
for (const scenario of scenarios) {
  const live = CatalogLive.pipe(
    Layer.provide(Layer.mergeAll(LogisticsLive, scenario.pricing)),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const catalog = yield* Catalog;
      const result = yield* catalog
        .getProduct({ productId: "p-1" })
        .pipe(Effect.flip);
      assert.ok(result instanceof scenario.error);
      if (scenario.cause) assert.strictEqual(result.cause, scenario.cause);
      if (result instanceof CatalogError) {
        assert.equal(result.operation, "Catalog.getProduct");
        assert.equal(result.stage, scenario.cause ? "dependency" : "response");
        if (result.cause instanceof PricingError) {
          assert.strictEqual(result.cause.cause, schemaFailure);
          const codec = Schema.fromJsonString(Schema.toCodecJson(CatalogError));
          const json = yield* Schema.encodeEffect(codec)(result);
          const decoded = yield* Schema.decodeUnknownEffect(codec)(json);
          assert.equal(decoded.operation, "Catalog.getProduct");
          assert.equal(decoded.stage, "dependency");
          assert.equal(decoded.cause.name, "PricingError");
          assert.equal(decoded.cause.message, pricingFailure.message);
          assert.equal(decoded.cause.stack, pricingFailure.stack);
          assert.ok(decoded.cause.cause instanceof Error);
          assert.equal(decoded.cause.cause.message, schemaFailure.message);
          assert.equal(decoded.cause.cause.stack, schemaFailure.stack);
          console.log(
            "Trace: Catalog.getProduct [dependency] -> Pricing.getPrice [storage] -> SchemaError",
          );
        } else {
          assert.ok(Schema.isSchemaError(result.cause));
        }
      }
    }).pipe(Effect.provide(live)),
  );
}
console.log(
  "PASS service-owned application errors preserve operations, stages, stacks and original cause chains",
);

// At the JavaScript boundary, runPromise rejects with the application error.
await assert.rejects(
  Effect.runPromise(
    Effect.gen(function* () {
      const catalog = yield* Catalog;
      return yield* catalog.getProduct({ productId: "" });
    }).pipe(Effect.provide(CommerceLive)),
  ),
  (error: unknown) => {
    assert.ok(error instanceof CatalogError);
    assert.equal(error.stage, "request");
    assert.ok(Schema.isSchemaError(error.cause));
    return true;
  },
);

await runCapabilityExamples();
