import { Context, Effect, Layer, Schema } from "effect";
import {
  PriceRepository,
  PriceRepositoryLive,
} from "./internal/PriceRepository.js";

export const GetPriceRequest = Schema.Struct({
  productId: Schema.NonEmptyString,
});
export type GetPriceRequest = typeof GetPriceRequest.Type;

export const Price = Schema.Struct({
  amountCents: Schema.Natural,
  currency: Schema.Literal("BRL"),
});
export type Price = typeof Price.Type;

export class PriceUnavailable extends Schema.TaggedError<PriceUnavailable>()(
  "PriceUnavailable",
  { productId: Schema.NonEmptyString, message: Schema.NonEmptyString },
) {}

export class Pricing extends Context.Service<
  Pricing,
  {
    readonly getPrice: (
      request: GetPriceRequest,
    ) => Effect.Effect<Price, PriceUnavailable | Schema.SchemaError>;
  }
>()("@shop/Pricing") {}

export const PricingLive: Layer.Layer<Pricing> = Layer.effect(
  Pricing,
  Effect.gen(function* () {
    const prices = yield* PriceRepository;
    return {
      getPrice: (request) =>
        Effect.gen(function* () {
          const { productId } =
            yield* Schema.decodeUnknownEffect(GetPriceRequest)(request);
          const row = yield* prices.find(productId);
          if (row === undefined) {
            return yield* new PriceUnavailable({
              productId,
              message: "Price not found",
            });
          }
          return yield* Schema.decodeUnknownEffect(Price)(row);
        }),
    };
  }),
).pipe(Layer.provide(PriceRepositoryLive));
