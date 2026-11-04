import { Context, Effect, Layer, Schema } from "effect";
import { Logistics, Quantity } from "@shop/logistics";
import { Pricing, Price } from "@shop/pricing";
import {
  ProductRepository,
  ProductRepositoryLive,
} from "./internal/ProductRepository.js";

export const GetProductRequest = Schema.Struct({
  productId: Schema.NonEmptyString,
});
export type GetProductRequest = typeof GetProductRequest.Type;

const ProductRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export const Product = Schema.Struct({
  ...ProductRecord.fields,
  availableQuantity: Quantity,
  price: Price,
});
export type Product = typeof Product.Type;

export class ProductUnavailable extends Schema.TaggedError<ProductUnavailable>()(
  "ProductUnavailable",
  {
    productId: Schema.NonEmptyString,
    message: Schema.NonEmptyString,
    cause: Schema.optionalKey(Schema.ErrorInstance({ includeStack: true })),
  },
) {}

export class CatalogError extends Schema.TaggedError<CatalogError>()(
  "CatalogError",
  {
    operation: Schema.Literal("Catalog.getProduct"),
    stage: Schema.Literals(["request", "storage", "dependency", "response"]),
    message: Schema.NonEmptyString,
    cause: Schema.ErrorInstance({ includeStack: true }),
  },
) {}

const catalogFailure = (stage: CatalogError["stage"]) => (cause: Error) =>
  new CatalogError({
    operation: "Catalog.getProduct",
    stage,
    message: `Catalog.getProduct failed at ${stage}`,
    cause,
  });

export class Catalog extends Context.Service<
  Catalog,
  {
    readonly getProduct: (
      request: GetProductRequest,
    ) => Effect.Effect<Product, ProductUnavailable | CatalogError>;
  }
>()("@shop/Catalog") {}

// The owning team controls the public Layer and its provider requirements.
export const CatalogLive: Layer.Layer<Catalog, never, Logistics | Pricing> =
  Layer.effect(
    Catalog,
    Effect.gen(function* () {
      const products = yield* ProductRepository;
      const logistics = yield* Logistics;
      const pricing = yield* Pricing;
      return {
        getProduct: Effect.fn("Catalog.getProduct")(function* (
          request: GetProductRequest,
        ) {
          const input = yield* Schema.decodeUnknownEffect(GetProductRequest)(
            request,
          ).pipe(Effect.mapError(catalogFailure("request")));
          const row = yield* products.find(input.productId);
          if (row === undefined) {
            return yield* new ProductUnavailable({
              productId: input.productId,
              message: "Product not found",
            });
          }
          const product = yield* Schema.decodeUnknownEffect(ProductRecord)(
            row,
          ).pipe(Effect.mapError(catalogFailure("storage")));
          const availableQuantity = yield* logistics
            .getAvailability(input)
            .pipe(Effect.mapError(catalogFailure("dependency")));
          const price = yield* pricing.getPrice(input).pipe(
            Effect.mapError((error) =>
              error._tag === "PriceUnavailable"
                ? new ProductUnavailable({
                    productId: input.productId,
                    message: error.message,
                    cause: error,
                  })
                : catalogFailure("dependency")(error),
            ),
          );
          return yield* Schema.decodeUnknownEffect(Product)({
            ...product,
            availableQuantity,
            price,
          }).pipe(Effect.mapError(catalogFailure("response")));
        }),
      };
    }),
  ).pipe(Layer.provide(ProductRepositoryLive));
