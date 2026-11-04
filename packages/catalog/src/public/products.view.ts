import { Context, Effect, Layer, Schema } from "effect";
import { ProductRecord } from "../internal/product.aggregate.js";
import {
  ProductRepository,
  ProductRepositoryLive,
} from "../internal/product.repository.js";

export const ProductSummary = ProductRecord;
export type ProductSummary = typeof ProductSummary.Type;
export const ProductsSnapshot = Schema.Struct({
  products: Schema.Array(ProductSummary),
  cursor: Schema.Natural,
});
export type ProductsSnapshot = typeof ProductsSnapshot.Type;

export class ProductsError extends Schema.TaggedError<ProductsError>()(
  "ProductsError",
  {
    operation: Schema.Literals([
      "ProductsView.snapshot",
      "ProductsStream.events",
      "RenameProduct.execute",
    ]),
    stage: Schema.Literals(["request", "cursor", "storage", "response"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}

export const productsFailure =
  (operation: ProductsError["operation"], stage: ProductsError["stage"]) =>
  (cause: Error) =>
    new ProductsError({
      operation,
      stage,
      message: `${operation} failed at ${stage}`,
      cause,
    });

export class ProductsView extends Context.Service<
  ProductsView,
  {
    readonly snapshot: Effect.Effect<ProductsSnapshot, ProductsError>;
  }
>()("@shop/catalog/ProductsView") {}

export const ProductsViewLive = Layer.effect(
  ProductsView,
  Effect.gen(function* () {
    const products = yield* ProductRepository;
    return {
      snapshot: Effect.fn("ProductsView.snapshot")(function* () {
        return yield* products.snapshot.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(ProductsSnapshot)),
          Effect.mapError(productsFailure("ProductsView.snapshot", "storage")),
        );
      })(),
    };
  }),
).pipe(Layer.provide(ProductRepositoryLive));
