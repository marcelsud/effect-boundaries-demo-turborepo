import { Context, Effect, Layer, Schema } from "effect";
import {
  BookDeliveryRequest,
  Carrier,
  Delivery,
} from "../external/carrier.external.js";
import { CarrierLive } from "../external/demo-carrier.client.js";

export { Delivery };
export const RequestDeliveryRequest = BookDeliveryRequest;
export type RequestDeliveryRequest = typeof RequestDeliveryRequest.Type;
export class DeliveryError extends Schema.TaggedError<DeliveryError>()(
  "DeliveryError",
  {
    operation: Schema.Literal("RequestDelivery.execute"),
    stage: Schema.Literals(["request", "external", "response"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}
const deliveryFailure = (stage: DeliveryError["stage"]) => (cause: Error) =>
  new DeliveryError({
    operation: "RequestDelivery.execute",
    stage,
    message: `RequestDelivery.execute failed at ${stage}`,
    cause,
  });

export class RequestDelivery extends Context.Service<
  RequestDelivery,
  {
    readonly execute: (
      request: RequestDeliveryRequest,
    ) => Effect.Effect<Delivery, DeliveryError>;
  }
>()("@shop/logistics/RequestDelivery") {}

export const RequestDeliveryLive = Layer.effect(
  RequestDelivery,
  Effect.gen(function* () {
    const carrier = yield* Carrier;
    return {
      execute: Effect.fn("RequestDelivery.execute")(function* (
        request: RequestDeliveryRequest,
      ) {
        const input = yield* Schema.decodeUnknownEffect(RequestDeliveryRequest)(
          request,
        ).pipe(Effect.mapError(deliveryFailure("request")));
        const delivery = yield* carrier
          .book(input)
          .pipe(Effect.mapError(deliveryFailure("external")));
        return yield* Schema.decodeUnknownEffect(Delivery)(delivery).pipe(
          Effect.mapError(deliveryFailure("response")),
        );
      }),
    };
  }),
).pipe(Layer.provide(CarrierLive));
