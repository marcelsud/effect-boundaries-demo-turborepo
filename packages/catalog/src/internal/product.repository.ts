import { Context, Effect, Layer } from "effect";

// CatalogLive validates the storage record before using it as domain data.
const rows = new Map<string, unknown>([
  ["p-1", { id: "p-1", name: "Keyboard" }],
]);

export class ProductRepository extends Context.Service<
  ProductRepository,
  {
    readonly find: (productId: string) => Effect.Effect<unknown>;
  }
>()("@shop/catalog/internal/ProductRepository") {}

export const ProductRepositoryLive = Layer.succeed(ProductRepository, {
  find: (productId) => Effect.succeed(rows.get(productId)),
});
