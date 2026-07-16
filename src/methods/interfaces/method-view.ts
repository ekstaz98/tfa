/** Элемент ответа 2faMethods (и админ/юзер-мутаций) — формат из ТЗ. */
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
