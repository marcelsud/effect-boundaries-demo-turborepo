import { Context, Effect, Layer, Schema } from "effect";
import {
  ProductEvent,
  ProductRenameRejected,
} from "../internal/product.aggregate.js";
import {
  ProductRepository,
  ProductRepositoryLive,
} from "../internal/product.repository.js";
import { ProductsError, productsFailure } from "./products.view.js";

export { ProductRenameRejected };
export const RenameProductRequest = Schema.Struct({
  productId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});
export type RenameProductRequest = typeof RenameProductRequest.Type;

export class RenameProduct extends Context.Service<
  RenameProduct,
  {
    readonly execute: (
      request: RenameProductRequest,
    ) => Effect.Effect<ProductEvent, ProductRenameRejected | ProductsError>;
  }
>()("@shop/catalog/RenameProduct") {}

export const RenameProductLive = Layer.effect(
  RenameProduct,
  Effect.gen(function* () {
    const products = yield* ProductRepository;
    return {
      execute: Effect.fn("RenameProduct.execute")(function* (
        request: RenameProductRequest,
      ) {
        const input = yield* Schema.decodeUnknownEffect(RenameProductRequest)(
          request,
        ).pipe(
          Effect.mapError(productsFailure("RenameProduct.execute", "request")),
        );
        const event = yield* products.rename(input.productId, input.name);
        return yield* Schema.decodeUnknownEffect(ProductEvent)(event).pipe(
          Effect.mapError(productsFailure("RenameProduct.execute", "response")),
        );
      }),
    };
  }),
).pipe(Layer.provide(ProductRepositoryLive));
