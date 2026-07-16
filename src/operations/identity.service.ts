import { Injectable } from '@nestjs/common';

/**
 * Нормализация identity на всех входах (send2Fa, verify, RMQ-консьюмер):
 * email → trim + lowercase, phone → E.164. Иначе unique(type_id, identity)
 * и unauthed-поиск юзера ломаются на регистре/формате.
 */
@Injectable()
export class IdentityNormalizerService {
  normalize(identity: string): string {
    const trimmed = identity.trim();
    return trimmed.includes('@')
      ? this.normalizeEmail(trimmed)
      : this.normalizePhone(trimmed);
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /** E.164: только цифры с ведущим +. */
  normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return `+${digits}`;
  }
}

/**
 * Маскирование identity для ответов send2Fa — отдельный чистый сервис.
 * Форматы из ТЗ: +7912...3345, gg...hm@gmail.com; краевые случаи
 * (короткая локальная часть, короткие номера) не падают.
 */
@Injectable()
export class IdentityMaskerService {
  mask(identity: string): string {
    return identity.includes('@')
      ? this.maskEmail(identity)
      : this.maskPhone(identity);
  }

  private maskEmail(email: string): string {
    const at = email.lastIndexOf('@');
    const local = email.slice(0, at);
    const domain = email.slice(at);
    if (local.length <= 2) {
      return `${local.slice(0, 1)}...${domain}`;
    }
    if (local.length <= 4) {
      return `${local.slice(0, 1)}...${local.slice(-1)}${domain}`;
    }
    return `${local.slice(0, 2)}...${local.slice(-2)}${domain}`;
  }

  private maskPhone(phone: string): string {
    if (phone.length > 9) {
      return `${phone.slice(0, 5)}...${phone.slice(-4)}`;
    }
    if (phone.length > 4) {
      return `${phone.slice(0, 2)}...${phone.slice(-2)}`;
    }
    return `${phone.slice(0, 1)}...`;
  }
}
