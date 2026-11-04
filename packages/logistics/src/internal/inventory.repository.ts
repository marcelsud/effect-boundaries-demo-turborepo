import { Context, Effect, Layer, Ref } from "effect";
import type { InventoryEvent } from "../public/inventory.stream.js";

interface State {
  readonly inventory: ReadonlyArray<{
    readonly productId: string;
    readonly quantity: number;
  }>;
  readonly events: ReadonlyArray<InventoryEvent>;
}

export class InventoryRepository extends Context.Service<
  InventoryRepository,
  {
    readonly quantity: (productId: string) => Effect.Effect<unknown>;
    readonly snapshot: Effect.Effect<unknown>;
    readonly events: Effect.Effect<ReadonlyArray<InventoryEvent>>;
    readonly set: (
      productId: string,
      quantity: number,
    ) => Effect.Effect<InventoryEvent>;
  }
>()("@shop/logistics/internal/InventoryRepository") {}

export const InventoryRepositoryLive = Layer.effect(
  InventoryRepository,
  Effect.gen(function* () {
    // ponytail: process-local history; use a transactional durable store for production.
    const state = yield* Ref.make<State>({
      inventory: [{ productId: "p-1", quantity: 12 }],
      events: [],
    });
    return {
      quantity: (productId: string) =>
        Ref.get(state).pipe(
          Effect.map((s) => {
            const row = s.inventory.find(
              (item) => item.productId === productId,
            );
            return row === undefined ? 0 : row.quantity;
          }),
        ),
      snapshot: Ref.get(state).pipe(
        Effect.map((s) => ({
          inventory: s.inventory,
          cursor: s.events.length,
        })),
      ),
      events: Ref.get(state).pipe(Effect.map((s) => s.events)),
      set: (productId: string, quantity: number) =>
        Ref.modify(state, (s): readonly [InventoryEvent, State] => {
          const event: InventoryEvent = {
            _tag: "InventorySet",
            cursor: s.events.length + 1,
            productId,
            quantity,
          };
          const inventory = [
            ...s.inventory.filter((item) => item.productId !== productId),
            { productId, quantity },
          ];
          return [event, { inventory, events: [...s.events, event] }];
        }),
    };
  }),
);
