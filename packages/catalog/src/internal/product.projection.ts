import type { ProductEvent, ProductRecord } from "./product.aggregate.js";

// Replayable: no network calls or commands in a projection.
export const projectProduct = (
  products: ReadonlyArray<ProductRecord>,
  event: ProductEvent,
): ReadonlyArray<ProductRecord> =>
  products.map((product) =>
    product.id === event.productId ? { ...product, name: event.name } : product,
  );
