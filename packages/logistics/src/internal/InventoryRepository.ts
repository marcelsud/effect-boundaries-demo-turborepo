import { Context, Effect, Layer } from "effect";

// LogisticsLive validates storage values with the public Quantity schema.
const rows = new Map<string, unknown>([["p-1", 12]]);

export class InventoryRepository extends Context.Service<
  InventoryRepository,
  {
    readonly quantity: (productId: string) => Effect.Effect<unknown>;
  }
>()("@shop/logistics/internal/InventoryRepository") {}

export const InventoryRepositoryLive = Layer.succeed(InventoryRepository, {
  quantity: (productId) => {
    const row = rows.get(productId);
    return Effect.succeed(row === undefined ? 0 : row);
  },
});
