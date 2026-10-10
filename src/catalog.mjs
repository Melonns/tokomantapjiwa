export function matchesCatalog(product, query) {
  const text = query.trim().toLocaleLowerCase('id-ID')
  return !text || `${product.game} ${product.name}`.toLocaleLowerCase('id-ID').includes(text)
}
