import { assert } from 'chai';

describe('negative proof (a)', () => {
  it('deliberately failing assertion', () => {
    assert.strictEqual(1 + 1, 3, 'intentional failure: pilot negative proof');
  });
});
