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
export const ListingChange = Schema.Union([ProductEvent, InventoryEvent]);
export type ListingChange = typeof ListingChange.Type;

export class ProductListingError extends Schema.TaggedError<ProductListingError>()(
  "ProductListingError",
  {
    operation: Schema.Literals([
      "ProductListing.list",
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
    readonly list: Effect.Effect<ReadonlyArray<Product>, ProductListingError>;
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
      list: Effect.fn("ProductListing.list")(function* () {
        // Query views answer a read question; stream offsets are managed separately.
        const productRows = yield* products.list.pipe(
          Effect.mapError(listingFailure("ProductListing.list", "dependency")),
        );
        const inventoryRows = yield* inventory.list.pipe(
          Effect.mapError(listingFailure("ProductListing.list", "dependency")),
        );
        const items = yield* Effect.forEach(productRows, (product) =>
          Effect.gen(function* () {
            const price = yield* prices
              .get({ productId: product.id })
              .pipe(
                Effect.mapError(
                  listingFailure("ProductListing.list", "dependency"),
                ),
              );
            return {
              ...product,
              price,
              availableQuantity:
                inventoryRows.find((item) => item.productId === product.id)
                  ?.quantity ?? 0,
            };
          }),
        );
        return yield* Schema.decodeUnknownEffect(Schema.Array(Product))(
          items,
        ).pipe(
          Effect.mapError(listingFailure("ProductListing.list", "response")),
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
