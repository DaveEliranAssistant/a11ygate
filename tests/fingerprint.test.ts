import { describe, expect, it } from 'vitest';
import { fingerprint, normaliseSelector, pagePath } from '@/lib/fingerprint';

describe('selector normalisation', () => {
  it('strips nth-child indexes', () => {
    expect(normaliseSelector('div:nth-child(2) > button:nth-child(1)')).toBe('div > button');
  });

  it('strips nth-of-type and nth-last-child indexes', () => {
    expect(normaliseSelector('ul > li:nth-of-type(3) > a:nth-last-child(2)')).toBe('ul > li > a');
    expect(normaliseSelector('li:nth-child(2n+1)')).toBe('li');
  });

  it('strips ember-style dynamic ids', () => {
    expect(normaliseSelector('#ember1842 > button.add-to-cart')).toBe('button.add-to-cart');
  });

  it('strips React useId selectors, including CSS escapes', () => {
    expect(normaliseSelector('#:r1: > input')).toBe('input');
    expect(normaliseSelector('#\\:r1\\: > input')).toBe('input');
    expect(normaliseSelector('[id=":r1:"] > input')).toBe('input');
  });

  it('strips hex hash ids and CSS-module or emotion class hashes', () => {
    expect(normaliseSelector('#btn-a1b2c3d4e5 > span')).toBe('span');
    expect(normaliseSelector('.Button_submit__a1b2c3d')).toBe('.Button_submit');
    expect(normaliseSelector('button.css-1a2b3c')).toBe('button');
  });

  it('preserves stable ids and classes', () => {
    expect(normaliseSelector('#main > .card.price-tag')).toBe('#main > .card.price-tag');
    expect(normaliseSelector('[role="slider"]')).toBe('[role="slider"]');
  });
});

describe('page path and fingerprint', () => {
  it('uses the URL path and ignores query, hash, and a trailing slash', () => {
    expect(pagePath('https://demo.shop/products?page=2#reviews')).toBe('/products');
    expect(pagePath('https://demo.shop/cart/')).toBe('/cart');
    expect(pagePath('https://demo.shop/')).toBe('/');
    expect(pagePath('/cart?x=1')).toBe('/cart');
  });

  it('keeps the same fingerprint when only dynamic parts change', () => {
    const baseline = fingerprint(
      'image-alt',
      '#main:nth-child(2) > img.hero-photo:nth-child(1)',
      'https://demo.shop/',
    );
    const current = fingerprint(
      'image-alt',
      '#main:nth-child(5) > img.hero-photo:nth-child(2)',
      'https://demo.shop/?cache=1',
    );
    expect(baseline).toBe('image-alt|#main > img.hero-photo|/');
    expect(current).toBe(baseline);
  });

  it('changes the fingerprint when the rule, selector, or path changes', () => {
    const base = fingerprint('color-contrast', '.price-tag', 'https://demo.shop/products');
    expect(fingerprint('region', '.price-tag', 'https://demo.shop/products')).not.toBe(base);
    expect(fingerprint('color-contrast', '.legacy-banner', 'https://demo.shop/products')).not.toBe(base);
    expect(fingerprint('color-contrast', '.price-tag', 'https://demo.shop/cart')).not.toBe(base);
  });
});
