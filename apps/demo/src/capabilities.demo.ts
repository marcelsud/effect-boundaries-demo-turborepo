import assert from "node:assert/strict";
import { Effect, Layer, Schema, Stream } from "effect";
import {
  Catalog,
  CatalogLive,
  ProductListing,
  ProductListingLive,
  ProductListingError,
  ProductsView,
  ProductsViewLive,
  ProductsStream,
  ProductsStreamLive,
  ProductsError,
  RenameProduct,
  RenameProductLive,
  ProductRenameRejected,
} from "@shop/catalog";
import {
  DeliveryError,
  InventoryError,
  InventoryStream,
  InventoryStreamLive,
  InventoryView,
  InventoryViewLive,
  LogisticsLive,
  RequestDelivery,
  RequestDeliveryLive,
  SetInventory,
  SetInventoryLive,
  StockoutPolicy,
  StockoutPolicyError,
  StockoutPolicyLive,
} from "@shop/logistics";
import { PriceViewLive, PricingLive } from "@shop/pricing";
import {
  applyListingChange,
  ListingProjectionError,
  ListingProjectionState,
} from "./product-listing.projection.js";

const ReadsLive = Layer.mergeAll(
  ProductsViewLive,
  ProductsStreamLive,
  InventoryViewLive,
  InventoryStreamLive,
  PriceViewLive,
);
const ExamplesLive = Layer.mergeAll(
  ReadsLive,
  ProductListingLive.pipe(Layer.provide(ReadsLive)),
  RenameProductLive,
  SetInventoryLive,
  RequestDeliveryLive,
  StockoutPolicyLive,
  CatalogLive.pipe(Layer.provide(Layer.mergeAll(LogisticsLive, PricingLive))),
);

