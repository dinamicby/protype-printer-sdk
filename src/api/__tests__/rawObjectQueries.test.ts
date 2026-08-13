import {describe, expect, test, vi, afterEach} from 'vitest';
import {MoonrakerClient} from '../moonraker-client';

afterEach(() => vi.unstubAllGlobals());

function client() {
  return new MoonrakerClient({baseUrl: 'http://printer', mode: 'local', maxRetries: 0});
}

/** Ответ Moonraker с телом `result`, как его разворачивает `request`. */
function answers(body: unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    calls.push(url);
    return Promise.resolve(new Response(JSON.stringify({result: body}), {status: 200}));
  }));
  return calls;
}

describe('listObjects', () => {
  test('отдаёт имена секций, которые объявил принтер', async () => {
    answers({objects: ['extruder', 'heater_bed', 'multi_color_controller']});

    const res = await client().listObjects();

    expect(res.data).toEqual(['extruder', 'heater_bed', 'multi_color_controller']);
  });

  test('ответ без массива — отказ, а не пустой список', async () => {
    // Пустой список означал бы «у принтера нет ни одного объекта», и вызывающий
    // закэшировал бы отсутствие системы подачи, которой просто не спросили.
    answers({});

    expect((await client().listObjects()).success).toBe(false);
  });
});

describe('queryObjects', () => {
  test('спрашивает ровно названные объекты и отдаёт их статус', async () => {
    const calls = answers({status: {box_extras: {is_tool_change: 0}}});

    const res = await client().queryObjects(['box_extras', 'save_variables']);

    expect(calls[0]).toBe('http://printer/printer/objects/query?box_extras&save_variables');
    expect(res.data).toEqual({box_extras: {is_tool_change: 0}});
  });

  test('имена кодируются — объект принтера может нести пробел', async () => {
    const calls = answers({status: {}});

    await client().queryObjects(['filament_switch_sensor FS1']);

    expect(calls[0]).toBe('http://printer/printer/objects/query?filament_switch_sensor%20FS1');
  });

  test('пустой список не превращается в запрос всего подряд', async () => {
    const calls = answers({status: {}});

    const res = await client().queryObjects([]);

    expect(calls).toEqual([]);
    expect(res.data).toEqual({});
  });

  test('Moonraker отвечает пустым объектом на неизвестное имя — это успех', async () => {
    // Проверено живьём: 200 и `{}`, а не ошибка. Отличать «нет такого объекта»
    // от «запрос не прошёл» обязан вызывающий, и для этого ему нужен успех.
    answers({status: {box_extras: {}}});

    const res = await client().queryObjects(['box_extras']);

    expect(res).toEqual({success: true, data: {box_extras: {}}});
  });
});

describe('getConfigSettings', () => {
  test('отдаёт секции конфига так, как их назвал Klipper', async () => {
    const calls = answers({status: {configfile: {settings: {'gcode_macro choose_spool_1': {gcode: 'X'}}}}});

    const res = await client().getConfigSettings();

    expect(calls[0]).toBe('http://printer/printer/objects/query?configfile=settings');
    expect(res.data).toEqual({'gcode_macro choose_spool_1': {gcode: 'X'}});
  });

  test('конфига нет — отказ, а не пустые настройки', async () => {
    answers({status: {configfile: {}}});

    expect((await client().getConfigSettings()).success).toBe(false);
  });
});
