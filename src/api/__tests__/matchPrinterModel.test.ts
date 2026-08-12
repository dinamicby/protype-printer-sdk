/**
 * Сопоставление принтера с моделью каталога.
 *
 * Строки в тестах — не выдуманные: `qidi-max4` и `QIDI` сняты с живого
 * X-Max 4 в офисе (`/printer/info` и `/machine/system_info`). Имена моделей —
 * из вендорного дерева OrcaSlicer, откуда каталог и наполняется.
 */
import { describe, expect, test } from 'vitest';
import { matchPrinterModel, type MatchableModel } from '../match-printer-model';

const VENDORS = [
  { key: 'qidi', name: 'QIDI' },
  { key: 'creality', name: 'Creality' },
];

const model = (key: string, vendorKey: string, name: string, aliases: string[] = []): MatchableModel =>
  ({ key, vendorKey, name, aliases });

const QIDI_MODELS = [
  model('qidi-x-max-4', 'qidi', 'QIDI X-Max 4'),
  model('qidi-x-max-3', 'qidi', 'QIDI X-Max 3'),
  model('qidi-q1-pro', 'qidi', 'QIDI Q1 Pro'),
  model('creality-ender3-v3-se', 'creality', 'Creality Ender-3 V3 SE'),
];

describe('точный матч по ключу и алиасам', () => {
  test('ключ каталога как есть', () => {
    expect(matchPrinterModel({ hostname: 'qidi-x-max-4', machineName: null }, QIDI_MODELS, VENDORS))
      .toBe('qidi-x-max-4');
  });

  test('разделители и регистр не мешают', () => {
    expect(matchPrinterModel({ hostname: 'QIDI_X_Max_4', machineName: null }, QIDI_MODELS, VENDORS))
      .toBe('qidi-x-max-4');
  });

  test('алиас — то, чем чинится любой промах без релиза', () => {
    const models = [model('qidi-x-max-4', 'qidi', 'QIDI X-Max 4', ['qidi-max4'])];
    expect(matchPrinterModel({ hostname: 'qidi-max4', machineName: 'QIDI' }, models, VENDORS))
      .toBe('qidi-x-max-4');
  });
});

describe('матч внутри вендора', () => {
  test('живой X-Max 4 находится по hostname и machine_name', () => {
    expect(matchPrinterModel({ hostname: 'qidi-max4', machineName: 'QIDI' }, QIDI_MODELS, VENDORS))
      .toBe('qidi-x-max-4');
  });

  test('цифра отличает соседнюю модель', () => {
    expect(matchPrinterModel({ hostname: 'qidi-max3', machineName: 'QIDI' }, QIDI_MODELS, VENDORS))
      .toBe('qidi-x-max-3');
  });

  test('вендор берётся и из имени, не только из ключа', () => {
    const vendors = [{ key: 'qidi-tech', name: 'QIDI' }];
    const models = [model('qidi-tech-x-max-4', 'qidi-tech', 'QIDI X-Max 4')];
    expect(matchPrinterModel({ hostname: 'qidi-max4', machineName: 'QIDI' }, models, vendors))
      .toBe('qidi-tech-x-max-4');
  });

  test('чужой вендор не рассматривается', () => {
    // Ender-3 V3 SE не должен всплыть на QIDI, даже если цифры совпали.
    expect(matchPrinterModel({ hostname: 'ender3', machineName: 'QIDI' }, QIDI_MODELS, VENDORS))
      .toBeNull();
  });
});

describe('отказ вместо догадки', () => {
  test('ничья не даёт ничего', () => {
    // «Неверная картинка хуже никакой»: два кандидата — значит ни одного.
    const models = [
      model('qidi-x-max-4', 'qidi', 'QIDI X-Max 4'),
      model('qidi-x-max-4-plus', 'qidi', 'QIDI X-Max 4 Plus'),
    ];
    expect(matchPrinterModel({ hostname: 'qidi-max4', machineName: 'QIDI' }, models, VENDORS))
      .toBeNull();
  });

  test('нет цифр — нечем отличить, отказ', () => {
    expect(matchPrinterModel({ hostname: 'printer', machineName: 'QIDI' }, QIDI_MODELS, VENDORS))
      .toBeNull();
  });

  test('незнакомый вендор', () => {
    expect(matchPrinterModel({ hostname: 'foo-1', machineName: 'Acme' }, QIDI_MODELS, VENDORS))
      .toBeNull();
  });

  test('пустая личность', () => {
    expect(matchPrinterModel(null, QIDI_MODELS, VENDORS)).toBeNull();
    expect(matchPrinterModel({ hostname: null, machineName: null }, QIDI_MODELS, VENDORS)).toBeNull();
  });

  test('пустой каталог', () => {
    expect(matchPrinterModel({ hostname: 'qidi-max4', machineName: 'QIDI' }, [], VENDORS)).toBeNull();
  });

  test('без machine_name второй шаг не работает, но точный матч ещё жив', () => {
    expect(matchPrinterModel({ hostname: 'qidi-max4', machineName: null }, QIDI_MODELS, VENDORS))
      .toBeNull();
    expect(matchPrinterModel({ hostname: 'qidi-x-max-4', machineName: null }, QIDI_MODELS, VENDORS))
      .toBe('qidi-x-max-4');
  });
});
