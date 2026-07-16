/**
 * Семантические имена тегов и типов из справочников (сид-миграция).
 * Это единственное место, где имена встречаются в коде: логика везде
 * работает через конфигурацию, не через имена методов.
 */
export const TAG_SYSTEM = 'system';
export const TAG_DEFAULT = 'default';
export const TAG_USER = 'user';
export const TAG_UNAUTHED = 'unauthed';

/** Режимные теги взаимоисключающие: не больше одного на метод. */
export const MODE_TAGS: readonly string[] = [TAG_SYSTEM, TAG_DEFAULT, TAG_USER];

/** Тип, верифицируемый по хранимому секрету (TOTP): кред обязан иметь secret. */
export const TOTP_TYPE = 'ga';
