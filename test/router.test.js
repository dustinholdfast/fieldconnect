import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fallbackPath,
  maybeHashRedirect,
  parsePath,
  pathFromHash,
  primaryRecordId,
} from '../js/router.js';

const CASES = [
  ['/login', { screen: 'login', params: {} }],
  ['/dashboard', { screen: 'dashboard', params: {} }],
  ['/crm', { screen: 'crm', params: {} }],
  ['/crm/3', { screen: 'crm', params: { personId: '3' } }],
  ['/scheduling', { screen: 'scheduling', params: {} }],
  ['/scheduling/12', { screen: 'scheduling', params: { appointmentId: '12' } }],
  ['/outcome', { screen: 'outcome', params: {} }],
  ['/outcome/12', { screen: 'outcome', params: { appointmentId: '12' } }],
  ['/nurture', { screen: 'nurture', params: {} }],
  ['/nurture/j3', { screen: 'nurture', params: { journeyId: 'j3' } }],
  ['/lists', { screen: 'lists', params: {} }],
  ['/lists/2', { screen: 'lists', params: { importId: '2' } }],
  ['/training', { screen: 'training', params: {} }],
  ['/training/FSM-0', { screen: 'training', params: { courseId: 'FSM-0' } }],
  ['/recruitment', { screen: 'recruitment', params: {} }],
  ['/stories', { screen: 'stories', params: {} }],
  ['/admin', { screen: 'admin', params: {} }],
  ['/forbidden', { screen: 'forbidden', params: {} }],
  ['/r/dn-45', { screen: 'public', params: { slug: 'dn-45' } }],
];

for (const [path, expected] of CASES) {
  test('parsePath ' + path, () => {
    const route = parsePath(path);
    assert.equal(route.known, true);
    assert.equal(route.screen, expected.screen);
    assert.deepEqual(route.params, expected.params);
    assert.equal(route.path, path);
  });
}

test('parsePath keeps query string separately', () => {
  const route = parsePath('/crm/3', '?filter=followup_overdue');
  assert.equal(route.screen, 'crm');
  assert.equal(route.params.personId, '3');
  assert.equal(route.query.filter, 'followup_overdue');
});

test('parsePath accepts path that includes ?query', () => {
  const route = parsePath('/scheduling?offer=abc');
  assert.equal(route.screen, 'scheduling');
  assert.equal(route.query.offer, 'abc');
});

test('hash #/crm/3 maps to /crm/3', () => {
  assert.equal(pathFromHash('#/crm/3'), '/crm/3');
  const route = parsePath(pathFromHash('#/crm/3'));
  assert.equal(route.known, true);
  assert.equal(route.screen, 'crm');
  assert.equal(route.params.personId, '3');
});

test('hash redirect replaceState writes /crm/3', () => {
  const loc = { hash: '#/crm/3', pathname: '/', search: '' };
  let written = null;
  const hist = { replaceState(_s, _t, url) { written = url; loc.hash = ''; loc.pathname = url; } };
  assert.equal(maybeHashRedirect(loc, hist), '/crm/3');
  assert.equal(written, '/crm/3');
});

test('unknown path is not a known screen', () => {
  const route = parsePath('/nope');
  assert.equal(route.known, false);
  assert.equal(route.screen, null);
  assert.equal(route.path, '/nope');
  const extra = parsePath('/crm/3/extra');
  assert.equal(extra.known, false);
  assert.equal(parsePath('/').known, false);
});

test('unknown path falls back to dashboard when allowed else forbidden', () => {
  assert.equal(fallbackPath('fsm', ['dashboard', 'crm']), '/dashboard');
  assert.equal(fallbackPath('admin', ['dashboard', 'admin']), '/dashboard');
  assert.equal(fallbackPath('guest', []), '/forbidden');
});

test('primaryRecordId reads the screen param', () => {
  assert.equal(primaryRecordId(parsePath('/crm/9')), '9');
  assert.equal(primaryRecordId(parsePath('/outcome/4')), '4');
  assert.equal(primaryRecordId(parsePath('/dashboard')), null);
});
