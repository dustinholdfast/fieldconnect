import { assignJourney, productKind } from './assignJourney.js';

const RESULTS = new Set([
  'Qualified', 'Follow-up required', 'Not a fit', 'Reschedule requested', 'Declined',
]);
const DELIVERED = new Set(['yes', 'no', 'partial']);

function productsOf(catalog) {
  const items = Array.isArray(catalog) ? catalog : (catalog?.items || []);
  return items.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    kind: p.kind,
    listPriceCents: p.listPriceCents ?? p.list_price_cents,
  }));
}

function durationOf(input) {
  const raw = input.durationMin != null && input.durationMin !== ''
    ? input.durationMin
    : input.duration;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function pathwayOf(input) {
  return String(input.pathwayLabel || input.pathway || '').trim();
}

function ruinOf(input) {
  return String(input.ruinCategory || input.ruinCat || '').trim();
}

function nextOf(input) {
  return String(input.nextAction || input.next || '').trim();
}

function dueOf(input) {
  return String(input.nextDue || input.due || '').trim();
}

function findProduct(item, products) {
  return products.find((p) => p.id === item.productId || (item.sku && p.sku === item.sku)) || null;
}

function listPriceOf(item, product) {
  const listed = item.listPriceCents ?? item.list_price_cents ?? product?.listPriceCents;
  return listed == null ? null : Number(listed);
}

function unitPriceOf(item, product) {
  const raw = item.unitPriceCents ?? item.unit_price_cents;
  if (raw == null || raw === '') return listPriceOf(item, product);
  return Number(raw);
}

function revenueCentsOf(items, products) {
  return (items || []).reduce((sum, item) => {
    const qty = Number(item.qty) || 0;
    if (qty <= 0) return sum;
    const product = findProduct(item, products);
    const unit = unitPriceOf(item, product);
    return sum + qty * (Number.isFinite(unit) ? unit : 0);
  }, 0);
}

function personStageOf(input) {
  if (input.delivered === 'no') return 'No-show';
  if (input.delivered === 'partial') return null;
  if (input.delivered === 'yes' && input.result === 'Not a fit') return 'Not a fit';
  if (input.delivered === 'yes') return 'Completed';
  return null;
}

function derivedStatusOf(input) {
  if (input.delivered === 'no') return 'No-show';
  if (input.delivered === 'partial') return 'Partial';
  return 'Completed';
}

export function validateOutcome(input = {}, catalog = [], pathwayItems) {
  const errors = {};
  const products = productsOf(catalog);
  const delivered = input.delivered;
  if (!DELIVERED.has(delivered)) {
    errors.delivered = 'Interview delivered is required';
  }

  const appointmentId = input.appointmentId;
  if (appointmentId == null || appointmentId === '' || !Number.isFinite(Number(appointmentId))) {
    errors.appointmentId = 'Appointment is required';
  }

  const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
  if (!clientId) errors.clientId = 'Client id is required';

  const duration = durationOf(input);
  const partialReason = String(input.partialReason || '').trim();
  const result = String(input.result || '').trim();
  const pathway = pathwayOf(input);
  const ruinCat = ruinOf(input);
  const items = Array.isArray(input.lineItems) ? input.lineItems : [];

  if (delivered === 'partial') {
    if (duration == null || !Number.isInteger(duration) || duration < 1 || duration > 180) {
      errors.duration = 'Duration must be 1–180 minutes';
    }
    if (!partialReason) errors.partialReason = 'Reason the interview was partial is required';
  }

  if (delivered === 'yes') {
    if (duration == null || !Number.isInteger(duration) || duration < 1 || duration > 180) {
      errors.duration = 'Duration is required';
    }
    if (!result) errors.result = 'Appointment result is required';
    else if (!RESULTS.has(result)) errors.result = 'Unknown appointment result';
  }

  if (delivered === 'yes' && result === 'Not a fit') {
    if (items.some((item) => (Number(item.qty) || 0) > 0)) {
      errors.lineItems = 'Not a fit cannot include product sales';
    }
  }

  if (delivered === 'yes' && result !== 'Not a fit') {
    items.forEach((item, i) => {
      const qty = Number(item.qty) || 0;
      if (qty < 0 || (item.qty != null && item.qty !== '' && !Number.isInteger(Number(item.qty)))) {
        errors[`lineItems.${i}.qty`] = 'Quantity must be a whole number';
        return;
      }
      if (qty <= 0) return;
      const product = findProduct(item, products);
      if (!product) {
        errors[`lineItems.${i}.productId`] = 'Unknown catalog product';
        return;
      }
      const list = listPriceOf(item, product);
      const unit = unitPriceOf(item, product);
      if (!Number.isInteger(unit) || unit < 0) {
        errors[`lineItems.${i}.unitPriceCents`] = 'Unit price is invalid';
        return;
      }
      if (list != null && unit !== list) {
        const reason = String(item.overrideReason || '').trim();
        if (reason.length < 8) {
          errors.overrideReason = 'Override reason must be at least 8 characters';
          errors[`lineItems.${i}.overrideReason`] = 'Override reason must be at least 8 characters';
        }
      }
    });
  }

  if (pathway && pathwayItems) {
    const allowed = pathwayItems.filter((p) => (p.ruinCategory || p.ruin_category) === ruinCat);
    if (!allowed.some((p) => p.label === pathway)) {
      errors.pathway = 'Pathway must be an approved option for this Ruin';
    }
  }

  const journeyInput = {
    delivered,
    result,
    lineItems: items.map((item) => ({
      ...item,
      kind: productKind(item, products) || item.kind,
    })),
  };
  const journey = assignJourney(journeyInput, products);
  const revenueCents = delivered === 'yes' && result !== 'Not a fit'
    ? revenueCentsOf(items, products)
    : 0;
  const next = nextOf(input);
  const due = dueOf(input);

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    derived: {
      status: derivedStatusOf(input),
      pathway: pathway || (ruinCat ? 'not selected' : '—'),
      revenue: '$' + (revenueCents / 100).toFixed(0),
      revenueCents,
      journey: journey.name,
      journeyKey: journey.key,
      followup: next ? next + (due ? ' · ' + due : '') : 'none set',
      personStage: personStageOf(input),
    },
  };
}
