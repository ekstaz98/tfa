import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, FindOperator } from 'typeorm';
import { OperationStatus } from '../../src/database/entities';
import { DictionaryCacheService } from '../../src/database/services';
import { UserMethodPolicyService } from '../../src/methods/services';

interface HasId {
  id: string;
}

function matches(row: Record<string, unknown>, criteria: object): boolean {
  return Object.entries(criteria).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      if (expected.type === 'in') {
        return (expected.value as unknown[]).includes(row[key]);
      }
      if (expected.type === 'moreThanOrEqual') {
        return (row[key] as Date | number) >= (expected.value as Date | number);
      }
      throw new Error(`FakeCrud: unsupported operator "${expected.type}"`);
    }
    return row[key] === expected;
  });
}

/**
 * In-memory реализация контракта CRUD-сервисов для юнит-тестов доменных
 * сервисов: та же сигнатура, EntityManager игнорируется.
 */
export class FakeCrud<T extends HasId> {
  rows: T[] = [];
  private _seq = 0;

  constructor(private readonly _defaults: Partial<T> = {}) {}

  seed(data: Partial<T>): T {
    const row = {
      id: `id-${++this._seq}`,
      ...this._defaults,
      ...data,
    } as T;
    this.rows.push(row);
    return row;
  }

  create = jest.fn((data: Partial<T>): Promise<T> => {
    return Promise.resolve(this.seed(data));
  });

  createMany = jest.fn((data: Array<Partial<T>>): Promise<T[]> => {
    return Promise.resolve(data.map((row) => this.seed(row)));
  });

  findById = jest.fn((id: string): Promise<T | null> => {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  });

  findBy = jest.fn((criteria: object): Promise<T[]> => {
    return Promise.resolve(
      this.rows.filter((row) =>
        matches(row as Record<string, unknown>, criteria),
      ),
    );
  });

  update = jest.fn((id: string, data: Partial<T>): Promise<void> => {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row) {
      Object.assign(row, data);
    }
    return Promise.resolve();
  });

  updateMany = jest.fn(async (ids: string[], data: Partial<T>) => {
    for (const id of ids) {
      await this.update(id, data);
    }
  });

  softDelete = jest.fn((id: string): Promise<void> => {
    return this.update(id, { isDeleted: true } as unknown as Partial<T>);
  });

  delete = jest.fn((id: string): Promise<void> => {
    this.rows = this.rows.filter((row) => row.id !== id);
    return Promise.resolve();
  });

  deleteMany = jest.fn((ids: string[]): Promise<void> => {
    this.rows = this.rows.filter((row) => !ids.includes(row.id));
    return Promise.resolve();
  });
}

interface HasStatus extends HasId {
  status: OperationStatus;
}

/** Фейк OperationsCrudService с примитивами конкурентности. */
export class FakeOperationsCrud<
  T extends HasStatus = HasStatus,
> extends FakeCrud<T> {
  countBy = jest.fn(async (criteria: object): Promise<number> => {
    return (await this.findBy(criteria)).length;
  });

  findByIdForUpdate = jest.fn((id: string): Promise<T | null> => {
    return this.findById(id);
  });

  updateStatusIf = jest.fn(
    (id: string, from: OperationStatus, to: OperationStatus) => {
      const row = this.rows.find((candidate) => candidate.id === id);
      if (!row || row.status !== from) {
        return Promise.resolve(false);
      }
      row.status = to;
      return Promise.resolve(true);
    },
  );

  deleteFinishedBefore = jest.fn((cutoff: Date): Promise<number> => {
    void cutoff;
    return Promise.resolve(0);
  });
}

interface HasAttempts extends HasId {
  attempts: number;
}

/** Фейк CodesCrudService с атомарным инкрементом попыток. */
export class FakeCodesCrud<
  T extends HasAttempts = HasAttempts,
> extends FakeCrud<T> {
  markVerified = jest.fn(
    (operationId: string, verifiedAt: Date): Promise<void> => {
      for (const row of this.rows) {
        if ((row as Record<string, unknown>).operationId === operationId) {
          (row as Record<string, unknown>).verifiedAt = verifiedAt;
        }
      }
      return Promise.resolve();
    },
  );

  incrementAttempts = jest.fn((id: string): Promise<number> => {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) {
      throw new Error(`FakeCodesCrud: no row ${id}`);
    }
    row.attempts += 1;
    return Promise.resolve(row.attempts);
  });
}

export interface FakeDataSource extends DataSource {
  /** true, пока выполняется колбэк transaction — для проверки «публикация после коммита». */
  inTransaction: boolean;
  managerMock: { query: jest.Mock };
}

/** DataSource-фейк: транзакция выполняет колбэк с manager.query-моком. */
export function fakeDataSource(): FakeDataSource {
  const managerMock = { query: jest.fn().mockResolvedValue([]) };
  const ds = {
    inTransaction: false,
    managerMock,
    transaction: async <R>(fn: (manager: EntityManager) => Promise<R>) => {
      ds.inTransaction = true;
      try {
        return await fn(managerMock as unknown as EntityManager);
      } finally {
        ds.inTransaction = false;
      }
    },
  };
  return ds as unknown as FakeDataSource;
}

/** ConfigService-фейк: значения по пути из плоской карты. */
export function fakeConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: (path: string) => values[path],
    getOrThrow: (path: string) => {
      if (!(path in values)) {
        throw new Error(`fakeConfig: missing "${path}"`);
      }
      return values[path];
    },
  } as unknown as ConfigService;
}

/**
 * UserMethodPolicyService поверх fakeConfig. Оба параметра по умолчанию true
 * — тот же opt-out/включённый-по-умолчанию режим, что и в проде без
 * USER_METHODS_ACTIVE / DEFAULT_METHODS_ACTIVE.
 *   userMethodsActive — false для тестов «юзер сам включает user-метод» (opt-in).
 *   defaultMethodsActive — false для тестов «новый юзер стартует
 *   с выключенным общим переключателем default-методов».
 */
export function fakeUserMethodPolicy(
  userMethodsActive = true,
  defaultMethodsActive = true,
): UserMethodPolicyService {
  return new UserMethodPolicyService(
    fakeConfig({
      'methods.userDefaultActive': userMethodsActive,
      'methods.defaultMethodsActive': defaultMethodsActive,
    }),
  );
}

/**
 * Реальный кэш справочников поверх фейковых CRUD с TTL 0 —
 * юниты всегда видят актуальные строки фейков.
 */
export function fakeDictionaryCache(
  typesCrud: FakeCrud<{
    id: string;
    type: string;
    isActive: boolean;
    isDeleted: boolean;
  }>,
  tagsCrud: FakeCrud<{ id: string; name: string; isActive: boolean }>,
): DictionaryCacheService {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return new DictionaryCacheService(
    fakeConfig({ 'dictionaries.cacheTtlSeconds': 0 }),
    typesCrud as any,
    tagsCrud as any,
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Справочники из сид-миграции. */
export function seedDictionaries(
  tagsCrud: FakeCrud<{ id: string; name: string; isActive: boolean }>,
  typesCrud: FakeCrud<{
    id: string;
    type: string;
    isActive: boolean;
    isDeleted: boolean;
  }>,
): void {
  for (const name of ['unauthed', 'user', 'system', 'default']) {
    tagsCrud.seed({ id: `tag-${name}`, name, isActive: true });
  }
  for (const type of ['sms', 'email', 'push', 'ga']) {
    typesCrud.seed({
      id: `type-${type}`,
      type,
      isActive: true,
      isDeleted: false,
    });
  }
}
