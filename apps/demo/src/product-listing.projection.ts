import { Effect, Schema } from "effect";
import { ListingChange, ListingCursors } from "@shop/catalog";
import { Quantity } from "@shop/logistics";

// The consumer records fields observed in the change feeds. Products that have
// not changed are available through query views, independently of this projection.
export const ListingProjectionState = Schema.Struct({
  updates: Schema.Array(
    Schema.Struct({
      productId: Schema.NonEmptyString,
      name: Schema.optionalKey(Schema.NonEmptyString),
      availableQuantity: Schema.optionalKey(Quantity),
    }),
  ),
  cursors: ListingCursors,
});
export type ListingProjectionState = typeof ListingProjectionState.Type;

export class ListingProjectionError extends Schema.TaggedError<ListingProjectionError>()(
  "ListingProjectionError",
  {
    operation: Schema.Literal("ListingProjection.apply"),
    stage: Schema.Literals(["request", "cursor", "response"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}
const projectionFailure =
  (stage: ListingProjectionError["stage"]) => (cause: Error) =>
    new ListingProjectionError({
      operation: "ListingProjection.apply",
      stage,
      message: `ListingProjection.apply failed at ${stage}`,
      cause,
    });

// This projection belongs to the consuming app. Teams do not store its offsets.
export const applyListingChange = (
  state: ListingProjectionState,
  change: ListingChange,
) =>
  Effect.gen(function* () {
    const event = yield* Schema.decodeUnknownEffect(ListingChange)(change).pipe(
      Effect.mapError(projectionFailure("request")),
    );
    const source = event._tag === "ProductRenamed" ? "products" : "inventory";
    const previous = state.cursors[source];
    if (event.cursor <= previous) return state; // Redelivery is safe.
    if (event.cursor !== previous + 1) {
      return yield* projectionFailure("cursor")(
        new RangeError(
          `Gap in ${source}: expected ${previous + 1}, received ${event.cursor}`,
        ),
      );
    }
    const existing = state.updates.find(
      (item) => item.productId === event.productId,
    ) ?? { productId: event.productId };
    const updated =
      event._tag === "ProductRenamed"
        ? { ...existing, name: event.name }
        : { ...existing, availableQuantity: event.quantity };
    return yield* Schema.decodeUnknownEffect(ListingProjectionState)({
      updates: [
        ...state.updates.filter((item) => item.productId !== event.productId),
        updated,
      ],
      cursors: { ...state.cursors, [source]: event.cursor },
    }).pipe(Effect.mapError(projectionFailure("response")));
  });
