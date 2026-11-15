# PLAN — Simulator Biliar 9-Ball Realistis (Web)

Dokumen ini adalah rencana kerja lengkap untuk dieksekusi oleh agent (Claude Fable). Baca seluruhnya sebelum mulai. Kerjakan milestone **berurutan**; setiap milestone punya kriteria selesai yang harus lolos sebelum lanjut.

---

## 0. Ringkasan

| Item | Keputusan |
|---|---|
| Permainan | **9-ball** (aturan WPA), tanpa mode lain |
| Mode | **2 pemain lokal, hot-seat** (bergantian di 1 komputer, 1 mouse) |
| Platform | **Desktop** saja (mouse + keyboard), Chrome/Firefox/Edge terbaru |
| Jalan di | **localhost** |
| Aset 3D & kamera sinematik | **Blender**, dibangun lewat script Python (`bpy`), ekspor **GLB** |
| Fisika | Mesin fisika biliar khusus, **TypeScript**, deterministik |
| Logika game / aturan | TypeScript (paket bersama, siap dipakai server nanti) |
| Rendering | **Three.js** + Vite |
| Server | **Node.js + TypeScript** (Fastify). Sekarang: menyajikan client + API kecil. Disiapkan agar nanti bisa jadi server online authoritative |
| Gaya visual | **Orisinal**. Genre sama dengan simulator biliar realistis, tetapi jangan meniru nama, logo, UI, atau aset game lain |

### Bukan scope sekarang (jangan dikerjakan)
Multiplayer online, akun/login, database, AI lawan, mobile/touch, mode 8-ball/snooker. Tetapi **arsitektur harus memudahkan** penambahan online nanti (lihat §3.4).

---

## 1. Kondisi lingkungan (dicek 2026-11-15)

- OS: Linux (Kali), shell zsh
- Node **v24** dan npm tersedia. pnpm **tidak** ada → pakai **npm workspaces**
- Python 3.14 tersedia
- **Blender belum terpasang.** Langkah pertama M0: pasang Blender versi stabil terbaru (≥ 4.5 LTS). Rekomendasi: unduh tarball portable resmi dari blender.org, ekstrak ke `~/opt/blender/`, lalu panggil lewat path absolut atau set `BLENDER_BIN` di `.env`. **Minta izin user sebelum mengunduh.**
- Folder proyek masih kosong dan belum menjadi repo git → `git init` di M0.

---

## 2. Struktur repo

```
3d-billiards-simulation/
├─ PLAN.md
├─ README.md                 # cara menjalankan
├─ package.json              # npm workspaces root
├─ tsconfig.base.json
├─ .env.example              # BLENDER_BIN=..., PORT=3000
├─ packages/
│  ├─ physics/               # mesin fisika murni (tanpa DOM, tanpa Three.js)
│  │  ├─ src/
│  │  │  ├─ constants.ts     # dimensi meja & koefisien
│  │  │  ├─ vec.ts           # util vektor 3D (immutable-ish, tanpa alokasi berlebih)
│  │  │  ├─ ball.ts          # state bola + motion state
│  │  │  ├─ table.ts         # geometri meja: cushion segments, jaw, pocket
│  │  │  ├─ cue.ts           # model pukulan stik → kecepatan + spin awal
│  │  │  ├─ motion.ts        # evolusi analitik per motion state
│  │  │  ├─ collide/         # ball-ball, ball-cushion, ball-jaw, pocket
│  │  │  ├─ simulate.ts      # loop simulasi → ShotResult
│  │  │  └─ index.ts
│  │  └─ test/               # Vitest
│  ├─ rules/                 # aturan 9-ball (state machine murni)
│  │  ├─ src/{nineBall.ts, rack.ts, types.ts}
│  │  └─ test/
│  └─ shared/                # tipe bersama: ShotParams, GameState, pesan jaringan (masa depan)
├─ apps/
│  ├─ client/                # Vite + Three.js + TS
│  │  ├─ public/assets/      # hasil ekspor Blender (GLB, HDRI, KTX2), sound
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ render/          # scene, material, lighting, postprocessing
│  │     ├─ camera/          # aim cam, top view, follow cam, cinematic player
│  │     ├─ input/           # aim, power, spin, ball-in-hand
│  │     ├─ ui/              # HUD, scoreboard, menu, spin selector, power bar
│  │     ├─ audio/
│  │     ├─ sim/             # Web Worker yang menjalankan packages/physics
│  │     └─ game/            # orkestrasi: giliran, playback, aturan
│  └─ server/                # Node + Fastify + TS
│     └─ src/{index.ts, routes/}
├─ blender/
│  ├─ scripts/               # semua aset dibangun dari script, idempoten
│  │  ├─ common.py           # util: unit, material helper, export helper
│  │  ├─ build_table.py
│  │  ├─ build_balls.py
│  │  ├─ build_cue.py
│  │  ├─ build_room.py
│  │  ├─ build_cameras.py    # jalur kamera sinematik
│  │  ├─ bake_lighting.py
│  │  ├─ render_preview.py   # render PNG untuk dicek visual
│  │  └─ build_all.py
│  ├─ specs.json             # SUMBER KEBENARAN dimensi (dibaca Blender & TS)
│  ├─ textures/              # tekstur sumber (CC0) + lisensinya
│  └─ out/                   # .blend hasil + preview PNG (gitignore .blend besar)
└─ tools/
   ├─ export-assets.mjs      # jalankan Blender headless → salin GLB ke client
   └─ pooltool-compare/      # (opsional) validasi fisika vs pooltool (Python)
```

