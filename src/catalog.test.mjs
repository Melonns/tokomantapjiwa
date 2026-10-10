import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesCatalog } from './catalog.mjs'

test('search matches active game or product name without inventing results', () => {
  const products = [
    { id: 'ml86', game: 'Mobile Legends', name: '86 Diamonds' },
    { id: 'ff70', game: 'Free Fire', name: '70 Diamonds' },
  ]
  assert.deepEqual(products.filter((item) => matchesCatalog(item, '  mobile ')).map((item) => item.id), ['ml86'])
  assert.deepEqual(products.filter((item) => matchesCatalog(item, '70')).map((item) => item.id), ['ff70'])
  assert.deepEqual(products.filter((item) => matchesCatalog(item, 'tidak ada')), [])
  assert.deepEqual(products.filter((item) => matchesCatalog(item, '')), products)
})
