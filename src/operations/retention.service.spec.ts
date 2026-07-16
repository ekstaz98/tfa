import { FakeOperationsCrud, fakeConfig } from '../testing/fakes';
import { RetentionService } from './retention.service';

describe('RetentionService', () => {
  it('вызывает батч-DELETE с cutoff = now - retention.days', async () => {
    const operationsCrud = new FakeOperationsCrud();
    operationsCrud.deleteFinishedBefore.mockResolvedValue(42);
    const service = new RetentionService(
      fakeConfig({ 'retention.days': 30 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      operationsCrud as any,
    );

    const deleted = await service.cleanup();

    expect(deleted).toBe(42);
    const cutoff = operationsCrud.deleteFinishedBefore.mock.calls[0][0] as Date;
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5000);
  });
});