**Aturan penting:** dimensi meja/bola/pocket hanya didefinisikan di `blender/specs.json`. `packages/physics/src/constants.ts` membaca/mengimpor JSON yang sama, sehingga geometri visual dan geometri fisika **selalu identik**.

---

## 3. Arsitektur

### 3.1 Alur satu pukulan

```
Input (aim, power, spin, elevation)
   → ShotParams { dir, speed, tipOffset{x,y}, elevation }
   → Web Worker: physics.simulate(tableState, ShotParams)
   → ShotResult { frames[] (keyframe per bola), events[] (collision, rail, pocket), finalState }
   → rules.applyShot(gameState, ShotResult.events, finalState) → GameState baru (foul? giliran? menang?)
   → Client memutar frames secara real-time (interpolasi), memicu suara dari events
   → UI menampilkan hasil, ganti giliran / ball in hand
```

- Simulasi dihitung **sekaligus sampai semua bola diam**, lalu diputar ulang. Ini membuat replay gratis dan cocok untuk online nanti (server cukup menjalankan `simulate` yang sama).
- Simulasi harus selesai < 50 ms untuk break shot di laptop biasa. Kalau lebih, tampilkan playback progresif (stream frames dari worker).

### 3.2 Determinisme
- Tidak ada `Math.random()` di `physics`. Rack acak di `rules` memakai PRNG ber-seed (mis. mulberry32) yang seed-nya disimpan di GameState.
- Urutan iterasi bola tetap (berdasarkan id).
- Hanya operasi `Math.*` standar. Tidak ada `Date.now()` di sim.
- Uji: simulasi yang sama dijalankan 2× harus menghasilkan finalState identik bit-per-bit.

### 3.3 Server (sekarang)
- `apps/server`: Fastify menyajikan build client (`apps/client/dist`) di `http://localhost:3000`.
- Endpoint: `GET /api/health`, dan `POST /api/simulate` (menjalankan physics di Node; dipakai untuk test parity client↔server).
- Mode dev: `npm run dev` menjalankan Vite (5173, proxy `/api` → 3000) + server dengan `tsx watch` secara bersamaan.

### 3.4 Persiapan online (jangan diimplementasi, cukup jangan dihalangi)
- `packages/shared` berisi tipe `ShotParams`, `GameState`, `ShotResult` yang serializable (JSON murni).
- `rules` dan `physics` tidak bergantung pada DOM/Three.js → bisa berjalan di server.
- Nanti: WebSocket room, server menjalankan `simulate` + `rules` sebagai wasit.

---

## 4. Spesifikasi fisik (isi `blender/specs.json`)

Satuan **SI (meter, kg, detik)**. Meja **9 ft** standar WPA.

