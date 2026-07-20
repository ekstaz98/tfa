import { UserMethodPolicyService } from '../../src/methods/services';
import { fakeConfig } from '../testing/fakes';

describe('UserMethodPolicyService', () => {
  it('читает оба значения из config по своим путям', () => {
    const service = new UserMethodPolicyService(
      fakeConfig({
        'methods.userDefaultActive': false,
        'methods.defaultMethodsActive': false,
      }),
    );

    expect(service.userMethodsActive).toBe(false);
    expect(service.defaultMethodsActive).toBe(false);
  });

  it('значения независимы друг от друга', () => {
    const service = new UserMethodPolicyService(
      fakeConfig({
        'methods.userDefaultActive': true,
        'methods.defaultMethodsActive': false,
      }),
    );

    expect(service.userMethodsActive).toBe(true);
    expect(service.defaultMethodsActive).toBe(false);
  });

  it('без methods.userDefaultActive в конфиге — падает при создании', () => {
    expect(
      () =>
        new UserMethodPolicyService(
          fakeConfig({ 'methods.defaultMethodsActive': true }),
        ),
    ).toThrow();
  });

  it('без methods.defaultMethodsActive в конфиге — падает при создании', () => {
    expect(
      () =>
        new UserMethodPolicyService(
          fakeConfig({ 'methods.userDefaultActive': true }),
        ),
    ).toThrow();
  });
});
