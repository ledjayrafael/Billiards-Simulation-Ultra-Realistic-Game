# NINE — Simulator Biliar 9-Ball

Simulator 9-ball realistis untuk web: 2 pemain lokal bergantian (hot-seat) di satu komputer.
Mesin fisika biliar khusus (TypeScript, event-based, deterministik), aset 3D dibangun 100% dari
script Blender, rendering Three.js.

## Menjalankan

Butuh **Node.js ≥ 22** (diuji dengan v24). Blender **tidak** diperlukan untuk bermain — aset hasil
ekspor sudah ada di `apps/client/public/assets/`.

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

Mode pengembangan (Vite di :5173 + server API di :3000):

```bash
npm run dev
```

| Perintah | Fungsi |
|---|---|
| `npm test` | Semua test (fisika, aturan 9-ball, parity server) |
| `npm run typecheck` / `npm run lint` | Pemeriksaan TypeScript & ESLint |
| `npm run assets` | Bangun ulang semua aset dari Blender (lihat di bawah) |
| `npx tsx tools/calibrate.ts` | Cetak angka kalibrasi fisika (break, rail, draw) |

Halaman lain: **`/debug`** — viewer 2D mesin fisika (atur bola, parameter pukulan, slider koefisien).

## Kontrol (desktop)

| Aksi | Kontrol |
|---|---|
| Bidik | Klik meja (kursor terkunci), gerakkan mouse. `Shift` = bidik halus. `←`/`→` juga bisa |
| Pukul | Tahan klik kiri, tarik mouse ke belakang, dorong ke depan — kecepatan dorong = kecepatan stik |
| Power bar | Tahan `Space`, lepas untuk memukul |
| Spin | `W A S D` atau klik/drag panel cue ball (klik ganda / `C` = center) |
| Elevasi stik | `Q` / `E` (0–80°; massé & jump) |
| Ball in hand | Lepas kursor (`Esc`), seret cue ball |
| Push-out | Tombol di HUD atau `X` (hanya tepat setelah break) |
| Kamera | Klik kanan + drag = orbit · scroll = zoom · `T` tampak atas · `R` reset |
| Replay | `P` (tekan lagi: slow-motion 0.25×) |
| Menu / jeda | `Esc` |

## Struktur

```
packages/physics   mesin fisika murni (tanpa DOM): evolusi analitik, solver quartic, tumbukan
packages/rules     aturan 9-ball (state machine murni) + rack ber-seed
packages/shared    tipe JSON bersama (ShotParams, ShotResult, GameState)
apps/client        Vite + Three.js: render, kamera, input, HUD, audio, worker fisika
apps/server        Fastify: menyajikan build client, /api/health, /api/simulate
blender/           specs.json (sumber kebenaran dimensi), script aset, tekstur CC0
tools/             export-assets.mjs, fetch-textures.mjs, seq.mjs/shot.mjs (uji visual headless)
```

`blender/specs.json` adalah satu-satunya tempat dimensi meja/bola/pocket dan koefisien fisika
didefinisikan; dibaca oleh Blender **dan** TypeScript sehingga geometri visual = geometri fisika.

Arsitektur satu pukulan: input → `ShotParams` → Web Worker `simulate()` (sampai semua bola diam)
→ `ShotResult` (keyframe + event) → `rules.applyShot()` → playback + suara dari event.
`physics` dan `rules` tidak bergantung pada DOM, dan hasil simulasi identik bit-per-bit antara
browser dan Node (lihat test parity) — siap dipakai server authoritative untuk mode online nanti.

## Membangun ulang aset Blender

1. Pasang Blender ≥ 4.5 (diuji dengan 5.3.0), mis. tarball portable resmi dari blender.org.
2. Salin `.env.example` ke `.env`, isi `BLENDER_BIN` dengan path absolut binary Blender.
3. (Sekali saja, bila folder `blender/textures` kosong) `node tools/fetch-textures.mjs`
   — mengunduh tekstur CC0 dari Poly Haven.
4. Jalankan:

```bash
npm run assets                 # build penuh + bake kualitas tinggi (beberapa menit, GPU bila ada)
npm run assets -- --fast       # bake cepat untuk iterasi
npm run assets -- --only table # hanya sebagian (table,balls,cue,cameras,room)
```

Pipeline: `blender/scripts/build_all.py` (headless) membangun meja, bola, stik, ruangan, kamera
sinematik, mem-bake lightmap ruangan dan panorama refleksi → `tools/export-assets.mjs`
mengompresi (Meshopt + WebP), menyalin ke `apps/client/public/assets`, lalu **memverifikasi
dimensi GLB terhadap `specs.json` (toleransi 0,5 mm)** dan ukuran total (≤ 40 MB).

Preview Cycles untuk pemeriksaan visual:

```bash
$BLENDER_BIN -b --factory-startup -P blender/scripts/render_preview.py -- --samples 96
# hasil: blender/out/preview/*.png
```

## Lisensi aset

- Tekstur: Poly Haven, CC0 — lihat `blender/textures/LICENSES.md`.
- Suara: disintesis saat runtime, tanpa rekaman eksternal — lihat
  `apps/client/public/assets/sound/LICENSES.md`.
- Model 3D, atlas angka bola, tekstur kain, lukisan dinding: dibuat oleh script di `blender/scripts/`.
