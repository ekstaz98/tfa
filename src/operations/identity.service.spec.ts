import {
  IdentityMaskerService,
  IdentityNormalizerService,
} from './identity.service';

describe('IdentityNormalizerService', () => {
  const service = new IdentityNormalizerService();

  it('email: trim + lowercase', () => {
    expect(service.normalize('  A@B.com ')).toBe('a@b.com');
  });

  it('phone: E.164 — только цифры с ведущим +', () => {
    expect(service.normalize('8 (912) 345-33-45')).toBe('+89123453345');
    expect(service.normalize('+7 912 345 3345')).toBe('+79123453345');
    expect(service.normalize('+79123453345')).toBe('+79123453345');
  });
});

describe('IdentityMaskerService (форматы из ТЗ)', () => {
  const service = new IdentityMaskerService();

  it('телефон: +7912...3345', () => {
    expect(service.mask('+79123453345')).toBe('+7912...3345');
  });

  it('email: gg...hm@gmail.com', () => {
    expect(service.mask('ggabchm@gmail.com')).toBe('gg...hm@gmail.com');
  });

  it.each([
    ['ab@x.io', 'a...@x.io'],
    ['abc@x.io', 'a...c@x.io'],
    ['abcd@x.io', 'a...d@x.io'],
    ['+123', '+...'],
    ['12345', '12...45'],
    ['', '...'],
  ])('краевой случай %s не падает', (input, expected) => {
    expect(service.mask(input)).toBe(expected);
  });
});
