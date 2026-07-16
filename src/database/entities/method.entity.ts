import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Метод гейтвея, покрываемый 2ФА (админ-мутации либо автосинк). */
@Entity('methods')
@Index('uq_methods_method', ['method'], {
  unique: true,
  where: '"is_deleted" = false',
})
export class Method {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  method: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isDeleted: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** Участвует в вычислении hash для 2faMethods(hash). */
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
