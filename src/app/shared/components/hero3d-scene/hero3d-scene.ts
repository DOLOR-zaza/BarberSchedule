import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';
import * as THREE from 'three';

/**
 * Hero 3D — poste de barbería con illusion effect hipnotizante.
 *
 * ════════════════════════════════════════════════════════════
 *  LA FÓRMULA MÁGICA
 * ════════════════════════════════════════════════════════════
 *
 *   phase = v * turns - u + time * speed
 *   bandIdx = floor(phase mod 1 * bands)
 *
 *  Donde:
 *   u = x / W   (0 a 1) → normalizada horizontal
 *   v = y / H   (0 a 1) → normalizada vertical
 *   turns = número de vueltas verticales de la hélice
 *   bands = 4 (R, W, B, W)
 *   time * speed = ANIMACIÓN de la fase
 *
 *  El truco: la animación de `time * speed` SUMADA a la fase
 *  hace que las franjas aparenten SUBIR por el cilindro, aunque
 *  la geometría NO esté rotando. El cerebro interpreta la
 *  espiral moviéndose como rotación + traslación.
 *
 *  Además, se agrega sombreado cilíndrico BAKED en la textura
 *  (oscurecimiento en bordes, highlight al medio) para que las
 *  franjas se vean curvadas sobre el cilindro.
 */
