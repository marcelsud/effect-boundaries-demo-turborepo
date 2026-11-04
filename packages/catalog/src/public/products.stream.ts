import { Context, Effect, Layer, Schema, Stream } from "effect";
import { ProductEvent } from "../internal/product.aggregate.js";
import {
  ProductRepository,
  ProductRepositoryLive,
} from "../internal/product.repository.js";
import { ProductsError, productsFailure } from "./products.view.js";

export { ProductEvent };

export class ProductsStream extends Context.Service<
  ProductsStream,
  {
    readonly events: (
      after: number,
    ) => Stream.Stream<ProductEvent, ProductsError>;
  }
>()("@shop/catalog/ProductsStream") {}

export const ProductsStreamLive = Layer.effect(
  ProductsStream,
  Effect.gen(function* () {
    const products = yield* ProductRepository;
    return {
      // Each pull captures a finite batch. The consumer owns and persists `after`.
      events: (after) =>
        Stream.fromIterableEffect(
          Effect.gen(function* () {
            const cursor = yield* Schema.decodeUnknownEffect(Schema.Natural)(
              after,
            ).pipe(
              Effect.mapError(
                productsFailure("ProductsStream.events", "request"),
              ),
            );
            const events = yield* products.events.pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(Schema.Array(ProductEvent)),
              ),
              Effect.mapError(
                productsFailure("ProductsStream.events", "storage"),
              ),
            );
            if (cursor > events.length) {
              return yield* productsFailure(
                "ProductsStream.events",
                "cursor",
              )(new RangeError("Cursor is ahead of product history"));
            }
            return events.filter((event) => event.cursor > cursor);
          }),
        ),
    };
  }),
).pipe(Layer.provide(ProductRepositoryLive));
