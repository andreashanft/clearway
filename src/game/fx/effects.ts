import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  type Camera,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import { instancedDynamicBufferAttribute, texture } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Heightfield } from '../world/heightfield';

/** Peak brightness of an explosion's light flash, in candela. */
const FLASH_INTENSITY = 1400;

/** A soft round dot, used as the alpha mask for dust, smoke and fire. */
function softDot(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

interface Particle {
  readonly position: Vector3;
  readonly velocity: Vector3;
  age: number;
  life: number;
  startSize: number;
  endSize: number;
  readonly colour: Color;
  opacity: number;
  drag: number;
  rise: number;
}

/** Camera-facing quads with per-particle colour and opacity, in one instanced draw. */
class SpriteParticles {
  readonly mesh: InstancedMesh;
  private readonly tint: InstancedBufferAttribute;
  private readonly particles: Particle[] = [];
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();

  constructor(
    private readonly capacity: number,
    alpha: CanvasTexture,
    additive: boolean,
  ) {
    this.tint = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.tint.setUsage(DynamicDrawUsage);
    const tint = instancedDynamicBufferAttribute<'vec4'>(this.tint, 'vec4');
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    material.colorNode = tint.xyz;
    material.opacityNode = tint.w.mul(texture(alpha).r);
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
  }

  spawn(p: Omit<Particle, 'age'>): void {
    if (this.particles.length >= this.capacity) this.particles.shift();
    this.particles.push({ ...p, age: 0 });
  }

  update(dt: number, cameraQuaternion: Quaternion): void {
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p) continue;
      p.age += dt;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.velocity.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.velocity.y += p.rise * dt;
      p.position.addScaledVector(p.velocity, dt);
    }
    for (const p of this.particles) {
      const t = p.age / p.life;
      const size = p.startSize + (p.endSize - p.startSize) * Math.sqrt(t);
      this.matrix.compose(p.position, cameraQuaternion, this.scale.setScalar(size));
      this.mesh.setMatrixAt(n, this.matrix);
      // Fade in quickly, then out.
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t);
      this.tint.setXYZW(n, p.colour.r, p.colour.g, p.colour.b, p.opacity * fade);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
  }
}

interface Debris {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly spinAxis: Vector3;
  readonly rotation: Quaternion;
  spin: number;
  size: number;
  age: number;
  life: number;
  readonly colour: Color;
}

/** Small tumbling fragments with simple ballistics and ground bounces; no physics bodies. */
class DebrisParticles {
  readonly mesh: InstancedMesh;
  private readonly items: Debris[] = [];
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();
  private readonly step = new Quaternion();

  constructor(
    private readonly capacity: number,
    private readonly field: Heightfield,
  ) {
    const material = new MeshStandardMaterial({ roughness: 0.9 });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    // Allocates the per-instance colour buffer.
    this.mesh.setColorAt(0, new Color());
  }

  spawn(d: Debris): void {
    if (this.items.length >= this.capacity) this.items.shift();
    this.items.push(d);
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      if (!d) continue;
      d.age += dt;
      if (d.age >= d.life) {
        this.items.splice(i, 1);
        continue;
      }
      d.velocity.y -= 9.81 * dt;
      d.position.addScaledVector(d.velocity, dt);
      const ground = this.field.heightAt(d.position.x, d.position.z) + d.size / 2;
      if (d.position.y < ground) {
        d.position.y = ground;
        d.velocity.y = Math.abs(d.velocity.y) * 0.3;
        d.velocity.x *= 0.55;
        d.velocity.z *= 0.55;
        d.spin *= 0.5;
      }
      d.rotation.multiply(this.step.setFromAxisAngle(d.spinAxis, d.spin * dt));
    }
    let n = 0;
    for (const d of this.items) {
      // Shrink away over the last half second.
      const s = d.size * Math.min(1, (d.life - d.age) / 0.5);
      this.matrix.compose(d.position, d.rotation, this.scale.setScalar(s));
      this.mesh.setMatrixAt(n, this.matrix);
      this.mesh.setColorAt(n, d.colour);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface Ring {
  readonly mesh: Mesh;
  age: number;
  life: number;
  radius: number;
}

/**
 * Visual effects for impacts and explosions: dust, fire, debris, ground shockwaves and a
 * short light flash. Effects have no gameplay effect.
 */
export class Effects {
  readonly group = new Group();
  private readonly dust: SpriteParticles;
  private readonly fire: SpriteParticles;
  private readonly debris: DebrisParticles;
  private readonly rings: Ring[] = [];
  private readonly ringMaterial = new MeshBasicMaterial({
    color: '#FFE2A8',
    transparent: true,
    depthWrite: false,
  });
  private readonly flash = new PointLight('#FFB45A', 0, 40, 1.6);
  private flashAge = 1;
  private readonly cameraQuaternion = new Quaternion();
  private readonly tmp = new Vector3();
  private readonly colour = new Color();

  constructor(private readonly field: Heightfield) {
    const dot = softDot();
    this.dust = new SpriteParticles(260, dot, false);
    this.fire = new SpriteParticles(120, dot, true);
    this.debris = new DebrisParticles(260, field);
    this.group.add(this.dust.mesh, this.fire.mesh, this.debris.mesh, this.flash);
    this.group.name = 'effects';
  }

  /** A puff of dust, for example where a wall hits the ground. */
  dustBurst(at: Vector3, radius: number, count: number, colour: string): void {
    const base = this.colour.set(colour).lerp(new Color('#C9BFA8'), 0.5);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      this.dust.spawn({
        position: new Vector3(
          at.x + Math.cos(a) * r,
          at.y + Math.random() * 1.5,
          at.z + Math.sin(a) * r,
        ),
        velocity: new Vector3(Math.cos(a) * 2.5, 1 + Math.random() * 2, Math.sin(a) * 2.5),
        life: 1.6 + Math.random() * 1.6,
        startSize: 1.5 + Math.random() * 1.5,
        endSize: 4 + Math.random() * 4,
        colour: base.clone().multiplyScalar(0.9 + Math.random() * 0.2),
        opacity: 0.55,
        drag: 1.4,
        rise: 0.6,
      });
    }
  }

  /** A pale wisp left by a skidding tyre (the Fishtail's ghost trails). */
  skidPuff(at: Vector3): void {
    this.dust.spawn({
      position: at.clone(),
      velocity: new Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4),
      life: 1.4,
      startSize: 0.9,
      endSize: 2.2,
      colour: new Color('#EEF3FF'),
      opacity: 0.42,
      drag: 2,
      rise: 0.1,
    });
  }

