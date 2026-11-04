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

export class Logistics extends Context.Service<
  Logistics,
  {
    readonly getAvailability: (
      request: GetAvailabilityRequest,
    ) => Effect.Effect<Quantity, Schema.SchemaError>;
  }
>()("@shop/Logistics") {}

export const LogisticsLive: Layer.Layer<Logistics> = Layer.effect(
  Logistics,
  Effect.gen(function* () {
    const inventory = yield* InventoryRepository;
    return {
      getAvailability: (request) =>
        Effect.gen(function* () {
          const { productId } = yield* Schema.decodeUnknownEffect(
            GetAvailabilityRequest,
          )(request);
          const row = yield* inventory.quantity(productId);
          return yield* Schema.decodeUnknownEffect(Quantity)(row);
        }),
    };
  }),
).pipe(Layer.provide(InventoryRepositoryLive));
