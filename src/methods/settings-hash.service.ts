import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { MethodView } from './method-view';

/**
 * Детерминированный хэш эффективного списка для контракта 2faMethods(hash).
 * Перечень полей фиксирован явно: id, method, isActive, types, tags.
 * Волатильные поля (updatedAt и т.п.) не участвуют; методы и связи
 * сортируются — порядок выборки на хэш не влияет. Секрет не нужен:
 * хэш — валидация кэша фронта, не защита целостности.
 */
@Injectable()
export class SettingsHashService {
  compute(methods: MethodView[]): string {
    const canonical = methods
      .map((view) => ({
        id: view.id,
        method: view.method,
        isActive: view.isActive,
        types: [...view.types].sort(),
        tags: [...view.tags].sort(),
      }))
      .sort((a, b) => a.method.localeCompare(b.method));
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
}
