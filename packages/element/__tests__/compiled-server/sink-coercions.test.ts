import { describe, expect, test } from 'vitest';
import {
  attributeValueOf,
  classValueOf,
  styleValueOf,
} from '../../src/internal/compiled/runtime/values.ts';

describe('classValueOf', () => {
  test('empty shapes collapse to an empty attribute', () => {
    expect(classValueOf(null)).toBe('');
    expect(classValueOf(undefined)).toBe('');
    expect(classValueOf(false)).toBe('');
  });

  test('strings and numbers pass through', () => {
    expect(classValueOf('a b')).toBe('a b');
    expect(classValueOf(0)).toBe('0');
  });

  test('arrays flatten in order, records sort and drop falsy entries', () => {
    expect(classValueOf(['a', null, 'b', ['c']])).toBe('a b c');
    expect(classValueOf({ b: true, a: 1, c: false, d: null })).toBe('a b');
    expect(classValueOf({})).toBe('');
  });

  test('a value that is neither fails closed', () => {
    expect(() => classValueOf(Symbol('nope'))).toThrow(/class Part expects/);
  });
});

describe('styleValueOf', () => {
  test('empty shapes collapse to an empty attribute', () => {
    expect(styleValueOf(null)).toBe('');
    expect(styleValueOf(undefined)).toBe('');
    expect(styleValueOf(false)).toBe('');
  });

  test('CSS text and numbers pass through; arrays join with semicolons', () => {
    expect(styleValueOf('color: red')).toBe('color: red');
    expect(styleValueOf(2)).toBe('2');
    expect(styleValueOf(['color: red', '', 'top: 0'])).toBe('color: red;top: 0');
  });

  test('a declaration record sorts, drops empty entries and kebab-cases names', () => {
    expect(
      styleValueOf({ backgroundColor: 'red', top: 0, left: null, opacity: false, zIndex: 2 }),
    ).toBe('background-color:red;top:0;z-index:2');
  });

  test('custom properties keep their spelling and vendor prefixes are preserved', () => {
    // Declaration order is the SORTED SOURCE-KEY order (what the server, the
    // fresh-DOM builder and the recovery builder all read), so the emitted
    // string is stable for one record on every path.
    expect(styleValueOf({ '--brand': 'red', WebkitLineClamp: 2, msOverflowStyle: 'none' })).toBe(
      '--brand:red;-webkit-line-clamp:2;-ms-overflow-style:none',
    );
  });

  test('a value that is neither fails closed', () => {
    expect(() => styleValueOf(Symbol('nope'))).toThrow(/style Part expects/);
  });
});

describe('attributeValueOf', () => {
  test('a null or undefined attribute value removes the attribute', () => {
    expect(attributeValueOf(null)).toBeNull();
    expect(attributeValueOf(undefined)).toBeNull();
    expect(attributeValueOf(0)).toBe('0');
    expect(attributeValueOf(false)).toBe('false');
  });
});
