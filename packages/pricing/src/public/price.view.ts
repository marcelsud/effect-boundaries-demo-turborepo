import { Context, Effect, Layer } from "effect";
import { Pricing, PricingLive } from "../internal/pricing.service.js";
import type {
  GetPriceRequest,
  Price,
  PriceUnavailable,
  PricingError,
} from "../internal/pricing.service.js";

// Pricing owns this read-only capability. Its schemas and errors remain shared
// with the underlying service; it introduces no second validation contract.
export class PriceView extends Context.Service<
  PriceView,
  {
    readonly get: (
      request: GetPriceRequest,
    ) => Effect.Effect<Price, PriceUnavailable | PricingError>;
  }
>()("@shop/pricing/PriceView") {}

export const PriceViewLive = Layer.effect(
  PriceView,
  Effect.gen(function* () {
    const pricing = yield* Pricing;
    return { get: pricing.getPrice };
  }),
).pipe(Layer.provide(PricingLive));
