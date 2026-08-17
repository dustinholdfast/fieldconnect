const LABELS = {
  j2: 'No-show recovery',
  j3: 'Completed, no book',
  j4: 'Book buyer',
  j5: 'DN Seminar buyer',
  j6: 'Interested but unqualified',
};

function productKind(item, catalog = []) {
  if (item?.kind) return item.kind;
  const hit = catalog.find((p) => p.id === item?.productId || p.sku === item?.sku);
  if (hit?.kind) return hit.kind;
  const sku = String(item?.sku || hit?.sku || '');
  const name = String(item?.name || hit?.name || '');
  if (sku === 'dn-seminar' || /seminar/i.test(sku) || /seminar/i.test(name)) return 'seminar';
  if (sku === 'dn-book' || /book/i.test(sku) || /book/i.test(name)) return 'book';
  return '';
}

function qtyOfKind(items, catalog, kind) {
  return (items || []).reduce((sum, item) => {
    if (productKind(item, catalog) !== kind) return sum;
    const qty = Number(item.qty) || 0;
    return sum + (qty > 0 ? qty : 0);
  }, 0);
}

export function assignJourney(input = {}, catalog = []) {
  if (input.delivered === 'no') {
    return { key: 'j2', name: LABELS.j2 };
  }
  const items = input.lineItems || [];
  if (qtyOfKind(items, catalog, 'seminar') > 0) {
    return { key: 'j5', name: LABELS.j5 };
  }
  if (qtyOfKind(items, catalog, 'book') > 0) {
    return { key: 'j4', name: LABELS.j4 };
  }
  if (input.result === 'Not a fit') {
    return { key: 'j6', name: LABELS.j6 };
  }
  return { key: 'j3', name: LABELS.j3 };
}

export { LABELS as JOURNEY_LABELS, productKind };
