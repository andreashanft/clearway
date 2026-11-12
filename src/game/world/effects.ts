import * as THREE from 'three/webgpu';
import { GRAVITY } from '../../engine/physics';

/** The most puffs that are alive at once. The oldest puff is replaced first. */
const PUFF_CAPACITY = 220;
const RING_CAPACITY = 6;

export const EFFECT_COLORS = {
  dust: 0xe8dcc0,
  dustDark: 0xbfb49a,
  smoke: 0x5a5a5e,
  fire: 0xff9a2e,
  fireHot: 0xfff0b0,
  fireDeep: 0xff5a2e,
  leaves: 0x5a8a45,
  spark: 0xffe27a,
  water: 0xbfe3f2,
} as const;

interface Puff {
  alive: boolean;
  glowing: boolean;
  age: number;
  life: number;
  size: number;
  /** How much gravity pulls the puff down. Dust floats, sparks fall. */
  weight: number;
  drag: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  radius: number;
}

/**
 * Short-lived particles: dust, smoke, fire, sparks and leaves.
 *
 * Every particle is a low-poly blob that grows quickly and then shrinks away. That suits the toy
 * look and needs no transparency, so one instanced mesh draws all of them.
 */
export class Effects {
  readonly object = new THREE.Group();

  private readonly puffs: Puff[] = [];
  private readonly lit: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  private readonly rings: Ring[] = [];
  private cursor = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();

