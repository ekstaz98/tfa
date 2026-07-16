import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Operation } from './operation.entity';
import { Type } from './type.entity';

/**
 * Код операции по одному типу. Переотправка ОБНОВЛЯЕТ строку
 * (unique(operation_id, type_id)), не вставляет новую.
 */
@Entity('codes')
@Unique(['operationId', 'typeId'])
export class Code {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  operationId: string;

  @Column('uuid')
  typeId: string;

  /** HMAC-SHA256(code, secret); NULL для GA/TOTP — верификация по secret креда. */
  @Column({ type: 'varchar', nullable: true })
  codeHash: string | null;

  /** Попытки ввода — анти-брутфорс; при переотправке НЕ сбрасывается. */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Счётчик отправок — лимит переотправок. */
  @Column({ type: 'int', default: 1 })
  sendsCount: number;

  /** Опора retry-окна переотправки; NULL для GA. */
  @Column({ type: 'timestamptz', nullable: true })
  lastSentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  /** Инвариант: codes.expires_at <= operations.expires_at (TTL один). */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Operation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'operation_id' })
  operation?: Operation;

  @ManyToOne(() => Type)
  @JoinColumn({ name: 'type_id' })
  type?: Type;
}
