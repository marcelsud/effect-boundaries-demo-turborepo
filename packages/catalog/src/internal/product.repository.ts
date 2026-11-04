import { Context, Effect, Layer, Ref } from "effect";
import { decideRename, ProductRenameRejected } from "./product.aggregate.js";
import type { ProductEvent, ProductRecord } from "./product.aggregate.js";
import { projectProduct } from "./product.projection.js";

interface State {
  readonly products: ReadonlyArray<ProductRecord>;
  readonly events: ReadonlyArray<ProductEvent>;
}

export class ProductRepository extends Context.Service<
  ProductRepository,
  {
    readonly find: (productId: string) => Effect.Effect<unknown>;
    readonly list: Effect.Effect<unknown>;
    readonly events: Effect.Effect<ReadonlyArray<ProductEvent>>;
    readonly rename: (
      productId: string,
      name: string,
    ) => Effect.Effect<ProductEvent, ProductRenameRejected>;
  }
>()("@shop/catalog/internal/ProductRepository") {}

export const ProductRepositoryLive = Layer.effect(
  ProductRepository,
  Effect.gen(function* () {
    // ponytail: process-local history; use a transactional durable store for production.
    const state = yield* Ref.make<State>({
      products: [{ id: "p-1", name: "Keyboard" }],
      events: [],
    });
    return {
      find: (id) =>
        Ref.get(state).pipe(
          Effect.map((s) => s.products.find((p) => p.id === id)),
        ),
      list: Ref.get(state).pipe(Effect.map((s) => s.products)),
      events: Ref.get(state).pipe(Effect.map((s) => s.events)),
      rename: (id, name) =>
        Ref.modify(
          state,
          (s): readonly [ProductEvent | ProductRenameRejected, State] => {
            const event = decideRename(
              s.products.find((p) => p.id === id),
              id,
              name,
              s.events.length + 1,
            );
            if (event instanceof ProductRenameRejected) return [event, s];
            // Publish the event, materialized state, and high-water cursor atomically.
            return [
              event,
              {
                products: projectProduct(s.products, event),
                events: [...s.events, event],
              },
            ];
          },
        ).pipe(
          Effect.flatMap((result) =>
            result instanceof ProductRenameRejected
              ? Effect.fail(result)
              : Effect.succeed(result),
          ),
        ),
    };
  }),
);
