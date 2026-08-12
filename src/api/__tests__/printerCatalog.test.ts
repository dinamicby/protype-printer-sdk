/**
 * Какая машина стоит за принтером.
 *
 * Одна реализация на десктоп и мобилку: карточка, пикер и оба приложения
 * обязаны отвечать на этот вопрос одинаково. Приоритет источников —
 * ручной выбор > ключ с сервера > автоопределение — живёт здесь и больше
 * нигде.
 */
import { describe, expect, test } from 'vitest';
import {
  buildCatalogIndex,
  resolvePrinterModel,
  type PrinterCatalog,
} from '../printer-catalog';

const CATALOG: PrinterCatalog = {
  version: 1,
  vendors: [{ key: 'qidi', name: 'QIDI' }],
  models: [
    { key: 'qidi-x-max-4', vendorKey: 'qidi', name: 'QIDI X-Max 4', aliases: [],
      coverUrl: '/cover/x4', coverSha256: null, hasProfile: true },
    { key: 'qidi-q1-pro', vendorKey: 'qidi', name: 'QIDI Q1 Pro', aliases: ['q1pro'],
      coverUrl: '/cover/q1', coverSha256: null, hasProfile: false },
  ],
};

const index = buildCatalogIndex(CATALOG);

describe('buildCatalogIndex', () => {
  test('индексирует и ключи, и алиасы', () => {
    expect(index.byKey.get('qidi-x-max-4')?.name).toBe('QIDI X-Max 4');
    expect(index.byKey.get('q1pro')?.name).toBe('QIDI Q1 Pro');
  });

  test('алиас не перебивает настоящий ключ другой модели', () => {
    const shadowed = buildCatalogIndex({
      version: 1,
      vendors: [],
      models: [
        { key: 'a', vendorKey: 'v', name: 'A', aliases: [],
          coverUrl: null, coverSha256: null, hasProfile: false },
        { key: 'b', vendorKey: 'v', name: 'B', aliases: ['a'],
          coverUrl: null, coverSha256: null, hasProfile: false },
      ],
    });
    expect(shadowed.byKey.get('a')?.name).toBe('A');
  });

  test('имена вендоров доступны по ключу', () => {
    expect(index.vendorNameByKey.get('qidi')).toBe('QIDI');
  });
});

describe('облачный принтер', () => {
  test('ключ с сервера даёт вендора и имя модели', () => {
    expect(resolvePrinterModel({ source: 'cloud', printer_model_key: 'qidi-x-max-4' }, index))
      .toMatchObject({ vendorName: 'QIDI', modelName: 'QIDI X-Max 4', hasProfile: true });
  });

  test('регистр ключа не важен', () => {
    expect(resolvePrinterModel({ source: 'cloud', printer_model_key: 'QIDI-X-MAX-4' }, index)?.modelName)
      .toBe('QIDI X-Max 4');
  });

  test('алиас тоже находит модель', () => {
    expect(resolvePrinterModel({ source: 'cloud', printer_model_key: 'q1pro' }, index)?.modelName)
      .toBe('QIDI Q1 Pro');
  });

  test('незнакомый ключ показывается как есть — сервер что-то знает, каталог отстал', () => {
    expect(resolvePrinterModel({ source: 'cloud', printer_model_key: 'CD400' }, index))
      .toMatchObject({ vendorName: null, modelName: 'cd400', model: null });
  });

  test('без ключа нечего показывать', () => {
    expect(resolvePrinterModel({ source: 'cloud', printer_model_key: null }, index)).toBeNull();
  });
});

describe('локальный принтер', () => {
  test('выбранная человеком модель', () => {
    expect(resolvePrinterModel({ source: 'local', catalogModelKey: 'qidi-q1-pro' }, index)?.modelName)
      .toBe('QIDI Q1 Pro');
  });

  test('исчезнувшая из каталога модель не показывается технической строкой', () => {
    // Ключ выбирали из списка; «qidi-gone» тому, кто его не набирал, не значит ничего.
    expect(resolvePrinterModel({ source: 'local', catalogModelKey: 'qidi-gone' }, index)).toBeNull();
  });
});

describe('без каталога', () => {
  test('облачный ключ всё равно виден', () => {
    expect(resolvePrinterModel({ source: 'cloud', printer_model_key: 'CD400' }, null)?.modelName)
      .toBe('cd400');
  });

  test('локальный — нет', () => {
    expect(resolvePrinterModel({ source: 'local', catalogModelKey: 'qidi-q1-pro' }, null)).toBeNull();
  });
});

describe('автоопределённая модель', () => {
  test('заполняет пустое место у локального принтера', () => {
    expect(resolvePrinterModel(
      { source: 'local', catalogModelKey: null, autoModelKey: 'qidi-x-max-4' }, index,
    )?.modelName).toBe('QIDI X-Max 4');
  });

  test('заполняет пустое место у облачного', () => {
    expect(resolvePrinterModel(
      { source: 'cloud', printer_model_key: null, autoModelKey: 'qidi-x-max-4' }, index,
    )?.modelName).toBe('QIDI X-Max 4');
  });

  test('ручной выбор главнее догадки', () => {
    expect(resolvePrinterModel(
      { source: 'local', catalogModelKey: 'qidi-q1-pro', autoModelKey: 'qidi-x-max-4' }, index,
    )?.modelName).toBe('QIDI Q1 Pro');
  });

  test('серверный ключ главнее догадки', () => {
    expect(resolvePrinterModel(
      { source: 'cloud', printer_model_key: 'qidi-q1-pro', autoModelKey: 'qidi-x-max-4' }, index,
    )?.modelName).toBe('QIDI Q1 Pro');
  });

  test('догадка про модель, которой в каталоге уже нет, ничего не показывает', () => {
    expect(resolvePrinterModel(
      { source: 'cloud', printer_model_key: null, autoModelKey: 'qidi-gone' }, index,
    )).toBeNull();
  });
});