export const runCapabilityExamples = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const listing = yield* ProductListing;
      const products = yield* ProductsView;
      const productEvents = yield* ProductsStream;
      const inventory = yield* InventoryView;
      const inventoryEvents = yield* InventoryStream;
      const rename = yield* RenameProduct;
      const setInventory = yield* SetInventory;
      const catalog = yield* Catalog;
      const deliveries = yield* RequestDelivery;
      const stockout = yield* StockoutPolicy;

      const initialListing = yield* listing.list;
      assert.equal(initialListing[0]?.name, "Keyboard");
      let projection: ListingProjectionState = {
        updates: [],
        cursors: { products: 0, inventory: 0 },
      };

      const renamed = yield* rename.execute({
        productId: "p-1",
        name: "Mechanical Keyboard",
      });
      yield* setInventory.execute({ productId: "p-1", quantity: 5 });
      const firstBatch = yield* Stream.runCollect(
        listing.changes(projection.cursors),
      );
      assert.deepEqual(
        firstBatch.map((event) => [event._tag, event.cursor]),
        [
          ["ProductRenamed", 1],
          ["InventorySet", 1],
        ],
      );
      for (const event of firstBatch)
        projection = yield* applyListingChange(projection, event);
      assert.deepEqual(projection.cursors, { products: 1, inventory: 1 });
      assert.equal(projection.updates[0]?.name, "Mechanical Keyboard");
      assert.equal(projection.updates[0]?.availableQuantity, 5);
      assert.equal(
        (yield* catalog.getProduct({ productId: "p-1" })).name,
        "Mechanical Keyboard",
      );
      const currentListing = yield* listing.list;
      assert.equal(currentListing[0]?.name, projection.updates[0]?.name);
      assert.equal(
        currentListing[0]?.availableQuantity,
        projection.updates[0]?.availableQuantity,
      );

      // Continue from the consumer's own offsets after more events arrive.
      yield* rename.execute({ productId: "p-1", name: "Travel Keyboard" });
      yield* setInventory.execute({ productId: "p-1", quantity: 2 });
      const resumed = yield* Stream.runCollect(
        listing.changes(projection.cursors),
      );
      assert.equal(resumed.length, 2);
      assert.ok(resumed.every((event) => event.cursor === 2));
      for (const event of resumed)
        projection = yield* applyListingChange(projection, event);
      assert.deepEqual(projection.cursors, { products: 2, inventory: 2 });
      assert.equal(projection.updates[0]?.name, "Travel Keyboard");
      assert.equal(projection.updates[0]?.availableQuantity, 2);
      const updatedListing = yield* listing.list;
      assert.equal(updatedListing[0]?.name, projection.updates[0]?.name);
      assert.equal(
        updatedListing[0]?.availableQuantity,
        projection.updates[0]?.availableQuantity,
      );
      assert.deepEqual(
        yield* Stream.runCollect(listing.changes(projection.cursors)),
        [],
      );

      let replayed: ListingProjectionState = {
        updates: [],
        cursors: { products: 0, inventory: 0 },
      };
      for (const event of yield* Stream.runCollect(
        listing.changes(replayed.cursors),
      )) {
        replayed = yield* applyListingChange(replayed, event);
      }
      assert.deepEqual(replayed, projection);

      // Two consumers may read independently. Reads never acknowledge an offset.
      assert.equal(
        (yield* Stream.runCollect(productEvents.events(0))).length,
        2,
      );
      assert.equal(
        (yield* Stream.runCollect(productEvents.events(1))).length,
        1,
      );
      assert.strictEqual(
        yield* applyListingChange(projection, renamed),
        projection,
      );
      const gap = yield* applyListingChange(projection, {
        ...renamed,
        cursor: 4,
      }).pipe(Effect.flip);
      assert.ok(gap instanceof ListingProjectionError);
      assert.equal(gap.stage, "cursor");
      const invalidChange = yield* applyListingChange(projection, {
        ...renamed,
        name: "",
      }).pipe(Effect.flip);
      assert.ok(invalidChange instanceof ListingProjectionError);
      assert.equal(invalidChange.stage, "request");
      assert.ok(Schema.isSchemaError(invalidChange.cause));

      const futureCursor = yield* Stream.runCollect(
        listing.changes({ products: 99, inventory: 2 }),
      ).pipe(Effect.flip);
      assert.ok(futureCursor instanceof ProductListingError);
      assert.equal(futureCursor.operation, "ProductListing.changes");
      assert.ok(futureCursor.cause instanceof ProductsError);
      assert.equal(futureCursor.cause.stage, "cursor");
      const invalidCursor = yield* Stream.runCollect(
        listing.changes({ products: -1, inventory: 0 }),
      ).pipe(Effect.flip);
      assert.ok(invalidCursor instanceof ProductListingError);
      assert.equal(invalidCursor.stage, "request");
      const futureInventory = yield* Stream.runCollect(
        inventoryEvents.events(99),
      ).pipe(Effect.flip);
      assert.ok(futureInventory instanceof InventoryError);
      assert.equal(futureInventory.stage, "cursor");

      const beforeRejected = yield* products.list;
      for (const request of [
        { productId: "missing", name: "Name" },
        { productId: "p-1", name: "   " },
      ]) {
        assert.ok(
          (yield* rename.execute(request).pipe(Effect.flip)) instanceof
            ProductRenameRejected,
        );
      }
      const invalidName = yield* rename
        .execute({ productId: "p-1", name: "" })
        .pipe(Effect.flip);
      assert.ok(invalidName instanceof ProductsError);
      assert.equal(invalidName.stage, "request");
      assert.deepEqual(yield* products.list, beforeRejected);
      const invalidQuantity = yield* setInventory
        .execute({ productId: "p-1", quantity: -1 })
        .pipe(Effect.flip);
      assert.ok(invalidQuantity instanceof InventoryError);
      assert.equal(invalidQuantity.stage, "request");
      assert.deepEqual(yield* Stream.runCollect(inventoryEvents.events(2)), []);

      // Concurrent writers receive consecutive cursors; the view matches the log.
      yield* Effect.all(
        [
          setInventory.execute({ productId: "p-1", quantity: 7 }),
          setInventory.execute({ productId: "p-1", quantity: 9 }),
        ],
        { concurrency: "unbounded" },
      );
      const concurrent = yield* Stream.runCollect(inventoryEvents.events(2));
      assert.deepEqual(
        concurrent.map((event) => event.cursor),
        [3, 4],
      );
      assert.equal(
        (yield* inventory.list)[0]?.quantity,
        concurrent[1]?.quantity,
      );
      console.log(
        "PASS public product composes team views/streams; consumer projections replay with independent cursors, redelivery and gap checks",
      );

      // The consuming worker runs policy reactions separately from projections.
      const stockoutCursor = concurrent.at(-1)!.cursor;
      yield* setInventory.execute({ productId: "p-1", quantity: 0 });
      const reactions = yield* Stream.runCollect(
        inventoryEvents
          .events(stockoutCursor)
          .pipe(Stream.mapEffect(stockout.handle)),
      );
      const booking = reactions[0];
      assert.ok(booking);
      assert.equal(booking.quantity, 12);
      assert.equal(booking.deliveryId, "demo-1");
      const redelivery = yield* Stream.runCollect(
        inventoryEvents
          .events(stockoutCursor)
          .pipe(Stream.mapEffect(stockout.handle)),
      );
      assert.deepEqual(redelivery[0], booking);
      const next = yield* deliveries.execute({
        requestId: "manual-1",
        productId: "p-1",
        quantity: 1,
      });
      assert.equal(next.deliveryId, "demo-2");
      assert.equal(
        yield* stockout.handle({
          _tag: "InventorySet",
          cursor: 6,
          productId: "p-1",
          quantity: 3,
        }),
        undefined,
      );

      const reusedKey = yield* deliveries
        .execute({ requestId: "manual-1", productId: "p-1", quantity: 2 })
        .pipe(Effect.flip);
      assert.ok(reusedKey instanceof DeliveryError);
      assert.match(reusedKey.cause.message, /transport/);
      for (const productId of ["carrier-down", "carrier-malformed"]) {
        const failure = yield* stockout
          .handle({ _tag: "InventorySet", cursor: 6, productId, quantity: 0 })
          .pipe(Effect.flip);
        assert.ok(failure instanceof StockoutPolicyError);
        assert.ok(failure.cause instanceof DeliveryError);
        assert.equal(failure.cause.cause.name, "CarrierError");
        assert.ok(failure.cause.cause.cause instanceof Error);
        if (productId === "carrier-malformed")
          assert.ok(Schema.isSchemaError(failure.cause.cause.cause));
        else assert.match(failure.cause.cause.cause.message, /unavailable/);
        const codec = Schema.fromJsonString(
          Schema.toCodecJson(StockoutPolicyError),
        );
        const restored = yield* Schema.decodeUnknownEffect(codec)(
          yield* Schema.encodeEffect(codec)(failure),
        );
        assert.equal(restored.cause.name, "DeliveryError");
        assert.ok(restored.cause.cause instanceof Error);
        assert.equal(restored.cause.cause.name, "CarrierError");
      }
      const emptyDelivery = yield* deliveries
        .execute({ requestId: "empty", productId: "p-1", quantity: 0 })
        .pipe(Effect.flip);
      assert.ok(emptyDelivery instanceof DeliveryError);
      assert.equal(emptyDelivery.stage, "request");
      assert.ok(Schema.isSchemaError(emptyDelivery.cause));
      console.log(
        "PASS stockout policy requests an idempotent delivery through a private carrier adapter; schema and SDK failures retain their cause chain",
      );
    }).pipe(Effect.provide(ExamplesLive)),
  );
