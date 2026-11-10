import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ZOOM,
  distanceForSpan,
  FollowCamera,
  PITCH,
  SHORT_SIDE_FOV,
  SPEED_ZOOM,
  verticalFov,
  ZOOM_PRESETS,
} from '../src/game/camera';

describe('camera maths', () => {
  it('places the camera so the preset span fills the shorter screen side', () => {
    const d = distanceForSpan(45);
    expect(2 * d * Math.tan((SHORT_SIDE_FOV * Math.PI) / 360)).toBeCloseTo(45);
  });

  it('keeps the field of view across the shorter side in portrait', () => {
    expect(verticalFov(16 / 9)).toBe(SHORT_SIDE_FOV);
    const portrait = verticalFov(9 / 16);
    expect(portrait).toBeGreaterThan(SHORT_SIDE_FOV);
    // The horizontal field of view in portrait equals the landscape vertical one.
    const horizontal =
      (2 * Math.atan(Math.tan((portrait * Math.PI) / 360) * (9 / 16)) * 180) / Math.PI;
    expect(horizontal).toBeCloseTo(SHORT_SIDE_FOV);
  });
});

describe('FollowCamera', () => {
  it('starts at the default preset, pitched down at the target', () => {
    const cam = new FollowCamera();
    cam.snapTo(new Vector3(10, 0, 20));
    expect(cam.viewSpan).toBeCloseTo(ZOOM_PRESETS[DEFAULT_ZOOM]);
    const toCamera = cam.camera.position.clone().sub(new Vector3(10, 0, 20));
    expect(Math.atan2(toCamera.y, Math.hypot(toCamera.x, toCamera.z))).toBeCloseTo(PITCH);
    // Yaw 0 puts the camera south of the target, looking north.
    expect(toCamera.z).toBeGreaterThan(0);
    expect(toCamera.x).toBeCloseTo(0);
  });

  it('clamps zoom to the presets', () => {
    const cam = new FollowCamera();
    cam.zoom(-1);
    cam.zoom(-1);
    expect(cam.zoomLevel).toBe(0);
    for (let i = 0; i < 5; i++) cam.zoom(1);
    expect(cam.zoomLevel).toBe(ZOOM_PRESETS.length - 1);
  });

  it('rotates in 45° steps and settles on the target yaw', () => {
    const cam = new FollowCamera();
    const target = new Vector3();
    cam.snapTo(target);
    cam.turn(1);
    for (let i = 0; i < 300; i++) cam.update(1 / 60, target, new Vector3());
    expect(cam.yaw).toBeCloseTo(Math.PI / 4, 3);
    // Orbiting right moves the camera towards +x of the target.
    expect(cam.camera.position.x).toBeGreaterThan(0);
  });

  it('pulls back at speed and closes in again at rest', () => {
    const cam = new FollowCamera();
    const target = new Vector3();
    cam.snapTo(target);
    const rest = cam.viewSpan;
    for (let i = 0; i < 300; i++) cam.update(1 / 60, target, new Vector3(40, 0, 0));
    expect(cam.viewSpan).toBeCloseTo(rest * (1 + SPEED_ZOOM), 1);
    for (let i = 0; i < 900; i++) cam.update(1 / 60, target, new Vector3());
    expect(cam.viewSpan).toBeCloseTo(rest, 1);
  });

  it('leads a moving target in its direction of travel', () => {
    const cam = new FollowCamera();
    const target = new Vector3();
    cam.snapTo(target);
    const velocity = new Vector3(0, 0, -10);
    for (let i = 0; i < 240; i++) cam.update(1 / 60, target, velocity);
    expect(cam.focus.z).toBeLessThan(-3);
    expect(Math.abs(cam.focus.z)).toBeLessThanOrEqual(cam.viewSpan * 0.28 + 1e-6);
  });
});
