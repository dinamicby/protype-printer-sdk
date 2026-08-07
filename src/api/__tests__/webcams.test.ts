import { describe, expect, test } from 'vitest';
import { parseWebcam } from '../webcams';

describe('parseWebcam', () => {
  test('переводит snake_case Moonraker в camelCase', () => {
    expect(
      parseWebcam({
        name: 'chamber',
        location: 'printer',
        service: 'mjpegstreamer',
        stream_url: '/webcam/?action=stream',
        snapshot_url: '/webcam/?action=snapshot',
        target_fps: 15,
        flip_horizontal: true,
        flip_vertical: false,
        rotation: 90,
        aspect_ratio: '4:3',
        enabled: true,
      }),
    ).toEqual({
      name: 'chamber',
      location: 'printer',
      service: 'mjpegstreamer',
      streamUrl: '/webcam/?action=stream',
      snapshotUrl: '/webcam/?action=snapshot',
      targetFps: 15,
      flipHorizontal: true,
      flipVertical: false,
      rotation: 90,
      aspectRatio: '4:3',
      enabled: true,
    });
  });

  test('пустая запись не роняет разбор', () => {
    const cam = parseWebcam({});
    expect(cam.name).toBe('');
    expect(cam.streamUrl).toBe('');
    expect(cam.targetFps).toBe(0);
  });

  test('отсутствие enabled считается включённой камерой', () => {
    // Moonraker не пишет `enabled` в старых конфигах, и трактовать это как
    // «выключена» значит спрятать единственную камеру принтера.
    expect(parseWebcam({ name: 'cam' }).enabled).toBe(true);
    expect(parseWebcam({ name: 'cam', enabled: false }).enabled).toBe(false);
  });

  test('нечисловой target_fps не даёт NaN наружу', () => {
    expect(parseWebcam({ target_fps: 'быстро' }).targetFps).toBe(0);
  });
});