| Parameter | Nilai |
|---|---|
| Area main (cushion nose ke nose) | 2.540 × 1.270 m |
| Diameter bola | 0.05715 m (R = 0.028575) |
| Massa bola | 0.170 kg (cue ball sama) |
| Tinggi nose cushion dari slate | ≈ 0.63·(2R) ≈ 0.0363 m |
| Bukaan corner pocket (mouth) | 0.1143 m (4.5") |
| Bukaan side pocket | 0.1302 m (5.125") |
| Sudut jaw corner / side | ≈ 142° / 104° (sudut cut cushion terhadap rail) |
| Kedalaman shelf pocket | corner ≈ 0.0286 m, side ≈ 0.0095 m |
| Lebar rail (kayu) | ≈ 0.12–0.15 m |
| Tinggi meja (lantai ke permukaan) | ≈ 0.76 m |
| Diamond | 3 per sisi pendek di antara pocket, 7 di sisi panjang (pola standar) |
| Head string / foot spot | foot spot di tengah lebar, 1/4 panjang dari rail kaki |

### Koefisien awal (kalibrasi di M1)

| Koefisien | Nilai awal | Keterangan |
|---|---|---|
| μ_slide (bola–kain, meluncur) | 0.20 | |
| μ_roll (rolling resistance) | 0.010 | |
| μ_spin (spin vertikal-sumbu decay) | 0.044 → dipakai sebagai laju decay ω_y | |
| e_ball (restitusi bola–bola) | 0.95 | |
| μ_ball (gesekan bola–bola, untuk throw) | 0.06 | bisa dibuat bergantung kecepatan relatif (model Alciatore) |
| e_cushion (restitusi cushion) | 0.85 → menurun pada kecepatan tinggi | |
| μ_cushion (gesekan bola–cushion) | 0.20 | |
| e_tip (restitusi tip stik) | 0.75 | |
| Massa stik efektif | 0.54 kg (19 oz) | |
| Batas miscue | offset tip > 0.5R | |
| e_slate (pantulan bola ke slate saat airborne) | 0.5 | |

---

## 5. Model fisika

Target: perilaku yang dikenali pemain sungguhan: **stop shot, follow, draw, stun, aturan 90° dan 30°, english di cushion, throw (CIT & SIT), squirt/deflection, swerve, massé ringan, jump shot ringan**.

### 5.1 State bola
Posisi `r` (3D), kecepatan linear `v`, kecepatan sudut `ω` (3D), dan **motion state**:
`STATIONARY | SPINNING | ROLLING | SLIDING | AIRBORNE | POCKETED | OFF_TABLE`.

### 5.2 Evolusi antar tumbukan (analitik, berdasarkan Leckie & Greenspan / pooltool)
- Kecepatan titik kontak: `u = v + ω × (−R ẑ)` (ẑ = normal meja; sesuaikan ke sistem sumbu yang dipakai).
- **SLIDING:** gaya gesek `−μ_slide m g û`. `v` dan `ω` berubah linear terhadap waktu. Transisi ke ROLLING saat `|u| = 0`, waktu: `t = 2|u₀| / (7 μ_slide g)`. Lintasan berbentuk **parabola** (ini menghasilkan swerve/massé alami).
- **ROLLING:** `v` berkurang dengan `μ_roll g`, `ω_xy` terkunci ke `v` (`ω × R = v`). Transisi ke SPINNING/STATIONARY saat `v = 0`.
- **Sumbu vertikal (english, ω_z):** decay linear dengan `(5 μ_spin g)/(2R)` di semua state yang menyentuh kain.
- **AIRBORNE:** balistik dengan gravitasi, tanpa gesekan; mendarat ke slate dengan restitusi `e_slate` (bisa memantul beberapa kali), lalu kembali ke SLIDING.

Karena semuanya analitik, posisi pada waktu `t` dapat dihitung langsung tanpa integrasi numerik.

### 5.3 Pendekatan simulasi
Pilih **event-based** (direkomendasikan, akurat & deterministik):
1. Untuk setiap bola, hitung waktu transisi motion state berikutnya.
2. Untuk setiap pasangan bola yang bergerak, hitung waktu tumbukan terdekat. Karena lintasan sliding berbentuk polinom derajat 2 terhadap t, jarak² = (2R)² menghasilkan **persamaan quartic**. Pakai solver quartic yang robust (selesaikan secara numerik dengan pemisahan akar + Newton refinement; hindari rumus Ferrari murni karena tidak stabil).
3. Untuk bola vs segmen cushion (garis) dan jaw/titik sudut (lingkaran): quadratic.
4. Ambil event dengan waktu terkecil, majukan semua bola ke waktu itu secara analitik, selesaikan event, ulangi.
5. Berhenti saat semua bola STATIONARY/POCKETED/OFF_TABLE, atau batas aman (mis. 60 dt sim / 10.000 event).

**Fallback** bila solver quartic bermasalah: fixed-step 1 ms dengan evolusi analitik per step + time-of-impact quadratic di dalam step (anggap kecepatan konstan dalam 1 ms). Implementasikan fallback ini **di belakang interface yang sama** agar bisa dibandingkan. Pertahankan event-based sebagai mode utama jika lulus test.

Penanganan epsilon: setelah tumbukan, pastikan bola tidak overlap (geser sedikit menjauh) dan abaikan pasangan yang baru saja bertumbukan dan saling menjauh.

### 5.4 Tumbukan
- **Bola–bola:** impuls normal dengan restitusi `e_ball` + impuls tangensial dengan gesekan (Coulomb, dibatasi oleh kecepatan slip) → menghasilkan **throw** dan transfer spin. Referensi: Alciatore, *"TP A.14/A.5"* (model throw), atau model di pooltool. Rak padat saat break harus terselesaikan dengan stabil (tumbukan simultan diproses berurutan berdasarkan waktu; tidak boleh ada bola terjebak saling tembus).
- **Bola–cushion:** model **Han (2005)** atau **Mathavan et al. (2010)**. Model ini memperhitungkan tinggi nose cushion (kontak di atas ekuator → bola sedikit terdorong ke bawah/atas), english yang mengubah sudut pantul, dan restitusi yang bergantung pada kecepatan. Pantulan keras boleh membuat bola sedikit airborne.
- **Jaw pocket:** cushion yang miring di mulut pocket = segmen garis + ujung bulat (lingkaran). Bola bisa "rattle" di antara jaw.
- **Pocket:** bola masuk saat pusatnya melewati lingkaran jatuh pocket (setelah shelf). Animasikan jatuh ke dalam kantong/rail pengembali secara sederhana (cukup visual, tidak memengaruhi game).
- **Keluar meja:** bola AIRBORNE yang mendarat di luar area main/rail → OFF_TABLE (foul).

### 5.5 Model pukulan stik (cue → bola)
Input: arah horizontal θ, elevasi φ (0–80°), kecepatan stik `V` (0.5–9 m/s, break ~8–9 m/s), offset tip `(a, b)` pada permukaan bola (dibatasi lingkaran 0.5R; di luarnya = **miscue**: kecepatan acak-deterministik kecil dan suara miscue).
- Hitung impuls dari tumbukan stik–bola (massa stik efektif, `e_tip`), seperti di pooltool / Leckie-Greenspan.
- **Squirt (deflection):** english samping membuat bola menyimpang sedikit dari arah bidikan (≈ 1–3°, bergantung pada offset dan "low-deflection shaft" setting).
- Elevasi + offset bawah → massé/jump. Jump: bola menjadi AIRBORNE bila komponen vertikal cukup.

### 5.6 Output
```ts
interface ShotResult {
  events: SimEvent[];       // {t, type:'ball-ball'|'cushion'|'pocket'|'cue'|'slate'|'off-table', ids, speed}
  frames: BallTrack[];      // per bola: sampel {t, pos, quat} pada 120 Hz (+ titik event persis)
  finalState: TableState;
  duration: number;
}
```
Rotasi visual bola (quaternion) diintegrasikan dari ω supaya angka pada bola berputar dengan benar.

---

## 6. Aturan 9-ball (`packages/rules`)

State machine murni: `applyShot(state, events, finalState) → newState`.

- **Rack:** belah ketupat (diamond) 1-2-3-2-1, bola **1 di apex** pada foot spot, **9 di tengah**, sisanya diacak (PRNG ber-seed). Bola rapat (jarak kecil, mis. 0.1 mm, agar break realistis).
- **Break:** cue ball di belakang head string (kitchen). Bola pertama yang dikenai harus bola 1. Sah jika minimal satu bola masuk **atau** minimal 4 object ball menyentuh cushion. Jika tidak → foul (lawan mendapat ball in hand; versi sederhana tanpa opsi re-rack).
- **Push-out:** tepat setelah break yang sah, pemain berikutnya boleh menyatakan push-out (tombol). Push-out tidak wajib mengenai bola atau cushion. Lawan memilih: main dari posisi itu atau kembalikan giliran.
- **Pukulan sah:** cue ball harus mengenai **bola bernomor terendah** di meja terlebih dahulu. Setelah itu, harus ada bola yang masuk **atau** ada bola (termasuk cue ball) yang menyentuh cushion.
- **Foul:** scratch (cue ball masuk/keluar meja), salah bola pertama, tidak mengenai bola, tidak ada cushion setelah kontak, object ball keluar meja. Hukuman: **ball in hand di mana saja** untuk lawan.
- Pemain lanjut menembak selama memasukkan bola secara sah.
- **Bola 9 masuk secara sah** (termasuk lewat kombinasi atau saat break) → menang rack. Bola 9 masuk saat foul → **di-spot** di foot spot (atau sedekat mungkin di belakangnya), lawan ball in hand.
- Object ball selain 9 yang keluar meja tidak dikembalikan (foul).
- **3 foul berturut-turut** → kalah rack (bisa dimatikan di pengaturan; beri peringatan setelah foul ke-2).
- **Race to N** (default 5; bisa diatur 1–11). Pemenang rack sebelumnya break (default; opsi bergantian).
- Tidak ada called shot (sesuai 9-ball standar).

Tes unit untuk setiap aturan di atas.

---

## 7. Aset Blender

Semua aset dibangun lewat **script Python headless**:
```
$BLENDER_BIN -b --factory-startup -P blender/scripts/build_all.py -- --out apps/client/public/assets
```
Script harus idempoten (hapus scene lalu bangun ulang), membaca `specs.json`, dan mengekspor GLB. Gunakan `render_preview.py` (Cycles, resolusi kecil) untuk menghasilkan PNG di `blender/out/preview/`. **Lihat PNG tersebut (Read tool) untuk menilai hasil secara visual** dan perbaiki sampai bagus.

### 7.1 Meja (`build_table.py`)
- Slate + kain (wool worsted; warna orisinal, misalnya biru tournament atau hijau gelap). Material kain: base color + normal map tenunan halus + sedikit sheen.
- Cushion dengan profil K-66 (penampang miring), dibungkus kain, potongan jaw di pocket sesuai §4.
- Rail kayu dengan bevel dan diamond inlay (mother-of-pearl). Kayu: tekstur CC0 (Poly Haven / ambientCG; catat lisensinya di `blender/textures/LICENSES.md`).
- Pocket: liner karet/kulit + kantong jaring/kulit. Kaki meja dan apron.
- Pisahkan objek per material, beri nama konsisten (`Table_Cloth`, `Table_Rail`, `Cushion_*`, `Pocket_*`).
- Target poligon meja ≤ 150k tris.

### 7.2 Bola (`build_balls.py`)
- Satu mesh sphere halus (UV sphere ~64 segmen atau quad-sphere), diameter tepat.
- 10 bola (cue + 1–9). Bola 9 bergaris (stripe) kuning. Warna standar: 1 kuning, 2 biru, 3 merah, 4 ungu, 5 oranye, 6 hijau, 7 marun, 8 hitam, 9 kuning stripe. Cue ball putih dengan titik merah kecil (membantu melihat spin).
- Tekstur angka dibuat lewat script (lingkaran putih + angka, font open-source) dan di-bake ke texture atlas 2048² (KTX2/WebP).
- Material: phenolic resin, clearcoat tinggi, roughness rendah.

### 7.3 Stik (`build_cue.py`)
Ferrule, tip kulit, shaft maple, joint, butt dengan wrap. Panjang 1.47 m, tip 12.75 mm. Desain orisinal.

### 7.4 Ruangan (`build_room.py`)
Ruang biliar sederhana tapi berkelas: lantai kayu/karpet, dinding, lampu gantung di atas meja (sumber cahaya utama, 3 shade), rak stik, beberapa props. Ruangan menggunakan **lightmap yang di-bake**.

### 7.5 Pencahayaan (`bake_lighting.py`)
- Bake lightmap (Cycles) untuk ruangan dan bodi meja ke UV channel kedua. Bola **tidak** di-bake (dinamis).
- Ekspor juga HDRI/probe cubemap dari posisi tengah meja untuk refleksi bola.

### 7.6 Kamera sinematik (`build_cameras.py`)
Beberapa animasi kamera di Blender, diekspor sebagai **animasi glTF** pada objek kamera:
- `Cam_Intro`: sweep pembuka mengelilingi meja (6–8 dt).
- `Cam_BreakPrep`: dari atas ke posisi break.
- `Cam_RackWin`: orbit pelan setelah rack dimenangkan.
Client memutarnya dengan `THREE.AnimationMixer`, transisi halus (blend) ke kamera gameplay.

### 7.7 Ekspor
- GLB terpisah: `table.glb`, `balls.glb`, `cue.glb`, `room.glb`, `cameras.glb`.
- Kompresi: Draco/Meshopt untuk mesh, KTX2 (Basis) untuk tekstur. Gunakan `gltf-transform` CLI di `tools/export-assets.mjs`.
- Total unduhan target ≤ 40 MB.

---

## 8. Client (Three.js)

### 8.1 Rendering
- `WebGLRenderer` (atau WebGPU bila stabil di Three versi yang dipakai), sRGB, tone mapping **AgX** atau ACES, physically correct lights.
- Lightmap dari Blender + `RectAreaLight`/`SpotLight` di lampu gantung untuk specular bola.
- Bayangan: shadow map untuk bola (PCF soft) + **contact shadow** di bawah bola.
- Refleksi: env map (cubemap) untuk bola. Bonus: cube camera dinamis berupdate jarang.
- Postprocessing (pmndrs `postprocessing`): SSAO/N8AO, bloom halus, SMAA, depth-of-field halus khusus kamera sinematik.
- Pengaturan grafis: Low / Medium / High / Ultra. Target **60 fps** di High pada laptop dengan GPU integrated modern.

### 8.2 Kamera gameplay (`camera/`)
- **Aim cam:** di belakang cue ball searah bidikan; mouse menggeser arah bidik; scroll = zoom/tinggi kamera.
- **Top view:** tombol `T`, tampilan ortografis/perspektif dari atas.
- **Free orbit:** tahan klik kanan + drag.
- **Shot cam:** setelah memukul, kamera otomatis bertransisi halus ke posisi yang menampilkan aksi (mis. naik sedikit dan mengikuti cue ball, atau overhead untuk break).
- Semua transisi menggunakan damping (spring) agar tidak patah.

### 8.3 Kontrol (desktop)
| Aksi | Kontrol |
|---|---|
| Bidik | Gerak mouse (horizontal) di aim cam. Tahan `Shift` untuk fine aim |
| Power + pukul | Tahan klik kiri, tarik mouse ke belakang (stik ikut mundur), dorong ke depan untuk memukul. Kecepatan dorong mouse = kecepatan stik (dengan smoothing). Alternatif: power bar (tahan `Space`, lepas) |
| Spin (tip offset) | Panel cue-ball kecil di pojok, klik/drag titik; atau tombol `W/A/S/D` |
| Elevasi stik | `Q` / `E` (0–80°) |
| Ball in hand | Drag cue ball (tidak boleh overlap atau keluar area; di kitchen saat break) |
| Push-out | Tombol di HUD (hanya muncul saat berlaku) |
| Top view / reset kamera | `T` / `R` |
| Replay pukulan terakhir | `P` |
| Menu / pause | `Esc` |

Garis bidik (aim guide) dan ghost ball: **opsi** di pengaturan (On / Pendek / Off). Default "Pendek" (hanya sampai bola pertama, tanpa prediksi pantulan object ball).

### 8.4 UI/HUD
- Papan skor: nama Pemain 1 & 2 (bisa diedit di menu awal), skor rack, race to N, indikator giliran yang jelas.
- Barisan bola tersisa (1–9) dengan bola target (terendah) di-highlight.
- Pesan status: "Foul — ball in hand", "Push-out?", "Pemain 2 menang rack", dll.
- Menu awal: Mulai, nama pemain, race to, opsi aturan, pengaturan grafis/suara.
- Layar ganti giliran singkat (overlay nama pemain), karena bergantian di satu komputer.
- Desain UI orisinal, minimalis, dan elegan (font dan palet sendiri).

### 8.5 Audio
WebAudio. Suara: tumbukan bola–bola (volume & pitch sesuai kecepatan), bola–cushion, stik kena bola (berbeda untuk break), miscue, bola masuk pocket dan menggelinding di rail pengembali, ambience ruangan pelan. Gunakan rekaman **CC0 / lisensi jelas** (catat di `apps/client/public/assets/sound/LICENSES.md`). Picu dari `events[]` dengan waktu yang tepat.

### 8.6 Replay
Simpan `ShotResult` terakhir. Replay memutar ulang frames dengan kamera sinematik otomatis; bisa slow-motion (0.25×).

---

## 9. Milestone

Setiap milestone diakhiri dengan: semua test lulus, `npm run build` sukses, commit git.

### M0 — Fondasi (½ hari)
- `git init`, npm workspaces, TypeScript strict, ESLint + Prettier, Vitest.
- Skeleton `apps/client` (Vite), `apps/server` (Fastify), paket `physics`, `rules`, `shared`.
- Pasang Blender (dengan izin user). Script `blender/scripts/build_all.py` minimal mengekspor kubus → muncul di client.
- `npm run dev` membuka scene Three.js kosong di localhost.
- **Selesai bila:** `npm run dev`, `npm test`, `npm run build`, `npm start` (server menyajikan build di :3000) semuanya jalan.

### M1 — Mesin fisika (inti, waktu paling banyak)
- Implementasi §5 lengkap di `packages/physics`.
- **Debug viewer 2D** (`apps/client` route `/debug`, Canvas 2D top-down): set posisi bola, parameter pukulan, jalankan, gambar lintasan dan event. Slider koefisien untuk kalibrasi live.
- Test Vitest (wajib lulus):
  1. Bola diam tetap diam; tidak ada energi tercipta (energi kinetik total tidak naik setelah tumbukan mana pun).
  2. Center-ball, cue ball sliding → menjadi rolling setelah jarak sesuai teori (≈ 12/49·v²/(μg)).
  3. **Stop shot:** cue stun lurus mengenai object ball → cue ball berhenti hampir di tempat.
  4. **Aturan 90°:** stun shot terpotong → cue ball pergi ~90° dari arah object ball.
  5. **Aturan 30°:** rolling cue ball, cut setengah bola → defleksi cue ball ~30°.
  6. Draw dan follow menghasilkan arah yang benar dan besaran wajar.
  7. Cushion: sudut datang ≈ sudut pantul tanpa english pada kecepatan sedang; english running/reverse mengubah sudut ke arah yang benar.
  8. Throw: cut shot setengah bola tanpa english menghasilkan throw object ball ~1–4°.
  9. Squirt: english samping maksimum menghasilkan defleksi 1–3°.
  10. Break 9-ball pada 8.5 m/s: tidak ada bola saling tembus, tidak ada NaN, selesai < 50 ms, minimal beberapa bola menyentuh cushion.
  11. Determinisme (§3.2).
  12. Parity: `POST /api/simulate` di server menghasilkan finalState identik dengan hasil di worker browser.
- (Opsional) `tools/pooltool-compare`: jalankan pukulan yang sama di pooltool (Python) dan bandingkan lintasan.

### M2 — Aset Blender
- §7 lengkap. Iterasi visual dengan render preview sampai terlihat realistis (cek kain, kayu, refleksi bola, angka bola terbaca, pocket benar).
- Verifikasi dimensi: script cek otomatis bahwa ukuran GLB sesuai `specs.json` (toleransi 0.5 mm).
- **Selesai bila:** semua GLB termuat di client, ukuran total ≤ 40 MB, preview PNG terlihat meyakinkan.

### M3 — Scene 3D + playback
- Muat aset, lighting, postprocessing, env map.
- Hubungkan worker fisika: pukulan dari debug panel sementara → bola 3D bergerak sesuai `frames` dengan rotasi benar.
- Kamera gameplay (§8.2).
- **Selesai bila:** break dan beberapa pukulan terlihat mulus pada 60 fps, bola menggelinding dengan rotasi yang benar secara visual.

### M4 — Kontrol & aturan 9-ball
- Kontrol §8.3 lengkap, stik 3D mengikuti bidikan/tarikan.
- `packages/rules` §6 lengkap dengan test.
- Alur hot-seat 2 pemain: menu awal → break → giliran → foul/ball in hand → push-out → menang rack → race selesai → layar pemenang.
- **Selesai bila:** satu pertandingan race-to-3 penuh bisa dimainkan dari awal sampai akhir tanpa bug; semua jenis foul terdeteksi dengan benar.

### M5 — Polish
- Audio §8.5, HUD final §8.4, kamera sinematik Blender (intro, rack win), replay + slow-mo, pengaturan grafis, layar loading dengan progress.
- Kalibrasi ulang fisika sambil bermain ("feel"): kecepatan kain, pantulan cushion, kekuatan break.
- **Selesai bila:** checklist §10 lulus.

### M6 — Ekstra (hanya jika M0–M5 tuntas)
Jump/massé yang lebih kaya, statistik pertandingan, simpan/lanjutkan pertandingan (localStorage), mode latihan (atur posisi bola bebas).

---

## 10. Checklist penerimaan akhir

- [ ] `npm install && npm run build && npm start` → game bisa dimainkan di `http://localhost:3000`
- [ ] Pertandingan 9-ball 2 pemain hot-seat lengkap (race to N) tanpa error di console
- [ ] Semua aturan §6 bekerja dan teruji
- [ ] Semua test fisika §M1 lulus
- [ ] 60 fps pada preset High di laptop biasa; tidak ada stutter saat pukulan pertama (shader di-warm-up saat loading)
- [ ] Aset 100% berasal dari script Blender di repo + tekstur/suara dengan lisensi tercatat
- [ ] Tidak ada nama, logo, atau aset milik game lain
- [ ] README menjelaskan cara instal, menjalankan, dan membangun ulang aset Blender

---

## 11. Referensi teknis

- Leckie & Greenspan, *An Event-Based Pool Physics Simulator* (2005)
- Han, *Dynamics in Carom and Three Cushion Billiards* (2005): model cushion
- Mathavan, Jackson, Parkin, *A theoretical analysis of billiard ball dynamics under cushion impacts* (2010)
- Dr. Dave Alciatore, *Billiards physics technical proofs* (throw, squirt, aturan 30°/90°)
- **pooltool** (github.com/ekiefl/pooltool): simulator biliar Python berbasis event, acuan implementasi & validasi
- Aturan resmi WPA 9-Ball
- Three.js docs, gltf-transform, pmndrs/postprocessing

---

## 12. Catatan untuk agent pelaksana

1. Kerjakan berurutan M0 → M5. Jangan mulai visual (M2/M3) sebelum fisika M1 lulus test; fisika adalah inti realisme.
2. Setelah setiap milestone: jalankan test + build, commit dengan pesan jelas, beri ringkasan singkat ke user (apa yang jadi, apa yang belum, angka performa).
3. Untuk aset Blender, **selalu render preview dan lihat hasilnya** sebelum menyatakan selesai.
4. Untuk game di browser, **jalankan dan lihat langsung** (built-in browser): screenshot, cek console, ukur fps.
5. Minta izin user sebelum mengunduh Blender, tekstur, atau suara dari internet.
6. Jika ada keputusan desain besar yang tidak tercakup dokumen ini (misalnya mengganti pendekatan fisika), tanya user dulu.
7. Jangan menambahkan fitur di luar scope (§0) tanpa diminta.