@Component({
  selector: 'app-hero3d-scene',
  template: `
    <div #host class="absolute inset-0"></div>
    @if (loading()) {
      <div class="absolute inset-0 grid place-items-center text-7xl animate-pulse">
        💈
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Hero3dScene implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  protected readonly loading = signal(true);

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private pole?: THREE.Group;
  private poleMat?: THREE.MeshStandardMaterial;
  private poleTexture?: THREE.CanvasTexture;
  private textureCanvas?: HTMLCanvasElement;
  private textureCtx?: CanvasRenderingContext2D;
  private frameId = 0;
  private resizeObserver?: ResizeObserver;
  private readonly startTime = performance.now();

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;
    this.init();
    this.animate();
    setTimeout(() => this.loading.set(false), 200);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    this.scene?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    });
  }

  // ──────────────────────────────────────────────
  //  Inicialización
  // ──────────────────────────────────────────────
  private init(): void {
    const el = this.host.nativeElement;
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 600;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    el.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 100);
    this.camera.position.set(0, 0, 9);
    this.camera.lookAt(0, 0, 0);

    // Lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const key = new THREE.DirectionalLight(0xfff5e0, 1.5);
    key.position.set(4, 5, 6);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xff9a3c, 0.45);
    fill.position.set(-4, -2, 3);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xb5641f, 0.4);
    rim.position.set(0, 2, -6);
    this.scene.add(rim);

    // Construir el poste
    this.pole = this.buildBarberPole();
    this.scene.add(this.pole);

    // ResizeObserver
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(el);
  }

  private onResize(): void {
    if (!this.renderer || !this.camera || !this.host) return;
    const w = this.host.nativeElement.clientWidth;
    const h = this.host.nativeElement.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ──────────────────────────────────────────────
  //  Construcción del poste
  // ──────────────────────────────────────────────
  private buildBarberPole(): THREE.Group {
    const group = new THREE.Group();

    const poleHeight = 2.8;
    const poleRadius = 0.34;

    // ── Canvas + textura animada
    // W:H ratio pensado para que la textura envuelva bien el cilindro
    // (W = circunferencia, H = altura)
    const W = 768, H = 1024;
    this.textureCanvas = document.createElement('canvas');
    this.textureCanvas.width = W;
    this.textureCanvas.height = H;
    this.textureCtx = this.textureCanvas.getContext('2d')!;

    this.poleTexture = new THREE.CanvasTexture(this.textureCanvas);
    this.poleTexture.colorSpace = THREE.SRGBColorSpace;
    this.poleTexture.anisotropy = 16;

    // ── Cilindro principal
    const poleGeo = new THREE.CylinderGeometry(
      poleRadius, poleRadius, poleHeight, 128, 1, false
    );
    this.poleMat = new THREE.MeshStandardMaterial({
      map: this.poleTexture,
      metalness: 0.12,
      roughness: 0.38,
    });
    const pole = new THREE.Mesh(poleGeo, this.poleMat);
    pole.castShadow = true;
    pole.receiveShadow = true;
    group.add(pole);

    // ── Material dorado
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xf5b942,
      metalness: 0.95,
      roughness: 0.16,
    });

    // ── Caparazones
    const capGeo = new THREE.CylinderGeometry(
      poleRadius + 0.06, poleRadius + 0.06, 0.12, 64
    );
    const topCap = new THREE.Mesh(capGeo, goldMat);
    topCap.position.y = poleHeight / 2 + 0.06;
    group.add(topCap);

    const bottomCap = new THREE.Mesh(capGeo, goldMat);
    bottomCap.position.y = -poleHeight / 2 - 0.06;
    group.add(bottomCap);

    // ── Bola decorativa arriba
    const ballGeo = new THREE.SphereGeometry(0.22, 48, 48);
    const ball = new THREE.Mesh(ballGeo, goldMat);
    ball.position.y = poleHeight / 2 + 0.32;
    group.add(ball);

    // ── Glow alrededor de la bola
    const glow = this.createGlowSprite();
    glow.position.y = poleHeight / 2 + 0.32;
    group.add(glow);

    // ── Cuello decorativo
    const neckGeo = new THREE.CylinderGeometry(0.06, 0.12, 0.2, 32);
    const neck = new THREE.Mesh(neckGeo, goldMat);
    neck.position.y = poleHeight / 2 + 0.18;
    group.add(neck);

    // ── Anillos decorativos
    for (let i = -1; i <= 1; i++) {
      const ringGeo = new THREE.TorusGeometry(poleRadius + 0.025, 0.022, 16, 64);
      const ring = new THREE.Mesh(ringGeo, goldMat);
      ring.position.y = i * 0.75;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }

    // ── Base cuadrada
    const baseGeo = new THREE.BoxGeometry(1.0, 0.28, 1.0);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1c1917,
      metalness: 0.35,
      roughness: 0.65,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -poleHeight / 2 - 0.24;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // ── Embellecedor dorado
    const trimGeo = new THREE.BoxGeometry(1.12, 0.05, 1.12);
    const trim = new THREE.Mesh(trimGeo, goldMat);
    trim.position.y = -poleHeight / 2 - 0.09;
    group.add(trim);

    return group;
  }

  // ──────────────────────────────────────────────
  //  ⭐ TEXTURA ANIMADA — la magia del illusion effect
  // ──────────────────────────────────────────────
  /**
   * Regenera la textura del poste usando coordenadas normalizadas
   * u/v y una fase animada en el tiempo. El resultado es que las
   * franjas aparentan SUBIR por el cilindro sin necesidad de que
   * la geometría rote.
   *
   * La fase se calcula como:
   *   phase = v * turns - u + time * speed
   *
   * donde:
   *   - `v * turns` repite la hélice `turns` veces en vertical
   *   - `-u`     crea la diagonal (helix wrap)
   *   - `+ time` anima la fase, simulando traslación hacia arriba
   */
  private updatePoleTexture(time: number): void {
    if (!this.textureCtx || !this.textureCanvas) return;
    const ctx = this.textureCtx;
    const canvas = this.textureCanvas;
    const W = canvas.width;
    const H = canvas.height;

    const imageData = ctx.createImageData(W, H);
    const data = imageData.data;

    // ── Colores (tonos vintage de barber pole, más cálidos)
    const RED = [220, 32, 38, 255]   as const;   // crimson
    const BLU = [24, 70, 192, 255]   as const;   // deep blue
    const WHT = [250, 250, 245, 255] as const;   // ivory

    // ── Parámetros
    const turns = 4;         // 4 vueltas verticales de la hélice
    const bands = 4;         // R, W, B, W
    const speed = 0.32;      // velocidad de la ilusión de rotación

    // Iterar pixel por pixel
    for (let y = 0; y < H; y++) {
      const v = y / H;
      // v * turns es la fase base (cuántas vueltas a lo largo del alto)
      // Sumamos time * speed para animar
      // Sumamos -u más adelante para la diagonal
      const baseV = v * turns + time * speed;

      for (let x = 0; x < W; x++) {
        const u = x / W;
        // phase con la diagonal (-u) que crea la hélice
        let phase = baseV - u;
        // Wrap a [0, 1)
        phase = phase - Math.floor(phase);
        // Banda actual
        const bandIdx = Math.floor(phase * bands);

        let color: readonly [number, number, number, number] = WHT;
        if (bandIdx === 0)      color = RED;
        else if (bandIdx === 2) color = BLU;

        // ── Sombreado cilíndrico BAKED en la textura
        // u = 0 es el borde izquierdo del cilindro (oscuro)
        // u = 0.5 es el centro (más iluminado)
        // u = 1 es el borde derecho (oscuro)
        const cx = (u - 0.5) * 2;          // -1 a 1
        const edgeShadow = Math.abs(cx);    // 0 al centro, 1 en los bordes
        // Highlight sutil desplazado al 32% (luz desde la derecha-izquierda)
        const highlight = Math.exp(-Math.pow((u - 0.32) * 7, 2));
        // Sombreado vertical sutil (más oscuro en los extremos verticales)
        const vEdge = Math.abs(v - 0.5) * 2;  // 0 al centro vertical, 1 en extremos
        const vShadow = vEdge * 0.15;

        // Componer luz
        let light = 1.0 - edgeShadow * 0.35 + highlight * 0.35 - vShadow;
        light = Math.max(0.45, Math.min(1.25, light));

        const idx = (y * W + x) * 4;
        data[idx]     = Math.min(255, color[0] * light);
        data[idx + 1] = Math.min(255, color[1] * light);
        data[idx + 2] = Math.min(255, color[2] * light);
        data[idx + 3] = color[3];
      }
    }

    ctx.putImageData(imageData, 0, 0);
    if (this.poleTexture) this.poleTexture.needsUpdate = true;
  }

  /**
   * Crea un sprite con gradient radial — glow cálido
   * alrededor de la bola dorada.
   */
  private createGlowSprite(): THREE.Sprite {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    );
    grad.addColorStop(0,    'rgba(255, 220, 130, 0.9)');
    grad.addColorStop(0.15, 'rgba(255, 180, 70, 0.5)');
    grad.addColorStop(0.4,  'rgba(255, 140, 40, 0.15)');
    grad.addColorStop(1,    'rgba(255, 100, 30, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.9, 0.9, 0.9);
    return sprite;
  }

  // ──────────────────────────────────────────────
  //  Render loop — la textura se anima, no la geometría
  // ──────────────────────────────────────────────
  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);

    // Regenerar textura con el tiempo actual
    const t = (performance.now() - this.startTime) * 0.001;
    this.updatePoleTexture(t);

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
