import { Schema } from "effect";

export const ProductRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});
export type ProductRecord = typeof ProductRecord.Type;

export const ProductEvent = Schema.TaggedStruct("ProductRenamed", {
  cursor: Schema.Natural,
  productId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});
export type ProductEvent = typeof ProductEvent.Type;

export class ProductRenameRejected extends Schema.TaggedError<ProductRenameRejected>()(
  "ProductRenameRejected",
  {
    operation: Schema.Literal("RenameProduct.execute"),
    productId: Schema.NonEmptyString,
    message: Schema.NonEmptyString,
  },
) {}

// A decision emits an event; it neither mutates the read model nor calls a service.
export const decideRename = (
  product: ProductRecord | undefined,
  productId: string,
  name: string,
  cursor: number,
): ProductEvent | ProductRenameRejected =>
  !product || name.trim().length === 0
    ? new ProductRenameRejected({
        operation: "RenameProduct.execute",
        productId,
        message: product ? "Product name cannot be blank" : "Product not found",
      })
    : { _tag: "ProductRenamed", cursor, productId, name: name.trim() };
