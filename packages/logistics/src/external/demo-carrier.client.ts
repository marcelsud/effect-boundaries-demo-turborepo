import { Effect, Layer, Schema } from "effect";
import {
  BookDeliveryRequest,
  Carrier,
  CarrierError,
  Delivery,
} from "./carrier.external.js";

const VendorShipment = Schema.Struct({ shipment_id: Schema.NonEmptyString });
const carrierFailure = (stage: CarrierError["stage"]) => (cause: Error) =>
  new CarrierError({
    operation: "Carrier.book",
    stage,
    message: `Carrier.book failed at ${stage}`,
    cause,
  });

export const CarrierLive = Layer.effect(
  Carrier,
  Effect.sync(() => {
    // A deterministic stand-in for a Promise-based third-party SDK.
    // ponytail: process-local idempotency; a real carrier must persist these keys.
    const bookings = new Map<
      string,
      { sku: string; units: number; shipment_id: string }
    >();
    const sdk = {
      createShipment: async (input: {
        idempotency_key: string;
        sku: string;
        units: number;
      }): Promise<unknown> => {
        if (input.sku === "carrier-down")
          throw new Error("Demo carrier is unavailable");
        if (input.sku === "carrier-malformed") return { shipment_id: 123 };
        const previous = bookings.get(input.idempotency_key);
        if (
          previous &&
          (previous.sku !== input.sku || previous.units !== input.units)
        ) {
          throw new Error(
            "Idempotency key was reused with a different payload",
          );
        }
        const booking = previous ?? {
          sku: input.sku,
          units: input.units,
          shipment_id: `demo-${bookings.size + 1}`,
        };
        bookings.set(input.idempotency_key, booking);
        return { shipment_id: booking.shipment_id };
      },
    };
    return {
      book: Effect.fn("Carrier.book")(function* (request: BookDeliveryRequest) {
        const input = yield* Schema.decodeUnknownEffect(BookDeliveryRequest)(
          request,
        ).pipe(Effect.mapError(carrierFailure("request")));
        const raw = yield* Effect.tryPromise({
          try: () =>
            sdk.createShipment({
              idempotency_key: input.requestId,
              sku: input.productId,
              units: input.quantity,
            }),
          catch: (cause) =>
            carrierFailure("transport")(
              cause instanceof Error ? cause : new Error(String(cause)),
            ),
        });
        const result = yield* Schema.decodeUnknownEffect(VendorShipment)(
          raw,
        ).pipe(Effect.mapError(carrierFailure("response")));
        return yield* Schema.decodeUnknownEffect(Delivery)({
          ...input,
          deliveryId: result.shipment_id,
        }).pipe(Effect.mapError(carrierFailure("response")));
      }),
    };
  }),
);
