import { Context, Effect, Layer, Schema } from "effect";
import {
  InventoryRepository,
  InventoryRepositoryLive,
} from "./internal/InventoryRepository.js";

export const GetAvailabilityRequest = Schema.Struct({
  productId: Schema.NonEmptyString,
});
export type GetAvailabilityRequest = typeof GetAvailabilityRequest.Type;

export const Quantity = Schema.Natural;
export type Quantity = typeof Quantity.Type;

export class LogisticsError extends Schema.TaggedError<LogisticsError>()(
  "LogisticsError",
  {
    operation: Schema.Literal("Logistics.getAvailability"),
    stage: Schema.Literals(["request", "storage", "dependency", "response"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}

const logisticsFailure = (stage: LogisticsError["stage"]) => (cause: Error) =>
  new LogisticsError({
    operation: "Logistics.getAvailability",
    stage,
    message: `Logistics.getAvailability failed at ${stage}`,
    cause,
  });

export class Logistics extends Context.Service<
  Logistics,
  {
    readonly getAvailability: (
      request: GetAvailabilityRequest,
    ) => Effect.Effect<Quantity, LogisticsError>;
  }
>()("@shop/Logistics") {}

export const LogisticsLive: Layer.Layer<Logistics> = Layer.effect(
  Logistics,
  Effect.gen(function* () {
    const inventory = yield* InventoryRepository;
    return {
      getAvailability: Effect.fn("Logistics.getAvailability")(function* (
        request: GetAvailabilityRequest,
      ) {
        const { productId } = yield* Schema.decodeUnknownEffect(
          GetAvailabilityRequest,
        )(request).pipe(Effect.mapError(logisticsFailure("request")));
        const row = yield* inventory.quantity(productId);
        return yield* Schema.decodeUnknownEffect(Quantity)(row).pipe(
          Effect.mapError(logisticsFailure("storage")),
        );
      }),
    };
  }),
).pipe(Layer.provide(InventoryRepositoryLive));
