/** Элемент ответа twoFaMethods (и админ/юзер-мутаций) — формат из ТЗ. */
export interface MethodView {
  id: string;
  method: string;
  isActive: boolean;
  isDeleted: boolean;
  types: string[];
  tags: string[];
}

export interface CreateMethodInput {
  method: string;
  isActive?: boolean;
  types: string[];
  tags: string[];
}

export interface UpdateMethodInput {
  id: string;
  method?: string;
  isActive?: boolean;
  isDeleted?: boolean;
  /** undefined — не менять; [] — очистить связи. */
  types?: string[];
  tags?: string[];
}

export interface UpdateMyMethodInput {
  /** id метода (methods.id). */
  id: string;
  isActive?: boolean;
  /** undefined — не менять; [] — отключить все типы. */
  types?: string[];
}

/**
 * Элемент ответа myTwoFaMethods — настройки юзера по user-методу.
 * В отличие от MethodView, выключенные методы не выпадают из списка.
 */
export interface MyMethodView {
  id: string;
  method: string;
  /** Требует ли метод 2ФА для юзера с учётом его переопределения. */
  isEnabled: boolean;
  /** Полный набор типов, разрешённый админом, — из чего юзер выбирает. */
  allowedTypes: string[];
  /** Типы, действующие для юзера сейчас; пусто, если 2ФА выключена. */
  enabledTypes: string[];
  tags: string[];
}
