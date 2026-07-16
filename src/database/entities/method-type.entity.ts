import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Method } from './method.entity';
import { Type } from './type.entity';

/** Типы 2ФА, требуемые методом (конфигурация админа). */
@Entity('method_types')
@Unique(['methodId', 'typeId'])
export class MethodType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  methodId: string;

  @Column('uuid')
  typeId: string;

  @ManyToOne(() => Method, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'method_id' })
  method?: Method;

  @ManyToOne(() => Type)
  @JoinColumn({ name: 'type_id' })
  type?: Type;
}
