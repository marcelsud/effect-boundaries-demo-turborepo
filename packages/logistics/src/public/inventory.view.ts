import { Context, Effect, Layer, Schema } from "effect";
import { Quantity } from "../internal/logistics.service.js";
import {
  InventoryRepository,
  InventoryRepositoryLive,
} from "../internal/inventory.repository.js";

export const InventorySnapshot = Schema.Struct({
  inventory: Schema.Array(
    Schema.Struct({ productId: Schema.NonEmptyString, quantity: Quantity }),
  ),
  cursor: Schema.Natural,
});
export type InventorySnapshot = typeof InventorySnapshot.Type;

export class InventoryError extends Schema.TaggedError<InventoryError>()(
  "InventoryError",
  {
    operation: Schema.Literals([
      "InventoryView.snapshot",
      "InventoryStream.events",
      "SetInventory.execute",
    ]),
    stage: Schema.Literals(["request", "cursor", "storage", "response"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}
export const inventoryFailure =
  (operation: InventoryError["operation"], stage: InventoryError["stage"]) =>
  (cause: Error) =>
    new InventoryError({
      operation,
      stage,
      message: `${operation} failed at ${stage}`,
      cause,
    });

export class InventoryView extends Context.Service<
  InventoryView,
  {
    readonly snapshot: Effect.Effect<InventorySnapshot, InventoryError>;
  }
>()("@shop/logistics/InventoryView") {}

export const InventoryViewLive = Layer.effect(
  InventoryView,
  Effect.gen(function* () {
    const inventory = yield* InventoryRepository;
    return {
      snapshot: Effect.fn("InventoryView.snapshot")(function* () {
        return yield* inventory.snapshot.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(InventorySnapshot)),
          Effect.mapError(
            inventoryFailure("InventoryView.snapshot", "storage"),
          ),
        );
      })(),
    };
  }),
).pipe(Layer.provide(InventoryRepositoryLive));
