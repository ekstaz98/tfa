import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TagsCrudService, TypesCrudService } from '../crud';
import { Type } from '../entities';

/**
 * Снимок справочников с готовыми индексами — потребители не строят
 * одни и те же Map на каждый запрос.
 */
export interface DictionarySnapshot {
  /** id -> имя типа, все типы (включая неактивные/удалённые). */
  typeNameById: Map<string, string>;
  activeTypes: Type[];
  activeTypeByName: Map<string, Type>;
  activeTypeIdByName: Map<string, string>;
  activeTypeNameById: Map<string, string>;
  /** id -> имя тега, все теги. */
  tagNameById: Map<string, string>;
  knownTagNames: Set<string>;
  activeTagIdByName: Map<string, string>;
  activeTagNameById: Map<string, string>;
}

const DEFAULT_TTL_SECONDS = 30;

/**
 * In-memory кэш справочников types/tags: меняются они только миграциями,
 * а читаются по несколько раз на каждый запрос API. TTL страхует от
 * устаревания после миграции без рестарта; invalidate() — ручной сброс.
 */
@Injectable()
export class DictionaryCacheService {
  private readonly _ttlMs: number;
  private _snapshot: DictionarySnapshot | null = null;
  private _loadedAt = 0;
  private _pending: Promise<DictionarySnapshot> | null = null;

  constructor(
    config: ConfigService,
    private readonly _typesCrud: TypesCrudService,
    private readonly _tagsCrud: TagsCrudService,
  ) {
    this._ttlMs =
      (config.get<number>('dictionaries.cacheTtlSeconds') ??
        DEFAULT_TTL_SECONDS) * 1000;
  }

  async get(): Promise<DictionarySnapshot> {
    if (this._snapshot && Date.now() - this._loadedAt < this._ttlMs) {
      return this._snapshot;
    }
    // конкурентные промахи ждут одну общую загрузку
    this._pending ??= this._load().finally(() => {
      this._pending = null;
    });
    return this._pending;
  }

  invalidate(): void {
    this._snapshot = null;
    this._loadedAt = 0;
  }

  private async _load(): Promise<DictionarySnapshot> {
    const [types, tags] = await Promise.all([
      this._typesCrud.findBy({}),
      this._tagsCrud.findBy({}),
    ]);
    const activeTypes = types.filter(
      (type) => type.isActive && !type.isDeleted,
    );
    const activeTags = tags.filter((tag) => tag.isActive);
    const snapshot: DictionarySnapshot = {
      typeNameById: new Map(types.map((type) => [type.id, type.type])),
      activeTypes,
      activeTypeByName: new Map(activeTypes.map((type) => [type.type, type])),
      activeTypeIdByName: new Map(
        activeTypes.map((type) => [type.type, type.id]),
      ),
      activeTypeNameById: new Map(
        activeTypes.map((type) => [type.id, type.type]),
      ),
      tagNameById: new Map(tags.map((tag) => [tag.id, tag.name])),
      knownTagNames: new Set(tags.map((tag) => tag.name)),
      activeTagIdByName: new Map(activeTags.map((tag) => [tag.name, tag.id])),
      activeTagNameById: new Map(activeTags.map((tag) => [tag.id, tag.name])),
    };
    this._snapshot = snapshot;
    this._loadedAt = Date.now();
    return snapshot;
  }
}
