import { DataSource, EntityManager, FindOperator } from 'typeorm';

interface HasId {
  id: string;
}

function matches(row: Record<string, unknown>, criteria: object): boolean {
  return Object.entries(criteria).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      if (expected.type === 'in') {
        return (expected.value as unknown[]).includes(row[key]);
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
  private seq = 0;

  constructor(private readonly defaults: Partial<T> = {}) {}

  seed(data: Partial<T>): T {
    const row = {
      id: `id-${++this.seq}`,
      ...this.defaults,
      ...data,
    } as T;
    this.rows.push(row);
    return row;
  }

  create = jest.fn((data: Partial<T>): Promise<T> => {
    return Promise.resolve(this.seed(data));
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

  softDelete = jest.fn((id: string): Promise<void> => {
    return this.update(id, { isDeleted: true } as unknown as Partial<T>);
  });

  delete = jest.fn((id: string): Promise<void> => {
    this.rows = this.rows.filter((row) => row.id !== id);
    return Promise.resolve();
  });
}

/** DataSource-фейк: транзакция просто выполняет колбэк. */
export function fakeDataSource(): DataSource {
  return {
    transaction: async <R>(fn: (manager: EntityManager) => Promise<R>) =>
      fn({} as EntityManager),
  } as unknown as DataSource;
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
