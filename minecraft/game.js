(function () {
  'use strict';

  // ---------- Constants ----------
  const CHUNK_SIZE = 16;
  const CHUNKS_X = 5;
  const CHUNKS_Z = 5;
  const WORLD_X = CHUNK_SIZE * CHUNKS_X; // 80
  const WORLD_Y = 48;
  const WORLD_Z = CHUNK_SIZE * CHUNKS_Z; // 80
  const SEA_LEVEL = 15;
  const SAVE_KEY = 'voxelcraft_web_save_v1';

  const BLOCK = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    WOOD: 4,
    LEAVES: 5,
    SAND: 6,
    WATER: 7,
    PLANK: 8,
    BRICK: 9,
    GLASS: 10,
    COBBLE: 11,
    GLOWSTONE: 12,
    BEDROCK: 13
  };

  // Atlas tile indices (4x4 grid, 16 tiles)
  const TILE = {
    GRASS_TOP: 0,
    GRASS_SIDE: 1,
    DIRT: 2,
    STONE: 3,
    WOOD_SIDE: 4,
    WOOD_TOP: 5,
    LEAVES: 6,
    SAND: 7,
    WATER: 8,
    PLANK: 9,
    BRICK: 10,
    GLASS: 11,
    COBBLE: 12,
    GLOWSTONE: 13,
    BEDROCK: 14
  };

  const BLOCK_INFO = {
    [BLOCK.GRASS]: { name: '草方块', top: TILE.GRASS_TOP, bottom: TILE.DIRT, side: TILE.GRASS_SIDE },
    [BLOCK.DIRT]: { name: '泥土', top: TILE.DIRT, bottom: TILE.DIRT, side: TILE.DIRT },
    [BLOCK.STONE]: { name: '石头', top: TILE.STONE, bottom: TILE.STONE, side: TILE.STONE },
    [BLOCK.WOOD]: { name: '橡木原木', top: TILE.WOOD_TOP, bottom: TILE.WOOD_TOP, side: TILE.WOOD_SIDE },
    [BLOCK.LEAVES]: { name: '树叶', top: TILE.LEAVES, bottom: TILE.LEAVES, side: TILE.LEAVES },
    [BLOCK.SAND]: { name: '沙子', top: TILE.SAND, bottom: TILE.SAND, side: TILE.SAND },
    [BLOCK.WATER]: { name: '水', top: TILE.WATER, bottom: TILE.WATER, side: TILE.WATER, translucent: true },
    [BLOCK.PLANK]: { name: '木板', top: TILE.PLANK, bottom: TILE.PLANK, side: TILE.PLANK },
    [BLOCK.BRICK]: { name: '红砖块', top: TILE.BRICK, bottom: TILE.BRICK, side: TILE.BRICK },
    [BLOCK.GLASS]: { name: '玻璃', top: TILE.GLASS, bottom: TILE.GLASS, side: TILE.GLASS, transparent: true },
    [BLOCK.COBBLE]: { name: '圆石', top: TILE.COBBLE, bottom: TILE.COBBLE, side: TILE.COBBLE },
    [BLOCK.GLOWSTONE]: { name: '荧石', top: TILE.GLOWSTONE, bottom: TILE.GLOWSTONE, side: TILE.GLOWSTONE },
    [BLOCK.BEDROCK]: { name: '基岩', top: TILE.BEDROCK, bottom: TILE.BEDROCK, side: TILE.BEDROCK, unbreakable: true }
  };

  const HOTBAR_BLOCKS = [
    BLOCK.GRASS,
    BLOCK.DIRT,
    BLOCK.STONE,
    BLOCK.COBBLE,
    BLOCK.PLANK,
    BLOCK.WOOD,
    BLOCK.BRICK,
    BLOCK.GLASS,
    BLOCK.GLOWSTONE
  ];

  // ---------- Sound Synthesizer (Zero external assets) ----------
  let audioCtx = null;
  let soundEnabled = true;

  function unlockAudio() {
    if (!soundEnabled) return;
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function playTone(freq, duration, type, gainVal) {
    if (!soundEnabled || !audioCtx || audioCtx.state !== 'running') return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), now + duration);
    gain.gain.setValueAtTime(gainVal || 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  // ---------- Math & Noise ----------
  function hash2(x, z) {
    let n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function smoothNoise(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz);
    const b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1);
    const d = hash2(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }

  function fbm(x, z) {
    let v = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < 4; i++) {
      v += amp * smoothNoise(x * freq, z * freq);
      freq *= 2.02;
      amp *= 0.5;
    }
    return v;
  }

  function mat4Perspective(fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function mat4View(px, py, pz, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    // Camera basis (right, up, back)
    const rx = cy, ry = 0, rz = -sy;
    const ux = sy * sp, uy = cp, uz = cy * sp;
    const bx = sy * cp, by = -sp, bz = cy * cp;

    return new Float32Array([
      rx, ux, bx, 0,
      ry, uy, by, 0,
      rz, uz, bz, 0,
      -(rx * px + ry * py + rz * pz),
      -(ux * px + uy * py + uz * pz),
      -(bx * px + by * py + bz * pz),
      1
    ]);
  }

  // ---------- Procedural Pixel Art Atlas (64x64) ----------
  function createAtlasCanvas() {
    const size = 64;
    const tile = 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    function rand(x, y, s) {
      return hash2(x * 13.7 + s * 31.1, y * 19.3 + s * 7.9);
    }

    function drawTile(idx, fn) {
      const ox = (idx % 4) * tile;
      const oy = Math.floor(idx / 4) * tile;
      for (let y = 0; y < tile; y++) {
        for (let x = 0; x < tile; x++) {
          ctx.fillStyle = fn(x, y, rand(x, y, idx));
          ctx.fillRect(ox + x, oy + y, 1, 1);
        }
      }
    }

    // 0: Grass Top
    drawTile(TILE.GRASS_TOP, (x, y, r) => {
      const g = 148 + Math.floor(r * 38);
      return `rgb(${78 + Math.floor(r * 22)},${g},${54 + Math.floor(r * 18)})`;
    });

    // 1: Grass Side
    drawTile(TILE.GRASS_SIDE, (x, y, r) => {
      const edge = 3 + Math.floor(hash2(x, 99) * 2);
      if (y < edge) {
        return `rgb(${80 + Math.floor(r * 20)},${152 + Math.floor(r * 34)},${58 + Math.floor(r * 16)})`;
      }
      return `rgb(${118 + Math.floor(r * 26)},${82 + Math.floor(r * 22)},${54 + Math.floor(r * 16)})`;
    });

    // 2: Dirt
    drawTile(TILE.DIRT, (x, y, r) => `rgb(${116 + Math.floor(r * 28)},${80 + Math.floor(r * 22)},${52 + Math.floor(r * 16)})`);

    // 3: Stone
    drawTile(TILE.STONE, (x, y, r) => {
      const v = 112 + Math.floor(r * 32);
      return `rgb(${v},${v},${v + 4})`;
    });

    // 4: Wood Side
    drawTile(TILE.WOOD_SIDE, (x, y, r) => {
      const stripe = (x % 4 === 0) ? -14 : 0;
      return `rgb(${98 + stripe + Math.floor(r * 16)},${66 + stripe + Math.floor(r * 12)},${38 + Math.floor(r * 10)})`;
    });

    // 5: Wood Top
    drawTile(TILE.WOOD_TOP, (x, y, r) => {
      const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
      const d = Math.max(dx, dy);
      if (d > 6.2) return `rgb(${86 + Math.floor(r * 14)},${58 + Math.floor(r * 10)},${34})`;
      const ring = (Math.floor(d) % 2 === 0) ? 14 : 0;
      return `rgb(${156 + ring + Math.floor(r * 16)},${118 + ring + Math.floor(r * 12)},${74})`;
    });

    // 6: Leaves
    drawTile(TILE.LEAVES, (x, y, r) => {
      if (r < 0.18) return 'rgb(34,82,34)';
      return `rgb(${44 + Math.floor(r * 24)},${118 + Math.floor(r * 36)},${44 + Math.floor(r * 20)})`;
    });

    // 7: Sand
    drawTile(TILE.SAND, (x, y, r) => `rgb(${214 + Math.floor(r * 22)},${198 + Math.floor(r * 20)},${142 + Math.floor(r * 20)})`);

    // 8: Water
    drawTile(TILE.WATER, (x, y, r) => {
      const wave = ((x + y) % 5 === 0) ? 18 : 0;
      return `rgba(${38 + wave},${126 + wave},${218 + Math.floor(r * 20)},0.76)`;
    });

    // 9: Plank
    drawTile(TILE.PLANK, (x, y, r) => {
      const seam = (y % 4 === 0 || (x === 0 && Math.floor(y / 4) % 2 === 0) || (x === 8 && Math.floor(y / 4) % 2 === 1)) ? -26 : 0;
      return `rgb(${172 + seam + Math.floor(r * 14)},${128 + seam + Math.floor(r * 12)},${74 + Math.floor(r * 10)})`;
    });

    // 10: Brick
    drawTile(TILE.BRICK, (x, y, r) => {
      const mortar = (y % 4 === 0) || (x === 0 && Math.floor(y / 4) % 2 === 0) || (x === 8 && Math.floor(y / 4) % 2 === 1);
      if (mortar) return `rgb(${198 + Math.floor(r * 16)},${194 + Math.floor(r * 16)},${188})`;
      return `rgb(${164 + Math.floor(r * 26)},${74 + Math.floor(r * 16)},${62 + Math.floor(r * 12)})`;
    });

    // 11: Glass
    drawTile(TILE.GLASS, (x, y, r) => {
      const border = x === 0 || x === 15 || y === 0 || y === 15;
      const glint = (x + y === 5 || x + y === 6) && x > 2 && x < 7;
      if (border) return 'rgb(185,225,245)';
      if (glint) return 'rgb(235,250,255)';
      return `rgb(${145 + Math.floor(r * 12)},${205 + Math.floor(r * 12)},232)`;
    });

    // 12: Cobblestone
    drawTile(TILE.COBBLE, (x, y, r) => {
      const dark = ((x + y * 2) % 5 === 0 || (x * 2 - y + 16) % 7 === 0) ? -28 : 0;
      const v = 115 + dark + Math.floor(r * 28);
      return `rgb(${v},${v},${v + 2})`;
    });

    // 13: Glowstone
    drawTile(TILE.GLOWSTONE, (x, y, r) => {
      const bright = r > 0.35;
      return bright
        ? `rgb(${245},${215 + Math.floor(r * 35)},${110 + Math.floor(r * 50)})`
        : `rgb(${180 + Math.floor(r * 20)},${130 + Math.floor(r * 20)},65)`;
    });

    // 14: Bedrock
    drawTile(TILE.BEDROCK, (x, y, r) => {
      const v = 35 + Math.floor(r * 52);
      return `rgb(${v},${v},${v})`;
    });

    return canvas;
  }

  // ---------- World Data & Persistence ----------
  const world = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
  let blockDeltas = {};

  function idx(x, y, z) {
    return (y * WORLD_Z + z) * WORLD_X + x;
  }

  function inBounds(x, y, z) {
    return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y && z >= 0 && z < WORLD_Z;
  }

  function getBlock(x, y, z) {
    if (!inBounds(x, y, z)) return BLOCK.AIR;
    return world[idx(x, y, z)];
  }

  function setBlockRaw(x, y, z, b) {
    if (!inBounds(x, y, z)) return;
    world[idx(x, y, z)] = b;
  }

  function generateTerrain() {
    world.fill(BLOCK.AIR);
    for (let x = 0; x < WORLD_X; x++) {
      for (let z = 0; z < WORLD_Z; z++) {
        const n = fbm(x * 0.038 + 4.2, z * 0.038 + 9.7);
        const h = Math.floor(11 + n * 16);
        setBlockRaw(x, 0, z, BLOCK.BEDROCK);
        for (let y = 1; y <= h; y++) {
          if (y < h - 3) {
            setBlockRaw(x, y, z, BLOCK.STONE);
          } else if (y < h) {
            setBlockRaw(x, y, z, h <= SEA_LEVEL + 1 ? BLOCK.SAND : BLOCK.DIRT);
          } else {
            setBlockRaw(x, y, z, h <= SEA_LEVEL + 1 ? BLOCK.SAND : BLOCK.GRASS);
          }
        }
        if (h < SEA_LEVEL) {
          for (let y = h + 1; y <= SEA_LEVEL; y++) {
            setBlockRaw(x, y, z, BLOCK.WATER);
          }
        }
      }
    }

    // Place deterministic trees
    for (let x = 4; x < WORLD_X - 4; x += 5) {
      for (let z = 4; z < WORLD_Z - 4; z += 5) {
        if (hash2(x * 3.1, z * 5.7) < 0.62) continue;
        const tx = x + Math.floor(hash2(x, z) * 3) - 1;
        const tz = z + Math.floor(hash2(z, x) * 3) - 1;
        let topY = -1;
        for (let y = WORLD_Y - 8; y >= SEA_LEVEL + 2; y--) {
          if (getBlock(tx, y, tz) === BLOCK.GRASS) {
            topY = y;
            break;
          }
        }
        if (topY < 0) continue;
        const trunkH = 4 + Math.floor(hash2(tx, tz) * 2);
        for (let i = 1; i <= trunkH; i++) {
          setBlockRaw(tx, topY + i, tz, BLOCK.WOOD);
        }
        const leafBase = topY + trunkH - 1;
        for (let dy = 0; dy <= 2; dy++) {
          const rad = dy === 2 ? 1 : 2;
          for (let dx = -rad; dx <= rad; dx++) {
            for (let dz = -rad; dz <= rad; dz++) {
              if (dy === 0 && dx === 0 && dz === 0) continue;
              if (Math.abs(dx) === rad && Math.abs(dz) === rad && hash2(dx + tx, dz + tz) < 0.45) continue;
              if (getBlock(tx + dx, leafBase + dy, tz + dz) === BLOCK.AIR) {
                setBlockRaw(tx + dx, leafBase + dy, tz + dz, BLOCK.LEAVES);
              }
            }
          }
        }
      }
    }
  }

  function applySavedState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.deltas) {
        blockDeltas = data.deltas;
        for (const key in blockDeltas) {
          const parts = key.split(',');
          if (parts.length === 3) {
            setBlockRaw(parts[0] | 0, parts[1] | 0, parts[2] | 0, blockDeltas[key] | 0);
          }
        }
      }
      return data.player || null;
    } catch (_) {
      return null;
    }
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          deltas: blockDeltas,
          player: {
            x: +player.x.toFixed(2),
            y: +player.y.toFixed(2),
            z: +player.z.toFixed(2),
            yaw: +player.yaw.toFixed(3),
            pitch: +player.pitch.toFixed(3)
          }
        }));
      } catch (_) {}
    }, 300);
  }

  // ---------- WebGL Setup ----------
  const canvas = document.getElementById('game-canvas');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) {
    alert('当前浏览器不支持 WebGL，无法运行 3D 游戏。');
    return;
  }

  function compileShader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function createProgram(vsSrc, fsSrc) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    return prog;
  }

  const worldProg = createProgram(
    `
    attribute vec3 aPos;
    attribute vec2 aUV;
    attribute float aShade;
    uniform mat4 uProj;
    uniform mat4 uView;
    varying vec2 vUV;
    varying float vShade;
    varying float vDist;
    void main() {
      vec4 viewPos = uView * vec4(aPos, 1.0);
      vDist = length(viewPos.xyz);
      vUV = aUV;
      vShade = aShade;
      gl_Position = uProj * viewPos;
    }
    `,
    `
    precision mediump float;
    uniform sampler2D uTex;
    uniform vec3 uFogColor;
    uniform float uFogStart;
    uniform float uFogEnd;
    varying vec2 vUV;
    varying float vShade;
    varying float vDist;
    void main() {
      vec4 tex = texture2D(uTex, vUV);
      if (tex.a < 0.05) discard;
      vec3 col = tex.rgb * vShade;
      float fogFactor = clamp((vDist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
      col = mix(col, uFogColor, fogFactor);
      gl_FragColor = vec4(col, tex.a);
    }
    `
  );

  const lineProg = createProgram(
    `
    attribute vec3 aPos;
    uniform mat4 uProj;
    uniform mat4 uView;
    void main() {
      gl_Position = uProj * uView * vec4(aPos, 1.0);
    }
    `,
    `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(0.1, 0.1, 0.1, 0.9);
    }
    `
  );

  // Upload Atlas Texture
  const atlasCanvas = createAtlasCanvas();
  const atlasTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Wireframe selection box buffer
  const boxVerts = new Float32Array([
    0,0,0, 1,0,0,  1,0,0, 1,0,1,  1,0,1, 0,0,1,  0,0,1, 0,0,0,
    0,1,0, 1,1,0,  1,1,0, 1,1,1,  1,1,1, 0,1,1,  0,1,1, 0,1,0,
    0,0,0, 0,1,0,  1,0,0, 1,1,0,  1,0,1, 1,1,1,  0,0,1, 0,1,1
  ]);
  const boxVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, boxVBO);
  gl.bufferData(gl.ARRAY_BUFFER, boxVerts, gl.STATIC_DRAW);

  // ---------- Chunk Mesher ----------
  const chunks = [];
  const FACES = [
    // +Y top
    { dir: [0, 1, 0], shade: 1.0, role: 'top', verts: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
    // -Y bottom
    { dir: [0, -1, 0], shade: 0.55, role: 'bottom', verts: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
    // +X right
    { dir: [1, 0, 0], shade: 0.78, role: 'side', verts: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] },
    // -X left
    { dir: [-1, 0, 0], shade: 0.78, role: 'side', verts: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
    // +Z front
    { dir: [0, 0, 1], shade: 0.88, role: 'side', verts: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
    // -Z back
    { dir: [0, 0, -1], shade: 0.88, role: 'side', verts: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] }
  ];

  function isOpaque(b) {
    return b !== BLOCK.AIR && b !== BLOCK.WATER && b !== BLOCK.GLASS;
  }

  function buildChunkMesh(cx, cz) {
    const chunk = chunks[cz * CHUNKS_X + cx];
    const opV = [], opI = [];
    const trV = [], trI = [];

    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const x = x0 + lx;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const z = z0 + lz;
        for (let y = 0; y < WORLD_Y; y++) {
          const b = getBlock(x, y, z);
          if (b === BLOCK.AIR) continue;
          const info = BLOCK_INFO[b];
          const isWater = b === BLOCK.WATER;
          const vArr = isWater ? trV : opV;
          const iArr = isWater ? trI : opI;

          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nx = x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = z + face.dir[2];
            const nb = getBlock(nx, ny, nz);

            if (isWater) {
              if (nb === BLOCK.WATER || isOpaque(nb)) continue;
            } else if (b === BLOCK.GLASS) {
              if (nb === BLOCK.GLASS || isOpaque(nb)) continue;
            } else {
              if (isOpaque(nb)) continue;
            }

            const tileIdx = info[face.role];
            const tx = (tileIdx % 4) * 0.25;
            const ty = Math.floor(tileIdx / 4) * 0.25;
            const pad = 0.002;
            const u0 = tx + pad, u1 = tx + 0.25 - pad;
            const v0 = ty + pad, v1 = ty + 0.25 - pad;
            const uvs = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];

            const base = vArr.length / 6;
            const yTopDrop = (isWater && f === 0 && nb === BLOCK.AIR) ? -0.12 : 0;

            for (let k = 0; k < 4; k++) {
              const pt = face.verts[k];
              vArr.push(
                x + pt[0],
                y + pt[1] + (pt[1] === 1 ? yTopDrop : 0),
                z + pt[2],
                uvs[k][0],
                uvs[k][1],
                face.shade
              );
            }
            iArr.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }

    function uploadMesh(vArr, iArr, old) {
      if (old && old.vbo) gl.deleteBuffer(old.vbo);
      if (old && old.ibo) gl.deleteBuffer(old.ibo);
      if (iArr.length === 0) return { vbo: null, ibo: null, count: 0 };
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vArr), gl.STATIC_DRAW);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(iArr), gl.STATIC_DRAW);
      return { vbo, ibo, count: iArr.length };
    }

    chunk.opaque = uploadMesh(opV, opI, chunk.opaque);
    chunk.translucent = uploadMesh(trV, trI, chunk.translucent);
    chunk.dirty = false;
  }

  function markChunkDirtyAt(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const list = [[cx, cz]];
    if (x % CHUNK_SIZE === 0) list.push([cx - 1, cz]);
    if (x % CHUNK_SIZE === CHUNK_SIZE - 1) list.push([cx + 1, cz]);
    if (z % CHUNK_SIZE === 0) list.push([cx, cz - 1]);
    if (z % CHUNK_SIZE === CHUNK_SIZE - 1) list.push([cx, cz + 1]);
    for (const [qx, qz] of list) {
      if (qx >= 0 && qx < CHUNKS_X && qz >= 0 && qz < CHUNKS_Z) {
        chunks[qz * CHUNKS_X + qx].dirty = true;
      }
    }
  }

  // ---------- Initialize World ----------
  for (let cz = 0; cz < CHUNKS_Z; cz++) {
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      chunks.push({ cx, cz, dirty: true, opaque: null, translucent: null });
    }
  }

  generateTerrain();
  const savedPlayer = applySavedState();

  function findSpawnHeight(x, z) {
    for (let y = WORLD_Y - 2; y >= 1; y--) {
      const b = getBlock(x, y, z);
      if (b !== BLOCK.AIR && b !== BLOCK.WATER) return y + 1.05;
    }
    return 25;
  }

  const player = {
    x: savedPlayer ? savedPlayer.x : WORLD_X * 0.5 + 0.5,
    y: savedPlayer ? savedPlayer.y : findSpawnHeight(Math.floor(WORLD_X * 0.5), Math.floor(WORLD_Z * 0.5)),
    z: savedPlayer ? savedPlayer.z : WORLD_Z * 0.5 + 0.5,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: savedPlayer ? savedPlayer.yaw : 0.6,
    pitch: savedPlayer ? savedPlayer.pitch : -0.15,
    onGround: false,
    selectedSlot: 0
  };

  // ---------- Physics & Raycast ----------
  function isSolid(x, y, z) {
    const b = getBlock(x, y, z);
    return b !== BLOCK.AIR && b !== BLOCK.WATER;
  }

  function collidesAt(px, py, pz) {
    const hw = 0.28;
    const h = 1.72;
    const minX = Math.floor(px - hw), maxX = Math.floor(px + hw);
    const minY = Math.floor(py), maxY = Math.floor(py + h);
    const minZ = Math.floor(pz - hw), maxZ = Math.floor(pz + hw);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (isSolid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  function getLookDir() {
    const cp = Math.cos(player.pitch);
    return [
      -Math.sin(player.yaw) * cp,
      Math.sin(player.pitch),
      -Math.cos(player.yaw) * cp
    ];
  }

  function raycastBlock(maxDist) {
    const eyeX = player.x;
    const eyeY = player.y + 1.54;
    const eyeZ = player.z;
    const dir = getLookDir();
    const step = 0.05;
    let prevX = Math.floor(eyeX);
    let prevY = Math.floor(eyeY);
    let prevZ = Math.floor(eyeZ);

    for (let d = 0; d <= maxDist; d += step) {
      const rx = Math.floor(eyeX + dir[0] * d);
      const ry = Math.floor(eyeY + dir[1] * d);
      const rz = Math.floor(eyeZ + dir[2] * d);
      const b = getBlock(rx, ry, rz);
      if (b !== BLOCK.AIR && b !== BLOCK.WATER) {
        return { x: rx, y: ry, z: rz, px: prevX, py: prevY, pz: prevZ, block: b };
      }
      prevX = rx; prevY = ry; prevZ = rz;
    }
    return null;
  }

  function breakTargetBlock() {
    const hit = raycastBlock(5.5);
    if (!hit) return;
    if (BLOCK_INFO[hit.block] && BLOCK_INFO[hit.block].unbreakable) return;
    setBlockRaw(hit.x, hit.y, hit.z, BLOCK.AIR);
    blockDeltas[`${hit.x},${hit.y},${hit.z}`] = BLOCK.AIR;
    markChunkDirtyAt(hit.x, hit.z);
    scheduleSave();
    playTone(170, 0.08, 'square', 0.07);
  }

  function placeTargetBlock() {
    const hit = raycastBlock(5.5);
    if (!hit) return;
    const { px, py, pz } = hit;
    if (!inBounds(px, py, pz)) return;
    const blockType = HOTBAR_BLOCKS[player.selectedSlot];

    // Prevent placing inside player's body
    const old = getBlock(px, py, pz);
    setBlockRaw(px, py, pz, blockType);
    if (collidesAt(player.x, player.y, player.z)) {
      setBlockRaw(px, py, pz, old);
      return;
    }
    blockDeltas[`${px},${py},${pz}`] = blockType;
    markChunkDirtyAt(px, pz);
    scheduleSave();
    playTone(280, 0.07, 'triangle', 0.08);
  }

  // ---------- Hotbar UI ----------
  const hotbarEl = document.getElementById('hotbar');
  const blockLabelEl = document.getElementById('block-label');
  let labelTimer = null;

  function selectSlot(i) {
    player.selectedSlot = (i + HOTBAR_BLOCKS.length) % HOTBAR_BLOCKS.length;
    const slots = hotbarEl.querySelectorAll('.hotbar-slot');
    slots.forEach((el, idx) => el.classList.toggle('active', idx === player.selectedSlot));
    const b = HOTBAR_BLOCKS[player.selectedSlot];
    blockLabelEl.textContent = BLOCK_INFO[b].name;
    blockLabelEl.classList.add('show');
    if (labelTimer) clearTimeout(labelTimer);
    labelTimer = setTimeout(() => blockLabelEl.classList.remove('show'), 1400);
  }

  HOTBAR_BLOCKS.forEach((b, i) => {
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot' + (i === 0 ? ' active' : '');
    const num = document.createElement('span');
    num.className = 'slot-num';
    num.textContent = i + 1;
    const icon = document.createElement('canvas');
    icon.width = 16;
    icon.height = 16;
    const tileIdx = BLOCK_INFO[b].side;
    const sx = (tileIdx % 4) * 16;
    const sy = Math.floor(tileIdx / 4) * 16;
    icon.getContext('2d').drawImage(atlasCanvas, sx, sy, 16, 16, 0, 0, 16, 16);
    slot.appendChild(num);
    slot.appendChild(icon);
    slot.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      unlockAudio();
      selectSlot(i);
    });
    hotbarEl.appendChild(slot);
  });

  // ---------- Input Handling (Mac + iPhone + Android) ----------
  const keys = {};
  let joyX = 0, joyY = 0;
  let touchJump = false;
  let isTouchMode = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0 && window.innerWidth <= 1024);

  function updateTouchModeUI() {
    document.body.classList.toggle('is-touch', isTouchMode);
    document.getElementById('btn-mode').textContent = isTouchMode ? '💻 键鼠' : '📱 触控';
  }
  updateTouchModeUI();

  document.getElementById('btn-mode').addEventListener('click', (e) => {
    e.stopPropagation();
    isTouchMode = !isTouchMode;
    updateTouchModeUI();
  });

  const btnSound = document.getElementById('btn-sound');
  btnSound.addEventListener('click', (e) => {
    e.stopPropagation();
    soundEnabled = !soundEnabled;
    btnSound.textContent = soundEnabled ? '🔊 音效' : '🔇 静音';
    if (soundEnabled) unlockAudio();
  });

  const overlay = document.getElementById('overlay');
  document.getElementById('btn-help').addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.pointerLockElement) document.exitPointerLock();
    overlay.classList.remove('hidden');
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    unlockAudio();
    overlay.classList.add('hidden');
    if (!isTouchMode && canvas.requestPointerLock) {
      try { canvas.requestPointerLock(); } catch (_) {}
    }
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    localStorage.removeItem(SAVE_KEY);
    blockDeltas = {};
    generateTerrain();
    chunks.forEach((c) => { c.dirty = true; });
    player.x = WORLD_X * 0.5 + 0.5;
    player.z = WORLD_Z * 0.5 + 0.5;
    player.y = findSpawnHeight(Math.floor(player.x), Math.floor(player.z));
    player.vx = player.vy = player.vz = 0;
    overlay.classList.add('hidden');
  });

  // Keyboard
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code >= 'Digit1' && e.code <= 'Digit9') {
      selectSlot(parseInt(e.code.replace('Digit', ''), 10) - 1);
    }
    if (e.code === 'KeyF') {
      placeTargetBlock();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  // Mouse (Pointer Lock + fallback drag)
  let mouseDragging = false;
  let lastMouseX = 0, lastMouseY = 0;

  canvas.addEventListener('mousedown', (e) => {
    if (!overlay.classList.contains('hidden')) return;
    unlockAudio();
    if (isTouchMode) return;
    if (document.pointerLockElement !== canvas) {
      if (canvas.requestPointerLock) {
        try { canvas.requestPointerLock(); } catch (_) {}
      }
      mouseDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    } else {
      if (e.button === 0) breakTargetBlock();
      else if (e.button === 2) placeTargetBlock();
    }
  });

  window.addEventListener('mouseup', () => { mouseDragging = false; });

  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      player.yaw -= e.movementX * 0.0024;
      player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch - e.movementY * 0.0024));
    } else if (mouseDragging) {
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      player.yaw -= dx * 0.005;
      player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch - dy * 0.005));
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => {
    if (!overlay.classList.contains('hidden')) return;
    selectSlot(player.selectedSlot + (e.deltaY > 0 ? 1 : -1));
  }, { passive: true });

  // Multi-touch for iPhone & Android
  const joyZone = document.getElementById('joystick-zone');
  const joyKnob = document.getElementById('joystick-knob');
  let joyTouchId = null;
  let lookTouchId = null;
  let lookLastX = 0, lookLastY = 0;

  function updateJoystick(clientX, clientY) {
    const rect = joyZone.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const maxR = rect.width * 0.36;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    joyX = dx / maxR;
    joyY = dy / maxR;
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  joyZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    unlockAudio();
    if (!isTouchMode) { isTouchMode = true; updateTouchModeUI(); }
    const t = e.changedTouches[0];
    joyTouchId = t.identifier;
    updateJoystick(t.clientX, t.clientY);
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joyTouchId) {
        updateJoystick(t.clientX, t.clientY);
      } else if (t.identifier === lookTouchId) {
        const dx = t.clientX - lookLastX;
        const dy = t.clientY - lookLastY;
        lookLastX = t.clientX;
        lookLastY = t.clientY;
        player.yaw -= dx * 0.0055;
        player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch - dy * 0.0055));
      }
    }
  }, { passive: true });

  function endTouches(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joyTouchId) {
        joyTouchId = null;
        joyX = 0;
        joyY = 0;
        joyKnob.style.transform = 'translate(0px, 0px)';
      } else if (t.identifier === lookTouchId) {
        lookTouchId = null;
      }
    }
  }
  window.addEventListener('touchend', endTouches);
  window.addEventListener('touchcancel', endTouches);

  canvas.addEventListener('touchstart', (e) => {
    if (!overlay.classList.contains('hidden')) return;
    unlockAudio();
    if (!isTouchMode) { isTouchMode = true; updateTouchModeUI(); }
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (lookTouchId === null && t.identifier !== joyTouchId) {
        lookTouchId = t.identifier;
        lookLastX = t.clientX;
        lookLastY = t.clientY;
      }
    }
  }, { passive: true });

  document.getElementById('btn-break').addEventListener('touchstart', (e) => {
    e.preventDefault();
    unlockAudio();
    breakTargetBlock();
  }, { passive: false });

  document.getElementById('btn-place').addEventListener('touchstart', (e) => {
    e.preventDefault();
    unlockAudio();
    placeTargetBlock();
  }, { passive: false });

  const btnJump = document.getElementById('btn-jump');
  btnJump.addEventListener('touchstart', (e) => {
    e.preventDefault();
    unlockAudio();
    touchJump = true;
    btnJump.classList.add('pressed');
  }, { passive: false });
  btnJump.addEventListener('touchend', () => {
    touchJump = false;
    btnJump.classList.remove('pressed');
  });

  // ---------- Fullscreen & Resize ----------
  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (btnFullscreen && document.documentElement.requestFullscreen) {
    btnFullscreen.style.display = '';
    btnFullscreen.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
          if (isTouchMode && screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => {});
          }
        }).catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
    document.addEventListener('fullscreenchange', () => {
      btnFullscreen.textContent = document.fullscreenElement ? '⛶ 退出' : '⛶ 全屏';
    });
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, isTouchMode ? 1.5 : 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => {
    setTimeout(resizeCanvas, 150);
  });
  resizeCanvas();

  // ---------- Main Loop ----------
  const statsEl = document.getElementById('stats-pill');
  let lastTime = performance.now();
  let fpsCount = 0;
  let fpsTimer = 0;
  let currentFps = 60;

  function stepPhysics(dt) {
    const px = Math.floor(player.x);
    const pz = Math.floor(player.z);
    const feetInWater = getBlock(px, Math.floor(player.y + 0.1), pz) === BLOCK.WATER;
    const waistInWater = getBlock(px, Math.floor(player.y + 0.7), pz) === BLOCK.WATER;
    const headAboveWater = getBlock(px, Math.floor(player.y + 1.15), pz) === BLOCK.AIR;
    const inWater = feetInWater || waistInWater;
    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const speed = (inWater ? 3.8 : (sprint ? 7.2 : 4.8));

    let forward = 0;
    let strafe = 0;
    if (keys['KeyW'] || keys['ArrowUp']) forward += 1;
    if (keys['KeyS'] || keys['ArrowDown']) forward -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) strafe += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) strafe -= 1;

    forward -= joyY;
    strafe += joyX;

    const len = Math.hypot(forward, strafe);
    if (len > 1) {
      forward /= len;
      strafe /= len;
    }

    const sy = Math.sin(player.yaw);
    const cy = Math.cos(player.yaw);
    player.vx = (-sy * forward + cy * strafe) * speed;
    player.vz = (-cy * forward - sy * strafe) * speed;

    const jumpHeld = keys['Space'] || touchJump;
    if (inWater) {
      if (jumpHeld) {
        // Give a stronger hop when at the water surface so stepping onto shore is effortless
        player.vy = headAboveWater ? 6.8 : 4.6;
      } else {
        player.vy = Math.max(-2.5, player.vy - 9.0 * dt);
      }
    } else {
      if (jumpHeld && player.onGround) {
        player.vy = 7.6;
        player.onGround = false;
      }
      player.vy -= 21.0 * dt;
      if (player.vy < -28) player.vy = -28;
    }

    // Move X
    const nx = player.x + player.vx * dt;
    if (nx > 0.4 && nx < WORLD_X - 0.4 && !collidesAt(nx, player.y, player.z)) {
      player.x = nx;
    }
    // Move Z
    const nz = player.z + player.vz * dt;
    if (nz > 0.4 && nz < WORLD_Z - 0.4 && !collidesAt(player.x, player.y, nz)) {
      player.z = nz;
    }
    // Move Y
    const ny = player.y + player.vy * dt;
    if (!collidesAt(player.x, ny, player.z)) {
      player.y = ny;
      player.onGround = false;
    } else {
      if (player.vy < 0) player.onGround = true;
      player.vy = 0;
    }

    // Rescue if out of world
    if (player.y < 1) {
      player.y = findSpawnHeight(Math.floor(player.x), Math.floor(player.z));
      player.vy = 0;
    }
  }

  function renderFrame() {
    resizeCanvas();

    // Rebuild up to 2 dirty chunks per frame for smooth framerate
    let rebuilt = 0;
    for (let i = 0; i < chunks.length && rebuilt < 2; i++) {
      if (chunks[i].dirty) {
        buildChunkMesh(chunks[i].cx, chunks[i].cz);
        rebuilt++;
      }
    }

    gl.clearColor(0.53, 0.81, 0.94, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    const proj = mat4Perspective(68 * Math.PI / 180, canvas.width / canvas.height, 0.1, 140);
    const view = mat4View(player.x, player.y + 1.54, player.z, player.yaw, player.pitch);

    gl.useProgram(worldProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(worldProg, 'uProj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(worldProg, 'uView'), false, view);
    gl.uniform3f(gl.getUniformLocation(worldProg, 'uFogColor'), 0.53, 0.81, 0.94);
    gl.uniform1f(gl.getUniformLocation(worldProg, 'uFogStart'), 36.0);
    gl.uniform1f(gl.getUniformLocation(worldProg, 'uFogEnd'), 72.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(gl.getUniformLocation(worldProg, 'uTex'), 0);

    const aPos = gl.getAttribLocation(worldProg, 'aPos');
    const aUV = gl.getAttribLocation(worldProg, 'aUV');
    const aShade = gl.getAttribLocation(worldProg, 'aShade');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUV);
    gl.enableVertexAttribArray(aShade);

    function drawMesh(mesh) {
      if (!mesh || mesh.count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 24, 12);
      gl.vertexAttribPointer(aShade, 1, gl.FLOAT, false, 24, 20);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }

    // Opaque pass
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (let i = 0; i < chunks.length; i++) drawMesh(chunks[i].opaque);

    // Translucent water pass
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (let i = 0; i < chunks.length; i++) drawMesh(chunks[i].translucent);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // Target wireframe box
    const hit = raycastBlock(5.5);
    if (hit) {
      gl.useProgram(lineProg);
      const boxView = mat4View(player.x - hit.x, player.y + 1.54 - hit.y, player.z - hit.z, player.yaw, player.pitch);
      gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'uProj'), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'uView'), false, boxView);
      const lPos = gl.getAttribLocation(lineProg, 'aPos');
      gl.enableVertexAttribArray(lPos);
      gl.bindBuffer(gl.ARRAY_BUFFER, boxVBO);
      gl.vertexAttribPointer(lPos, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, 24);
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    if (overlay.classList.contains('hidden')) {
      stepPhysics(dt);
    }
    renderFrame();

    fpsCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      currentFps = Math.round(fpsCount / fpsTimer);
      fpsCount = 0;
      fpsTimer = 0;
      statsEl.textContent = `FPS ${currentFps} · X:${Math.floor(player.x)} Y:${Math.floor(player.y)} Z:${Math.floor(player.z)}`;
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
