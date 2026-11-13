import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { HIRED_WORKSPACE } from '../kioskx-hired-desk/hired-policy';
import { SalesDeskController } from './sales-desk.controller';
import { SalesDeskService } from './sales-desk.service';

jest.mock(
  'src/engine/core-modules/auth/token/services/access-token.service',
  () => ({ AccessTokenService: class {} }),
);
jest.mock('./sales-desk.service', () => ({
  SalesDeskService: class {},
  SALES_QUEUES: ['cleaning', 'cars', 'jobs', 'turo'],
}));
const tokens = { validateToken: jest.fn() };
const desk = {
  allowed: jest.fn(),
  channels: jest.fn(() => ({ email: false, voice: false })),
  read: jest.fn(),
  save: jest.fn(),
  email: jest.fn(),
  call: jest.fn(),
};
let app: INestApplication;
beforeAll(async () => {
  jest.useRealTimers();
  const module = await Test.createTestingModule({
    controllers: [SalesDeskController],
    providers: [
      { provide: AccessTokenService, useValue: tokens },
      { provide: SalesDeskService, useValue: desk },
    ],
  }).compile();
  app = module.createNestApplication();
  await app.init();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  jest.clearAllMocks();
  tokens.validateToken.mockResolvedValue({
    user: { email: 'fixture@example.test' },
    workspace: { id: 'fixture-workspace' },
  });
  desk.allowed.mockReturnValue(true);
  desk.read.mockResolvedValue({ rows: [] });
});
it('signed-out gets 401 with no queue payload', async () => {
  const response = await request(app.getHttpServer()).get(
    '/sales-desk/queues/cleaning',
  );
  expect(response.status).toBe(401);
  expect(response.text).toBe('');
  expect(desk.read).not.toHaveBeenCalled();
});
it.each([
  ['get', '/sales-desk/session'],
  ['get', '/sales-desk/queues/cleaning'],
  ['get', '/sales-desk/queues/cars'],
  ['get', '/sales-desk/queues/jobs'],
  ['get', '/sales-desk/queues/turo'],
  ['post', '/sales-desk/queues/cleaning/fixture/save'],
  ['post', '/sales-desk/queues/cleaning/fixture/email'],
  ['post', '/sales-desk/queues/cleaning/fixture/call'],
])('hired session gets empty 403 for %s %s', async (method, path) => {
  tokens.validateToken.mockResolvedValue({
    user: { email: 'support@kiosk-x.ai' },
    workspace: { id: HIRED_WORKSPACE },
  });
  const client = request(app.getHttpServer());
  const response = await (
    method === 'get' ? client.get(path) : client.post(path)
  ).set('Authorization', 'Bearer fixture-token');
  expect(response.status).toBe(403);
  expect(response.text).toBe('');
  expect(desk.allowed).not.toHaveBeenCalled();
  expect(desk.read).not.toHaveBeenCalled();
  expect(desk.save).not.toHaveBeenCalled();
  expect(desk.email).not.toHaveBeenCalled();
  expect(desk.call).not.toHaveBeenCalled();
});
it('unlisted email receives closed session and no records', async () => {
  desk.allowed.mockReturnValue(false);
  const response = await request(app.getHttpServer())
    .get('/sales-desk/session')
    .set('Authorization', 'Bearer fixture-token');
  expect(response.body).toEqual({ allowed: false });
  const records = await request(app.getHttpServer())
    .get('/sales-desk/queues/cleaning')
    .set('Authorization', 'Bearer fixture-token');
  expect(records.status).toBe(403);
  expect(records.text).toBe('');
  expect(desk.read).not.toHaveBeenCalled();
});
it('listed email reads each queue in the verified workspace', async () => {
  for (const queue of ['cleaning', 'cars', 'jobs', 'turo']) {
    const response = await request(app.getHttpServer())
      .get(`/sales-desk/queues/${queue}`)
      .set('Authorization', 'Bearer fixture-token');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(desk.read).toHaveBeenCalledWith('fixture-workspace', queue);
  }
});
it('invalid tokens fail closed', async () => {
  tokens.validateToken.mockRejectedValue(new Error('Invalid token'));
  const response = await request(app.getHttpServer())
    .get('/sales-desk/session')
    .set('Authorization', 'Bearer fixture-token');
  expect(response.status).toBe(401);
  expect(desk.allowed).not.toHaveBeenCalled();
});
it('a failed queue returns no payload while the next queue still loads', async () => {
  desk.read.mockRejectedValueOnce(new Error('private provider detail'));
  const response = await request(app.getHttpServer())
    .get('/sales-desk/queues/cars')
    .set('Authorization', 'Bearer fixture-token');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ unavailable: true });
  const other = await request(app.getHttpServer())
    .get('/sales-desk/queues/cleaning')
    .set('Authorization', 'Bearer fixture-token');
  expect(other.status).toBe(200);
});
it('rejects client-selected mail recipients', async () => {
  const response = await request(app.getHttpServer())
    .post('/sales-desk/queues/cleaning/fixture/email')
    .set('Authorization', 'Bearer fixture-token')
    .send({
      requestId: '11111111-1111-4111-a111-111111111111',
      body: 'Fixture draft',
      destination: 'fixture@example.test',
    });
  expect(response.status).toBe(400);
  expect(desk.email).not.toHaveBeenCalled();
});
