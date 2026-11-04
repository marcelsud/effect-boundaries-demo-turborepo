import { Effect, Schema } from "effect";
import { ListingChange, ProductListingSnapshot } from "@shop/catalog";

export class ListingProjectionError extends Schema.TaggedError<ListingProjectionError>()(
  "ListingProjectionError",
  {
    operation: Schema.Literals([
      "ListingProjection.apply",
      "ListingProjection.restore",
    ]),
    stage: Schema.Literals(["request", "cursor", "snapshot"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}
const projectionFailure =
  (
    operation: ListingProjectionError["operation"],
    stage: ListingProjectionError["stage"],
  ) =>
  (cause: Error) =>
    new ListingProjectionError({
      operation,
      stage,
      message: `${operation} failed at ${stage}`,
      cause,
    });

export const restoreListing = (json: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(ProductListingSnapshot))(
    json,
  ).pipe(
    Effect.mapError(projectionFailure("ListingProjection.restore", "snapshot")),
  );

// This projection belongs to the consuming app. Teams do not store its offsets.
export const applyListingChange = (
  state: ProductListingSnapshot,
  change: ListingChange,
) =>
  Effect.gen(function* () {
    const event = yield* Schema.decodeUnknownEffect(ListingChange)(change).pipe(
      Effect.mapError(projectionFailure("ListingProjection.apply", "request")),
    );
    const source = event._tag === "ProductRenamed" ? "products" : "inventory";
    const previous = state.cursors[source];
    if (event.cursor <= previous) return state; // Redelivery is safe.
    if (event.cursor !== previous + 1) {
      return yield* projectionFailure(
        "ListingProjection.apply",
        "cursor",
      )(
        new RangeError(
          `Gap in ${source}: expected ${previous + 1}, received ${event.cursor}`,
        ),
      );
    }
    const items = state.items.map((item) =>
      item.id !== event.productId
        ? item
        : event._tag === "ProductRenamed"
          ? { ...item, name: event.name }
          : { ...item, availableQuantity: event.quantity },
    );
    return yield* Schema.decodeUnknownEffect(ProductListingSnapshot)({
      items,
      cursors: { ...state.cursors, [source]: event.cursor },
    }).pipe(
      Effect.mapError(projectionFailure("ListingProjection.apply", "snapshot")),
    );
  });
