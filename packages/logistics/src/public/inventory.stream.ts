import { Context, Effect, Layer, Schema, Stream } from "effect";
import { Quantity } from "../internal/logistics.service.js";
import {
  InventoryRepository,
  InventoryRepositoryLive,
} from "../internal/inventory.repository.js";
import { InventoryError, inventoryFailure } from "./inventory.view.js";

export const InventoryEvent = Schema.TaggedStruct("InventorySet", {
  cursor: Schema.Natural,
  productId: Schema.NonEmptyString,
  quantity: Quantity,
});
export type InventoryEvent = typeof InventoryEvent.Type;

export class InventoryStream extends Context.Service<
  InventoryStream,
  {
    readonly events: (
      after: number,
    ) => Stream.Stream<InventoryEvent, InventoryError>;
  }
>()("@shop/logistics/InventoryStream") {}

export const InventoryStreamLive = Layer.effect(
  InventoryStream,
  Effect.gen(function* () {
    const inventory = yield* InventoryRepository;
    return {
      events: (after: number) =>
        Stream.fromIterableEffect(
          Effect.gen(function* () {
            const cursor = yield* Schema.decodeUnknownEffect(Schema.Natural)(
              after,
            ).pipe(
              Effect.mapError(
                inventoryFailure("InventoryStream.events", "request"),
              ),
            );
            const events = yield* inventory.events.pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(Schema.Array(InventoryEvent)),
              ),
              Effect.mapError(
                inventoryFailure("InventoryStream.events", "storage"),
              ),
            );
            if (cursor > events.length) {
              return yield* inventoryFailure(
                "InventoryStream.events",
                "cursor",
              )(new RangeError("Cursor is ahead of inventory history"));
            }
            return events.filter((event) => event.cursor > cursor);
          }),
        ),
    };
  }),
).pipe(Layer.provide(InventoryRepositoryLive));
