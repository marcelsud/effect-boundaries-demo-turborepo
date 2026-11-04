import { Context, Effect, Layer } from "effect";

// Raw storage data is unknown until PricingLive decodes the public Price schema.
const rows = new Map<string, unknown>([
  ["p-1", { amountCents: 19900, currency: "BRL" }],
]);

export class PriceRepository extends Context.Service<
  PriceRepository,
  {
    readonly find: (productId: string) => Effect.Effect<unknown>;
  }
>()("@shop/pricing/internal/PriceRepository") {}

export const PriceRepositoryLive = Layer.succeed(PriceRepository, {
  find: (productId) => Effect.succeed(rows.get(productId)),
});
