import { describe, expect, it } from 'vitest';
import {
  isIssuedPageView,
  signPageView,
} from '../oauth/auth-complete-page-view';

const PAGE_VIEW_ID = '3f6a9a3e-2c1b-4d1e-9f5a-0b8c7d6e5f40';
const OTHER_PAGE_VIEW_ID = '9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('page view tokens', () => {
  it('accepts a token the server issued for that page view', () => {
    const token = signPageView(PAGE_VIEW_ID, NOW);
    expect(isIssuedPageView(PAGE_VIEW_ID, token, NOW + 5 * 60 * 1000)).toBe(
      true,
    );
  });

  it.each([
    ['another page view', OTHER_PAGE_VIEW_ID, signPageView(PAGE_VIEW_ID, NOW)],
    [
      'a changed issue time',
      PAGE_VIEW_ID,
      signPageView(PAGE_VIEW_ID, NOW).replace(String(NOW), String(NOW + 1)),
    ],
    ['a changed signature', PAGE_VIEW_ID, `${NOW}.${'A'.repeat(43)}`],
    [
      'an expired token',
      PAGE_VIEW_ID,
      signPageView(PAGE_VIEW_ID, NOW - 2 * HOUR),
    ],
    [
      'a token issued in the future',
      PAGE_VIEW_ID,
      signPageView(PAGE_VIEW_ID, NOW + HOUR),
    ],
    ['a malformed token', PAGE_VIEW_ID, 'not-a-token'],
    ['an empty token', PAGE_VIEW_ID, ''],
  ])('rejects %s', (_label, pageViewId, token) => {
    expect(isIssuedPageView(pageViewId, token, NOW)).toBe(false);
  });
});
