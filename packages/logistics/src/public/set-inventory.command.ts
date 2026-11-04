import { Context, Effect, Layer, Schema } from "effect";
import { Quantity } from "../internal/logistics.service.js";
import {
  InventoryRepository,
  InventoryRepositoryLive,
} from "../internal/inventory.repository.js";
import { InventoryEvent } from "./inventory.stream.js";
import { InventoryError, inventoryFailure } from "./inventory.view.js";

export const SetInventoryRequest = Schema.Struct({
  productId: Schema.NonEmptyString,
  quantity: Quantity,
});
export type SetInventoryRequest = typeof SetInventoryRequest.Type;

export class SetInventory extends Context.Service<
  SetInventory,
  {
    readonly execute: (
      request: SetInventoryRequest,
    ) => Effect.Effect<InventoryEvent, InventoryError>;
  }
>()("@shop/logistics/SetInventory") {}

export const SetInventoryLive = Layer.effect(
  SetInventory,
  Effect.gen(function* () {
    const inventory = yield* InventoryRepository;
    return {
      execute: Effect.fn("SetInventory.execute")(function* (
        request: SetInventoryRequest,
      ) {
        const input = yield* Schema.decodeUnknownEffect(SetInventoryRequest)(
          request,
        ).pipe(
          Effect.mapError(inventoryFailure("SetInventory.execute", "request")),
        );
        const event = yield* inventory.set(input.productId, input.quantity);
        return yield* Schema.decodeUnknownEffect(InventoryEvent)(event).pipe(
          Effect.mapError(inventoryFailure("SetInventory.execute", "response")),
        );
      }),
    };
  }),
).pipe(Layer.provide(InventoryRepositoryLive));
