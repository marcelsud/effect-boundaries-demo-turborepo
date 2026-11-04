import { Context, Effect, Schema } from "effect";

export const BookDeliveryRequest = Schema.Struct({
  requestId: Schema.NonEmptyString,
  productId: Schema.NonEmptyString,
  quantity: Schema.Natural.check(Schema.isGreaterThan(0)),
});
export type BookDeliveryRequest = typeof BookDeliveryRequest.Type;
export const Delivery = Schema.Struct({
  ...BookDeliveryRequest.fields,
  deliveryId: Schema.NonEmptyString,
});
export type Delivery = typeof Delivery.Type;

export class CarrierError extends Schema.TaggedError<CarrierError>()(
  "CarrierError",
  {
    operation: Schema.Literal("Carrier.book"),
    stage: Schema.Literals(["request", "transport", "response"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}

// Private domain-facing port. Vendor SDK objects never escape this package.
export class Carrier extends Context.Service<
  Carrier,
  {
    readonly book: (
      request: BookDeliveryRequest,
    ) => Effect.Effect<Delivery, CarrierError>;
  }
>()("@shop/logistics/external/Carrier") {}
