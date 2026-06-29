import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses } from './helpers/load-app.js';

// Regression: vCard parameter values (X-SERVICE-TYPE, social TYPE/X-USER, …)
// must be quoted when they contain structural characters, or a crafted value
// breaks the card (param injection). See VCardUtils.encodeParamValue.

test('encodeParamValue quotes values with structural characters', () => {
  const { VCardUtils } = loadBrowserClasses();
  assert.equal(VCardUtils.encodeParamValue('Skype'), 'Skype');
  assert.equal(VCardUtils.encodeParamValue('a;b'), '"a;b"');
  assert.equal(VCardUtils.encodeParamValue('a:b'), '"a:b"');
  assert.equal(VCardUtils.encodeParamValue('a,b'), '"a,b"');
  assert.equal(VCardUtils.encodeParamValue('with space'), '"with space"');
  // DQUOTE and CR/LF cannot appear inside a quoted param value — strip them.
  // (They are removed before the quote check, so 'ab' needs no quoting.)
  assert.equal(VCardUtils.encodeParamValue('quo"te'), 'quote');
  assert.equal(VCardUtils.encodeParamValue('a\r\nb'), 'ab');
});

test('vCard fallback serializer escapes IM/social param values', () => {
  const { VCardAdapter } = loadBrowserClasses();
  const adapter = new VCardAdapter();
  // No rawVCard → fallback serializer path; service carries a special char.
  const contact = {
    id: 'c1',
    fn: 'Param Test',
    ims: [{ value: 'aim:handle', service: 'Weird;Service', types: [] }],
    socialProfiles: [{ url: 'x-apple:handle', service: 'Yelp:Pro', username: 'u;v' }],
  };
  const out = adapter.serialize([contact]);
  assert.match(out, /X-SERVICE-TYPE="Weird;Service"/);
  assert.match(out, /TYPE="Yelp:Pro"/);
  assert.match(out, /X-USER="u;v"/);

  // And it reparses with the values intact (no structural corruption).
  const [reparsed] = adapter.parse(out);
  assert.equal(reparsed.ims[0].service, 'Weird;Service');
  assert.equal(reparsed.socialProfiles[0].service, 'Yelp:Pro');
  assert.equal(reparsed.socialProfiles[0].username, 'u;v');
});