  constructor() {
    this.object.name = 'effects';
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    this.lit = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshLambertMaterial({ flatShading: true }),
      PUFF_CAPACITY,
    );
    this.glow = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      PUFF_CAPACITY,
    );
    for (const mesh of [this.lit, this.glow]) {
      mesh.frustumCulled = false;
      for (let i = 0; i < PUFF_CAPACITY; i += 1) {
        mesh.setMatrixAt(i, this.hidden);
        mesh.setColorAt(i, this.color.setHex(0xffffff));
      }
      this.object.add(mesh);
    }
    for (let i = 0; i < PUFF_CAPACITY; i += 1) {
      this.puffs.push({
        alive: false,
        glowing: false,
        age: 0,
        life: 1,
        size: 1,
        weight: 0,
        drag: 1,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
      });
    }

    const ringGeometry = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_CAPACITY; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: EFFECT_COLORS.fireHot,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(ringGeometry, material);
      mesh.visible = false;
      this.object.add(mesh);
      this.rings.push({ mesh, material, age: 0, life: 0, radius: 1 });
    }
  }

  /** Adds one particle. */
  puff(options: {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    color: number;
    size: number;
    life: number;
    glowing?: boolean;
    weight?: number;
    drag?: number;
  }): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % PUFF_CAPACITY;
    const puff = this.puffs[index];
    // A reused slot may sit in the other mesh. Hide it there.
    (puff.glowing ? this.glow : this.lit).setMatrixAt(index, this.hidden);
    puff.alive = true;
    puff.glowing = options.glowing ?? false;
    puff.age = 0;
    puff.life = options.life;
    puff.size = options.size;
    puff.weight = options.weight ?? 0;
    puff.drag = options.drag ?? 1.6;
    puff.position.copy(options.position);
    puff.velocity.copy(options.velocity);
    (puff.glowing ? this.glow : this.lit).setColorAt(index, this.color.setHex(options.color));
  }

  /** A burst of dust, for example where a wall falls. */
  dust(
    position: THREE.Vector3,
    radius: number,
    count: number,
    color: number = EFFECT_COLORS.dust,
  ): void {
    const velocity = new THREE.Vector3();
    const start = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const reach = Math.random() * radius;
      start.set(
        position.x + Math.cos(angle) * reach,
        position.y + Math.random() * radius * 0.5,
        position.z + Math.sin(angle) * reach,
      );
      velocity.set(
        Math.cos(angle) * (3 + Math.random() * 6),
        2 + Math.random() * 5,
        Math.sin(angle) * (3 + Math.random() * 6),
      );
      this.puff({
        position: start,
        velocity,
        color: Math.random() > 0.5 ? color : EFFECT_COLORS.dustDark,
        size: radius * (0.14 + Math.random() * 0.2),
        life: 0.6 + Math.random() * 0.6,
      });
    }
  }

  /** A fireball with smoke, sparks and a shock ring. */
  explosion(position: THREE.Vector3, radius: number): void {
    const velocity = new THREE.Vector3();
    const start = new THREE.Vector3();
    this.puff({
      position,
      velocity: velocity.set(0, 2, 0),
      color: EFFECT_COLORS.fireHot,
      size: radius * 0.5,
      life: 0.3,
      glowing: true,
      drag: 0,
    });
    for (let i = 0; i < 22; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const lift = Math.random();
      const speed = radius * (0.9 + Math.random() * 1.3);
      velocity.set(
        Math.cos(angle) * speed * (1 - lift * 0.6),
        radius * (0.5 + lift * 1.2),
        Math.sin(angle) * speed * (1 - lift * 0.6),
      );
      const hot = i % 3;
      this.puff({
        position: start.copy(position).addScaledVector(velocity, 0.02),
        velocity,
        color:
          hot === 0
            ? EFFECT_COLORS.fireHot
            : hot === 1
              ? EFFECT_COLORS.fire
              : EFFECT_COLORS.fireDeep,
        size: radius * (0.14 + Math.random() * 0.2),
        life: 0.35 + Math.random() * 0.35,
        glowing: true,
        drag: 3.2,
      });
    }
    for (let i = 0; i < 16; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = radius * (0.3 + Math.random() * 0.5);
      velocity.set(
        Math.cos(angle) * speed,
        radius * (0.35 + Math.random() * 0.5),
        Math.sin(angle) * speed,
      );
      this.puff({
        position: start.copy(position).setY(position.y + 1 + Math.random() * 2),
        velocity,
        color: i % 2 === 0 ? EFFECT_COLORS.smoke : EFFECT_COLORS.dustDark,
        size: radius * (0.2 + Math.random() * 0.22),
        life: 1.1 + Math.random() * 0.9,
        drag: 1.8,
      });
    }
    this.sparks(position, 14, radius * 1.6);
    this.ring(position, radius);
  }

  /** Bright bits that fly off and fall, for example when metal hits concrete. */
  sparks(position: THREE.Vector3, count: number, speed = 14): void {
    const velocity = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const power = speed * (0.4 + Math.random() * 0.6);
      velocity.set(
        Math.cos(angle) * power,
        speed * (0.3 + Math.random() * 0.7),
        Math.sin(angle) * power,
      );
      this.puff({
        position,
        velocity,
        color: EFFECT_COLORS.spark,
        size: 0.25 + Math.random() * 0.25,
        life: 0.35 + Math.random() * 0.4,
        glowing: true,
        weight: 1,
        drag: 0.4,
      });
    }
  }

  /** A few leaves, where a vehicle flattens a hedge. */
  leaves(position: THREE.Vector3): void {
    const velocity = new THREE.Vector3();
    for (let i = 0; i < 4; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      velocity.set(Math.cos(angle) * 4, 4 + Math.random() * 5, Math.sin(angle) * 4);
      this.puff({
        position,
        velocity,
        color: EFFECT_COLORS.leaves,
        size: 0.35 + Math.random() * 0.4,
        life: 0.5 + Math.random() * 0.4,
        weight: 0.8,
      });
    }
  }

  /** A flat ring that races outwards along the ground and fades. */
  ring(position: THREE.Vector3, radius: number, color: number = EFFECT_COLORS.fireHot): void {
    const ring = this.rings.reduce((oldest, candidate) =>
      candidate.life - candidate.age < oldest.life - oldest.age ? candidate : oldest,
    );
    ring.age = 0;
    ring.life = 0.45;
    ring.radius = radius;
    ring.material.color.setHex(color);
    ring.mesh.position.copy(position).setY(position.y + 0.3);
    ring.mesh.visible = true;
  }

  /** Advances every particle. Call it once per frame with the frame time in seconds. */
  update(frameSeconds: number): void {
    let litChanged = false;
    let glowChanged = false;
    for (let i = 0; i < PUFF_CAPACITY; i += 1) {
      const puff = this.puffs[i];
      if (!puff.alive) {
        continue;
      }
      puff.age += frameSeconds;
      const mesh = puff.glowing ? this.glow : this.lit;
      if (puff.age >= puff.life) {
        puff.alive = false;
        mesh.setMatrixAt(i, this.hidden);
      } else {
        puff.velocity.multiplyScalar(Math.exp(-puff.drag * frameSeconds));
        puff.velocity.y -= GRAVITY * puff.weight * frameSeconds;
        puff.position.addScaledVector(puff.velocity, frameSeconds);
        // Grow fast in the first fifth of the life, then shrink to nothing.
        const t = puff.age / puff.life;
        const size = puff.size * (t < 0.2 ? 0.4 + (t / 0.2) * 0.6 : 1 - ((t - 0.2) / 0.8) ** 2);
        this.rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, i + puff.age * 2);
        this.matrix.compose(
          puff.position,
          this.rotation,
          this.scale.setScalar(Math.max(size, 0.001)),
        );
        mesh.setMatrixAt(i, this.matrix);
      }
      if (puff.glowing) {
        glowChanged = true;
      } else {
        litChanged = true;
      }
    }
    if (litChanged) {
      this.lit.instanceMatrix.needsUpdate = true;
      if (this.lit.instanceColor) {
        this.lit.instanceColor.needsUpdate = true;
      }
    }
    if (glowChanged) {
      this.glow.instanceMatrix.needsUpdate = true;
      if (this.glow.instanceColor) {
        this.glow.instanceColor.needsUpdate = true;
      }
    }

    for (const ring of this.rings) {
      if (!ring.mesh.visible) {
        continue;
      }
      ring.age += frameSeconds;
      const t = ring.age / ring.life;
      if (t >= 1) {
        ring.mesh.visible = false;
        continue;
      }
      const size = ring.radius * (0.2 + 0.8 * Math.sqrt(t));
      ring.mesh.scale.set(size, 1, size);
      ring.material.opacity = (1 - t) * 0.85;
    }
  }
}
