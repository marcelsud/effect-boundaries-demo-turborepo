import { Context, Effect, Layer, Schema } from "effect";
import { Quantity } from "../internal/logistics.service.js";
import {
  InventoryRepository,
  InventoryRepositoryLive,
} from "../internal/inventory.repository.js";

export const InventoryItem = Schema.Struct({
  productId: Schema.NonEmptyString,
  quantity: Quantity,
});
export type InventoryItem = typeof InventoryItem.Type;

export class InventoryError extends Schema.TaggedError<InventoryError>()(
  "InventoryError",
  {
    operation: Schema.Literals([
      "InventoryView.list",
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
    readonly list: Effect.Effect<ReadonlyArray<InventoryItem>, InventoryError>;
  }
>()("@shop/logistics/InventoryView") {}

export const InventoryViewLive = Layer.effect(
  InventoryView,
  Effect.gen(function* () {
    const inventory = yield* InventoryRepository;
    return {
      list: Effect.fn("InventoryView.list")(function* () {
        return yield* inventory.list.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Array(InventoryItem)),
          ),
          Effect.mapError(inventoryFailure("InventoryView.list", "storage")),
        );
      })(),
    };
  }),
).pipe(Layer.provide(InventoryRepositoryLive));
