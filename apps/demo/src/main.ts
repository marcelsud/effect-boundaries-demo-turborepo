import assert from "node:assert/strict";
import { Effect, Layer, Schema } from "effect";
import {
  Catalog,
  CatalogLive,
  GetProductRequest,
  Product,
  ProductUnavailable,
} from "@shop/catalog";
import { Logistics, LogisticsLive, Quantity } from "@shop/logistics";
import { Pricing, PricingLive, Price, PriceUnavailable } from "@shop/pricing";

const Dependencies = Layer.mergeAll(LogisticsLive, PricingLive);
const CommerceLive = CatalogLive.pipe(Layer.provide(Dependencies));

await Effect.runPromise(
  Effect.gen(function* () {
    const catalog = yield* Catalog;
    // Simulate untrusted application input. This is JSON, not a transport or RPC.
    const request = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(GetProductRequest),
    )('{"productId":"p-1"}');
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
      Schema.fromJsonString(ProductUnavailable),
    )(missing);
    const restored = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(ProductUnavailable),
    )(errorJson);
    assert.ok(restored instanceof ProductUnavailable);
    assert.equal(restored.productId, "missing");
    const invalid = yield* catalog
      .getProduct({ productId: "" })
      .pipe(Effect.flip);
    assert.ok(Schema.isSchemaError(invalid));
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
    assert.ok(
      Schema.isSchemaError(
        yield* logistics.getAvailability({ productId: "" }).pipe(Effect.flip),
      ),
    );
    assert.ok(
      Schema.isSchemaError(
        yield* pricing.getPrice({ productId: "" }).pipe(Effect.flip),
      ),
    );
    const missing = yield* pricing
      .getPrice({ productId: "missing" })
      .pipe(Effect.flip);
    assert.ok(missing instanceof PriceUnavailable);
    const errorJson = yield* Schema.encodeEffect(
      Schema.fromJsonString(PriceUnavailable),
    )(missing);
    assert.ok(
      (yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(PriceUnavailable),
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

// Exercise dependency failures as well as values that satisfy TypeScript's
// primitive types but violate the public schema's runtime refinements.
const scenarios = [
  {
    pricing: Layer.succeed(Pricing, {
      getPrice: () =>
        Effect.fail(
          new PriceUnavailable({
            productId: "p-1",
            message: "Price not found",
          }),
        ),
    }),
    error: ProductUnavailable,
  },
  {
    pricing: Layer.succeed(Pricing, {
      getPrice: () =>
        Schema.decodeUnknownEffect(Price)({ amountCents: -1, currency: "BRL" }),
    }),
    error: Schema.SchemaError,
  },
  {
    pricing: Layer.succeed(Pricing, {
      getPrice: () =>
        Effect.succeed({ amountCents: -1, currency: "BRL" as const }),
    }),
    error: Schema.SchemaError,
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
    }).pipe(Effect.provide(live)),
  );
}
console.log(
  "PASS Catalog maps domain failures, preserves validation failures and validates final responses",
);
