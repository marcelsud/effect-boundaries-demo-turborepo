import { Context, Effect, Layer, Schema } from "effect";
import { PriceRepository, PriceRepositoryLive } from "./price.repository.js";

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

export class PricingError extends Schema.TaggedError<PricingError>()(
  "PricingError",
  {
    operation: Schema.Literal("Pricing.getPrice"),
    stage: Schema.Literals(["request", "storage", "dependency", "response"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}

const pricingFailure = (stage: PricingError["stage"]) => (cause: Error) =>
  new PricingError({
    operation: "Pricing.getPrice",
    stage,
    message: `Pricing.getPrice failed at ${stage}`,
    cause,
  });

export class Pricing extends Context.Service<
  Pricing,
  {
    readonly getPrice: (
      request: GetPriceRequest,
    ) => Effect.Effect<Price, PriceUnavailable | PricingError>;
  }
>()("@shop/Pricing") {}

export const PricingLive: Layer.Layer<Pricing> = Layer.effect(
  Pricing,
  Effect.gen(function* () {
    const prices = yield* PriceRepository;
    return {
      getPrice: Effect.fn("Pricing.getPrice")(function* (
        request: GetPriceRequest,
      ) {
        const { productId } = yield* Schema.decodeUnknownEffect(
          GetPriceRequest,
        )(request).pipe(Effect.mapError(pricingFailure("request")));
        const row = yield* prices.find(productId);
        if (row === undefined) {
          return yield* new PriceUnavailable({
            productId,
            message: "Price not found",
          });
        }
        return yield* Schema.decodeUnknownEffect(Price)(row).pipe(
          Effect.mapError(pricingFailure("storage")),
        );
      }),
    };
  }),
).pipe(Layer.provide(PriceRepositoryLive));
