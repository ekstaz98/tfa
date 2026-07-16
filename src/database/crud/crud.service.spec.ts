import { EntityManager, Repository } from 'typeorm';
import { Method, Tag } from '../entities';
import { MethodsCrudService } from './methods-crud.service';
import { TagsCrudService } from './tags-crud.service';

type RepositoryMock = {
  target: unknown;
  create: jest.Mock;
  save: jest.Mock;
  findOneBy: jest.Mock;
  findBy: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

function buildRepositoryMock(target: unknown): RepositoryMock {
  return {
    target,
    create: jest.fn((data: object) => ({ ...data })),
    save: jest.fn((entity: object) =>
      Promise.resolve({ id: 'id-1', ...entity }),
    ),
    findOneBy: jest.fn().mockResolvedValue(null),
    findBy: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

describe('CrudService (на примере MethodsCrudService / TagsCrudService)', () => {
  let repository: RepositoryMock;
  let service: MethodsCrudService;

  beforeEach(() => {
    repository = buildRepositoryMock(Method);
    service = new MethodsCrudService(
      repository as unknown as Repository<Method>,
    );
  });

  it('create: repo.create + repo.save', async () => {
    const created = await service.create({ method: 'transfer' });

    expect(repository.create).toHaveBeenCalledWith({ method: 'transfer' });
    expect(repository.save).toHaveBeenCalled();
    expect(created).toEqual({ id: 'id-1', method: 'transfer' });
  });

  it('findById ищет по id', async () => {
    await service.findById('id-42');
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'id-42' });
  });

  it('findBy передаёт критерии в репозиторий', async () => {
    await service.findBy({ isActive: true, isDeleted: false });
    expect(repository.findBy).toHaveBeenCalledWith({
      isActive: true,
      isDeleted: false,
    });
  });

  it('update обновляет по id', async () => {
    await service.update('id-42', { isActive: false });
    expect(repository.update).toHaveBeenCalledWith('id-42', {
      isActive: false,
    });
  });

  it('delete удаляет по id', async () => {
    await service.delete('id-42');
    expect(repository.delete).toHaveBeenCalledWith('id-42');
  });

  it('softDelete ставит isDeleted = true', async () => {
    await service.softDelete('id-42');
    expect(repository.update).toHaveBeenCalledWith('id-42', {
      isDeleted: true,
    });
  });

  it('у сервиса без is_deleted нет softDelete', () => {
    const tags = new TagsCrudService(
      buildRepositoryMock(Tag) as unknown as Repository<Tag>,
    );
    expect(
      (tags as unknown as Record<string, unknown>).softDelete,
    ).toBeUndefined();
  });

  describe('опциональный EntityManager (транзакции верхнего уровня)', () => {
    let managerRepository: RepositoryMock;
    let manager: EntityManager;

    beforeEach(() => {
      managerRepository = buildRepositoryMock(Method);
      manager = {
        getRepository: jest.fn().mockReturnValue(managerRepository),
      } as unknown as EntityManager;
    });

    it('с manager все вызовы идут через его репозиторий', async () => {
      await service.create({ method: 'signin' }, manager);
      await service.findById('id-1', manager);
      await service.findBy({ isDeleted: false }, manager);
      await service.update('id-1', { isActive: false }, manager);
      await service.softDelete('id-1', manager);

      expect(manager.getRepository).toHaveBeenCalledWith(Method);
      expect(managerRepository.save).toHaveBeenCalled();
      expect(managerRepository.findOneBy).toHaveBeenCalled();
      expect(managerRepository.findBy).toHaveBeenCalled();
      expect(managerRepository.update).toHaveBeenCalledTimes(2);
      // дефолтный репозиторий не трогается
      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
