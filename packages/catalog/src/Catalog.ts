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
  { productId: Schema.NonEmptyString, message: Schema.NonEmptyString },
) {}

export class Catalog extends Context.Service<
  Catalog,
  {
    readonly getProduct: (
      request: GetProductRequest,
    ) => Effect.Effect<Product, ProductUnavailable | Schema.SchemaError>;
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
        getProduct: (request) =>
          Effect.gen(function* () {
            const input =
              yield* Schema.decodeUnknownEffect(GetProductRequest)(request);
            const row = yield* products.find(input.productId);
            if (row === undefined) {
              return yield* new ProductUnavailable({
                productId: input.productId,
                message: "Product not found",
              });
            }
            const product =
              yield* Schema.decodeUnknownEffect(ProductRecord)(row);
            const availableQuantity = yield* logistics.getAvailability(input);
            const price = yield* pricing.getPrice(input).pipe(
              Effect.mapError((error) =>
                error._tag === "PriceUnavailable"
                  ? new ProductUnavailable({
                      productId: input.productId,
                      message: error.message,
                    })
                  : error,
              ),
            );
            return yield* Schema.decodeUnknownEffect(Product)({
              ...product,
              availableQuantity,
              price,
            });
          }),
      };
    }),
  ).pipe(Layer.provide(ProductRepositoryLive));
