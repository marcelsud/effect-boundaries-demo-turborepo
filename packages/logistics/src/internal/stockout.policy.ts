import { Context, Effect, Layer, Schema } from "effect";
import { InventoryEvent } from "../public/inventory.stream.js";
import {
  Delivery,
  RequestDelivery,
  RequestDeliveryLive,
} from "../public/request-delivery.command.js";

export class StockoutPolicyError extends Schema.TaggedError<StockoutPolicyError>()(
  "StockoutPolicyError",
  {
    operation: Schema.Literal("StockoutPolicy.handle"),
    stage: Schema.Literals(["request", "dependency"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}
const policyFailure = (stage: StockoutPolicyError["stage"]) => (cause: Error) =>
  new StockoutPolicyError({
    operation: "StockoutPolicy.handle",
    stage,
    message: `StockoutPolicy.handle failed at ${stage}`,
    cause,
  });

export class StockoutPolicy extends Context.Service<
  StockoutPolicy,
  {
    readonly handle: (
      event: InventoryEvent,
    ) => Effect.Effect<Delivery | undefined, StockoutPolicyError>;
  }
>()("@shop/logistics/StockoutPolicy") {}

export const StockoutPolicyLive = Layer.effect(
  StockoutPolicy,
  Effect.gen(function* () {
    const deliveries = yield* RequestDelivery;
    return {
      handle: Effect.fn("StockoutPolicy.handle")(function* (
        event: InventoryEvent,
      ) {
        const input = yield* Schema.decodeUnknownEffect(InventoryEvent)(
          event,
        ).pipe(Effect.mapError(policyFailure("request")));
        if (input.quantity !== 0) return undefined;
        // Unlike a projection, this reaction performs an external action.
        return yield* deliveries
          .execute({
            requestId: `inventory:${input.cursor}`,
            productId: input.productId,
            quantity: 12,
          })
          .pipe(Effect.mapError(policyFailure("dependency")));
      }),
    };
  }),
).pipe(Layer.provide(RequestDeliveryLive));
