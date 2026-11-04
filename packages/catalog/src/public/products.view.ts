import { Context, Effect, Layer, Schema } from "effect";
import { ProductRecord } from "../internal/product.aggregate.js";
import {
  ProductRepository,
  ProductRepositoryLive,
} from "../internal/product.repository.js";

export const ProductSummary = ProductRecord;
export type ProductSummary = typeof ProductSummary.Type;

export class ProductsError extends Schema.TaggedError<ProductsError>()(
  "ProductsError",
  {
    operation: Schema.Literals([
      "ProductsView.list",
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
    readonly list: Effect.Effect<ReadonlyArray<ProductSummary>, ProductsError>;
  }
>()("@shop/catalog/ProductsView") {}

export const ProductsViewLive = Layer.effect(
  ProductsView,
  Effect.gen(function* () {
    const products = yield* ProductRepository;
    return {
      list: Effect.fn("ProductsView.list")(function* () {
        return yield* products.list.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Array(ProductSummary)),
          ),
          Effect.mapError(productsFailure("ProductsView.list", "storage")),
        );
      })(),
    };
  }),
).pipe(Layer.provide(ProductRepositoryLive));
