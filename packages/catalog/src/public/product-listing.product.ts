import { Context, Effect, Layer, Schema, Stream } from "effect";
import {
  InventoryEvent,
  InventoryStream,
  InventoryView,
} from "@shop/logistics";
import { PriceView } from "@shop/pricing";
import { Product } from "../internal/catalog.service.js";
import { ProductEvent, ProductsStream } from "./products.stream.js";
import { ProductsView } from "./products.view.js";

export const ListingCursors = Schema.Struct({
  products: Schema.Natural,
  inventory: Schema.Natural,
});
export type ListingCursors = typeof ListingCursors.Type;
export const ProductListingSnapshot = Schema.Struct({
  items: Schema.Array(Product),
  cursors: ListingCursors,
});
export type ProductListingSnapshot = typeof ProductListingSnapshot.Type;
export const ListingChange = Schema.Union([ProductEvent, InventoryEvent]);
export type ListingChange = typeof ListingChange.Type;

export class ProductListingError extends Schema.TaggedError<ProductListingError>()(
  "ProductListingError",
  {
    operation: Schema.Literals([
      "ProductListing.snapshot",
      "ProductListing.changes",
    ]),
    stage: Schema.Literals(["request", "dependency", "response"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}
const listingFailure =
  (
    operation: ProductListingError["operation"],
    stage: ProductListingError["stage"],
  ) =>
  (cause: Error) =>
    new ProductListingError({
      operation,
      stage,
      message: `${operation} failed at ${stage}`,
      cause,
    });

export class ProductListing extends Context.Service<
  ProductListing,
  {
    readonly snapshot: Effect.Effect<
      ProductListingSnapshot,
      ProductListingError
    >;
    readonly changes: (
      after: ListingCursors,
    ) => Stream.Stream<ListingChange, ProductListingError>;
  }
>()("@shop/catalog/ProductListing") {}

// The product's inputs are all published capabilities, including Catalog's own.
export const ProductListingLive = Layer.effect(
  ProductListing,
  Effect.gen(function* () {
    const products = yield* ProductsView;
    const productEvents = yield* ProductsStream;
    const inventory = yield* InventoryView;
    const inventoryEvents = yield* InventoryStream;
    const prices = yield* PriceView;
    return {
      snapshot: Effect.fn("ProductListing.snapshot")(function* () {
        // Each source snapshot is atomic with its cursor. This is a cursor vector,
        // not a transaction across teams. Pricing is read-only in this example.
        const productState = yield* products.snapshot.pipe(
          Effect.mapError(
            listingFailure("ProductListing.snapshot", "dependency"),
          ),
        );
        const inventoryState = yield* inventory.snapshot.pipe(
          Effect.mapError(
            listingFailure("ProductListing.snapshot", "dependency"),
          ),
        );
        const items = yield* Effect.forEach(productState.products, (product) =>
          Effect.gen(function* () {
            const price = yield* prices
              .get({ productId: product.id })
              .pipe(
                Effect.mapError(
                  listingFailure("ProductListing.snapshot", "dependency"),
                ),
              );
            return {
              ...product,
              price,
              availableQuantity:
                inventoryState.inventory.find(
                  (item) => item.productId === product.id,
                )?.quantity ?? 0,
            };
          }),
        );
        return yield* Schema.decodeUnknownEffect(ProductListingSnapshot)({
          items,
          cursors: {
            products: productState.cursor,
            inventory: inventoryState.cursor,
          },
        }).pipe(
          Effect.mapError(
            listingFailure("ProductListing.snapshot", "response"),
          ),
        );
      })(),
      changes: (after: ListingCursors) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const cursors = yield* Schema.decodeUnknownEffect(ListingCursors)(
              after,
            ).pipe(
              Effect.mapError(
                listingFailure("ProductListing.changes", "request"),
              ),
            );
            // Per-source order is preserved; there is no global event order.
            return Stream.concat(
              productEvents.events(cursors.products),
              inventoryEvents.events(cursors.inventory),
            ).pipe(
              Stream.mapError(
                listingFailure("ProductListing.changes", "dependency"),
              ),
            );
          }),
        ),
    };
  }),
);
