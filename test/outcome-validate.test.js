import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignJourney } from '../shared/outcome/assignJourney.js';
import { validateOutcome } from '../shared/outcome/validate.js';

const catalog = [
  { id: 1, sku: 'dn-book', name: 'Dianetics book', kind: 'book', listPriceCents: 2500 },
  { id: 2, sku: 'dn-seminar', name: 'DN Seminar', kind: 'seminar', listPriceCents: 5000 },
];

const pathways = [
  { ruinCategory: 'Stress & anxiety', label: 'Dianetics book', detail: 'self-study start' },
  { ruinCategory: 'Stress & anxiety', label: 'Dianetics Seminar', detail: 'next: 6 Sep' },
];

function base(over = {}) {
  return {
    appointmentId: 12,
    clientId: '11111111-1111-4111-8111-111111111111',
    delivered: 'yes',
    duration: 46,
    result: 'Qualified',
    channel: 'Email',
    lineItems: [],
    ...over,
  };
}

test('delivered=no: no duration or pathway required; journey j2', () => {
  const out = validateOutcome(base({
    delivered: 'no',
    duration: '',
    result: '',
    ruinCat: '',
    pathway: '',
  }), catalog, pathways);
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.derived.status, 'No-show');
  assert.equal(out.derived.journeyKey, 'j2');
  assert.equal(out.derived.personStage, 'No-show');
  assert.equal(out.errors.duration, undefined);
  assert.equal(out.errors.pathway, undefined);
});

test('delivered=partial: duration 1–180 and partialReason required', () => {
  const missing = validateOutcome(base({
    delivered: 'partial',
    duration: '',
    partialReason: '',
    result: '',
  }), catalog, pathways);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.duration);
  assert.ok(missing.errors.partialReason);

  const tooLong = validateOutcome(base({
    delivered: 'partial',
    duration: 181,
    partialReason: 'ran out of time',
    result: '',
  }), catalog, pathways);
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.errors.duration);

  const zero = validateOutcome(base({
    delivered: 'partial',
    duration: 0,
    partialReason: 'ran out of time',
  }), catalog, pathways);
  assert.equal(zero.ok, false);

  const ok = validateOutcome(base({
    delivered: 'partial',
    duration: 20,
    partialReason: 'attendee had to leave',
    result: '',
  }), catalog, pathways);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.derived.status, 'Partial');
  assert.equal(ok.derived.personStage, null);
});

test('delivered=yes: duration and result required', () => {
  const missing = validateOutcome(base({
    delivered: 'yes',
    duration: '',
    result: '',
  }), catalog, pathways);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.duration);
  assert.ok(missing.errors.result);

  const ok = validateOutcome(base({
    delivered: 'yes',
    durationMin: 46,
    result: 'Qualified',
  }), catalog, pathways);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.derived.status, 'Completed');
  assert.equal(ok.derived.personStage, 'Completed');
  assert.equal(ok.derived.journeyKey, 'j3');
});

test('result=Not a fit: no qty>0; journey j6; personStage Not a fit', () => {
  const sold = validateOutcome(base({
    result: 'Not a fit',
    lineItems: [{ productId: 1, qty: 1, unitPriceCents: 2500 }],
  }), catalog, pathways);
  assert.equal(sold.ok, false);
  assert.ok(sold.errors.lineItems);

  const ok = validateOutcome(base({
    result: 'Not a fit',
    lineItems: [{ productId: 1, qty: 0, unitPriceCents: 2500 }],
  }), catalog, pathways);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.derived.journeyKey, 'j6');
  assert.equal(ok.derived.personStage, 'Not a fit');
  assert.equal(ok.derived.revenueCents, 0);
});

test('product override requires reason ≥ 8 characters', () => {
  const short = validateOutcome(base({
    lineItems: [{
      productId: 1, qty: 1, listPriceCents: 2500, unitPriceCents: 2000, overrideReason: 'short',
    }],
  }), catalog, pathways);
  assert.equal(short.ok, false);
  assert.ok(short.errors.overrideReason);

  const ok = validateOutcome(base({
    lineItems: [{
      productId: 1, qty: 1, listPriceCents: 2500, unitPriceCents: 2000, overrideReason: 'host approved',
    }],
  }), catalog, pathways);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.derived.revenueCents, 2000);
});

test('pathway cannot be a free-typed string outside the approved set', () => {
  const bad = validateOutcome(base({
    ruinCat: 'Stress & anxiety',
    pathway: 'Unapproved course',
  }), catalog, pathways);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.pathway);

  const ok = validateOutcome(base({
    ruinCat: 'Stress & anxiety',
    pathway: 'Dianetics book',
  }), catalog, pathways);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.derived.pathway, 'Dianetics book');
});

test('assignJourney: no → j2; seminar → j5; book → j4; not a fit → j6; else → j3', () => {
  assert.equal(assignJourney({ delivered: 'no' }).key, 'j2');
  assert.equal(assignJourney({
    delivered: 'yes',
    lineItems: [{ sku: 'dn-seminar', qty: 1, kind: 'seminar' }],
  }, catalog).key, 'j5');
  assert.equal(assignJourney({
    delivered: 'yes',
    lineItems: [{ sku: 'dn-book', qty: 1, kind: 'book' }],
  }, catalog).key, 'j4');
  assert.equal(assignJourney({ delivered: 'yes', result: 'Not a fit' }).key, 'j6');
  assert.equal(assignJourney({ delivered: 'yes', result: 'Qualified' }).key, 'j3');
});

test('seminar qty wins over book qty', () => {
  const out = validateOutcome(base({
    lineItems: [
      { productId: 1, qty: 1, unitPriceCents: 2500 },
      { productId: 2, qty: 1, unitPriceCents: 5000 },
    ],
  }), catalog, pathways);
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.derived.journeyKey, 'j5');
  assert.equal(out.derived.revenueCents, 7500);
});
