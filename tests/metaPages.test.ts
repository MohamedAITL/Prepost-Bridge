import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageNameFromHeading } from '../server/platforms/meta';

test('Page names from Business Suite asset menu headings', () => {
  assert.equal(pageNameFromHeading('Chouf Sport Officiel, choufsportofficiel', true), 'Chouf Sport Officiel');
  assert.equal(pageNameFromHeading('Chouf TV, chouftv_official', true), 'Chouf TV');
  assert.equal(pageNameFromHeading('Chouf TV شوف تيفي', false), 'Chouf TV شوف تيفي');
  assert.equal(pageNameFromHeading('Chouftv.ma', false), 'Chouftv.ma');
});

test('"Post to" check matches the exact Page, not a longer name', async () => {
  const { postToShowsPage } = await import('../server/platforms/meta');
  assert.equal(postToShowsPage('Chouf TV and chouftv_official', 'Chouf TV'), true);
  assert.equal(postToShowsPage('Post to Chouf TV and chouftv_official', 'Chouf TV'), true);
  assert.equal(postToShowsPage('Chouf TV Live', 'Chouf TV'), false);
  assert.equal(postToShowsPage('Chouf TV Live', 'Chouf TV Live'), true);
  assert.equal(postToShowsPage('Chouf Sport Officiel and choufsportofficiel', 'Chouf Sport'), false);
});

test('"Post to" check ignores the zero-width spaces Business Suite adds', async () => {
  const { postToShowsPage } = await import('../server/platforms/meta');
  assert.equal(postToShowsPage('​\nChouf TV Live\n​', 'Chouf TV Live'), true);
  assert.equal(postToShowsPage('​\nChouf TV and chouftv_official\n​', 'Chouf TV'), true);
  assert.equal(postToShowsPage('​\nChouf TV Live\n​', 'Chouf TV'), false);
});