  /** Fragments thrown from a hit point, tinted like the building. */
  debrisBurst(
    at: Vector3,
    count: number,
    colour: string,
    speed: number,
    direction?: Vector3,
  ): void {
    const base = new Color(colour);
    for (let i = 0; i < count; i++) {
      const v = new Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random()));
      if (direction) v.addScaledVector(direction, speed * 0.6);
      this.debris.spawn({
        position: at
          .clone()
          .add(this.tmp.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5)),
        velocity: v,
        spinAxis: new Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
        ).normalize(),
        rotation: new Quaternion(),
        spin: 4 + Math.random() * 10,
        size: 0.18 + Math.random() * 0.35,
        age: 0,
        life: 2.5 + Math.random() * 1.5,
        colour: base.clone().multiplyScalar(0.75 + Math.random() * 0.4),
      });
    }
  }

  /** Fireball, smoke, debris, a ground shockwave and a light flash. */
  explosion(at: Vector3, radius: number): void {
    for (let i = 0; i < 26; i++) {
      const dir = new Vector3(
        Math.random() - 0.5,
        Math.random() * 0.9,
        Math.random() - 0.5,
      ).normalize();
      this.fire.spawn({
        position: at.clone().addScaledVector(dir, Math.random() * radius * 0.2),
        velocity: dir.clone().multiplyScalar(radius * (0.6 + Math.random() * 0.8)),
        life: 0.45 + Math.random() * 0.4,
        startSize: radius * 0.35,
        endSize: radius * (0.7 + Math.random() * 0.4),
        colour: new Color().setHSL(0.06 + Math.random() * 0.06, 1, 0.55 + Math.random() * 0.15),
        opacity: 1,
        drag: 3,
        rise: 3,
      });
    }
    for (let i = 0; i < 22; i++) {
      const dir = new Vector3(
        Math.random() - 0.5,
        Math.random() * 0.6 + 0.2,
        Math.random() - 0.5,
      ).normalize();
      this.dust.spawn({
        position: at.clone().addScaledVector(dir, Math.random() * radius * 0.3),
        velocity: dir.clone().multiplyScalar(radius * (0.3 + Math.random() * 0.5)),
        life: 2.5 + Math.random() * 2,
        startSize: radius * 0.3,
        endSize: radius * (0.9 + Math.random() * 0.6),
        colour: new Color('#4A4744').multiplyScalar(0.8 + Math.random() * 0.4),
        opacity: 0.7,
        drag: 1.2,
        rise: 1.2,
      });
    }
    this.debrisBurst(at, 24, '#5A4A3A', radius * 1.4);

    const ring: Ring = {
      mesh: new Mesh(new RingGeometry(0.85, 1, 48), this.ringMaterial.clone()),
      age: 0,
      life: 0.6,
      radius,
    };
    ring.mesh.rotation.x = -Math.PI / 2;
    ring.mesh.position.set(at.x, this.field.heightAt(at.x, at.z) + 0.3, at.z);
    this.group.add(ring.mesh);
    this.rings.push(ring);

    this.flash.position.copy(at).y += 3;
    this.flash.intensity = FLASH_INTENSITY;
    this.flash.distance = radius * 3.5;
    this.flashAge = 0;
  }

  update(dt: number, camera: Camera): void {
    camera.getWorldQuaternion(this.cameraQuaternion);
    this.dust.update(dt, this.cameraQuaternion);
    this.fire.update(dt, this.cameraQuaternion);
    this.debris.update(dt);

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      if (!ring) continue;
      ring.age += dt;
      const t = ring.age / ring.life;
      if (t >= 1) {
        this.group.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as MeshBasicMaterial).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      ring.mesh.scale.setScalar(ring.radius * (0.2 + 1.4 * Math.sqrt(t)));
      (ring.mesh.material as MeshBasicMaterial).opacity = 0.8 * (1 - t);
    }

    if (this.flashAge < 1) {
      this.flashAge += dt;
      this.flash.intensity = FLASH_INTENSITY * Math.max(0, 1 - this.flashAge / 0.3) ** 2;
    }
  }
}
