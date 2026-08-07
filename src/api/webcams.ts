/**
 * Webcam records from Moonraker (`/server/webcams/list`).
 *
 * Moonraker speaks snake_case, the rest of the SDK speaks camelCase, so the
 * translation lives in one pure function: it is the only place the two
 * vocabularies meet, and it can be checked without a network.
 */
import type { WebcamConfig } from './types';

/**
 * @param raw one entry of the `webcams` array, straight off the wire and
 *   therefore untrusted — every field is defaulted rather than assumed.
 */
export function parseWebcam(raw: any): WebcamConfig {
  return {
    name: raw.name ?? '',
    location: raw.location ?? '',
    service: raw.service ?? '',
    streamUrl: raw.stream_url ?? '',
    snapshotUrl: raw.snapshot_url ?? '',
    // `Number('быстро')` is NaN, which would propagate into layout maths and
    // render as a blank field rather than an obviously wrong one.
    targetFps: Number(raw.target_fps) || 0,
    flipHorizontal: raw.flip_horizontal === true,
    flipVertical: raw.flip_vertical === true,
    rotation: Number(raw.rotation) || 0,
    aspectRatio: raw.aspect_ratio ?? '',
    // Moonraker omits `enabled` on older configs; treating absence as
    // "disabled" would hide the printer's only camera.
    enabled: raw.enabled !== false,
  };
}
