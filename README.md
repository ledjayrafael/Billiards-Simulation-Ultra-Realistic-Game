# Simulator Biliar 9-Ball Realistis (Web)

Simulator biliar 9-ball berbasis browser dengan fisika bola yang dihitung secara nyata: spin, english, throw, squirt, swerve, dan pantulan cushion. Dimainkan dua orang secara bergantian (hot-seat) di satu komputer dengan mouse dan keyboard.

> **Status:** dalam pengembangan. Rencana kerja dan milestone lengkap ada di [PLAN.md](PLAN.md).
>
> Sebagian besar struktur repo sudah disiapkan, tetapi kode client, server, skrip Blender, dan `tools/export-assets.mjs` belum diimplementasikan. Perintah di bawah menggambarkan kondisi target sesuai PLAN.md.

## Fitur

- **9-ball** sesuai aturan WPA, mode 2 pemain lokal (hot-seat), race to N (1–11)
- **Mesin fisika khusus** (TypeScript, deterministik): event-based, dengan model sliding/rolling/spinning/airborne, tumbukan bola–bola, bola–cushion, dan jaw pocket
- **Aset 3D dibangun dari script** Blender Python (headless) lalu diekspor ke GLB, sehingga dimensi visual dan fisika selalu sama
- **Rendering Three.js** dengan lightmap, env map, dan postprocessing (SSAO, bloom, SMAA)
- **Kamera gameplay** (aim cam, top view, free orbit, shot cam) dan **kamera sinematik** dari Blender
- **Replay** pukulan terakhir, termasuk slow motion 0.25×
- **Server Fastify** yang menyajikan client dan endpoint simulasi, disiapkan untuk mode online di masa depan

Gaya visual dibuat orisinal. Proyek ini tidak memakai nama, logo, UI, atau aset dari game lain.

## Teknologi

| Bagian | Teknologi |
|---|---|
| Aturan game | TypeScript (paket `packages/rules`) |
| Fisika | TypeScript murni, tanpa DOM dan tanpa Three.js (`packages/physics`) |
| Rendering | Three.js + Vite |
| Server | Node.js + Fastify + TypeScript |
| Aset 3D | Blender (`bpy`) + gltf-transform |
| Pengujian | Vitest |
| Paket | npm workspaces |

## Prasyarat

- **Node.js v24** (atau yang lebih baru) dan npm. Proyek ini memakai npm workspaces, bukan pnpm.
- **Blender ≥ 4.5 LTS**, hanya jika ingin membangun ulang aset 3D.
- Browser desktop terbaru: Chrome, Firefox, atau Edge.

## Instalasi

```bash
npm install
cp .env.example .env
```

Isi `.env` sesuai kebutuhan:

| Variabel | Keterangan |
|---|---|
| `BLENDER_BIN` | Path absolut ke binary Blender. Dipakai oleh `npm run assets`. |
| `PORT` | Port server. Default `3000`. |

## Menjalankan

**Mode pengembangan** (Vite di port 5173 dengan proxy `/api` ke server di port 3000):

```bash
npm run dev
```

Buka `http://localhost:5173`.

**Mode produksi lokal** (build client lalu jalankan server):

```bash
npm run build
npm start
```

Buka `http://localhost:3000`.

## Perintah npm

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Menjalankan server dan client sekaligus (mode pengembangan) |
| `npm run build` | Typecheck semua paket lalu build client |
| `npm start` | Menjalankan server yang menyajikan hasil build |
| `npm test` | Menjalankan semua test (Vitest) |
| `npm run typecheck` | Pemeriksaan tipe TypeScript untuk semua paket dan app |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run assets` | Membangun ulang aset 3D lewat Blender headless |

## Membangun ulang aset Blender

Semua aset (meja, bola, stik, ruangan, kamera sinematik, dan lightmap) dibuat oleh script Python di `blender/scripts/`. Script ini bersifat idempoten: setiap jalan akan menghapus scene lalu membangunnya ulang.

```bash
npm run assets
```

Perintah ini memanggil Blender dalam mode headless dan menulis GLB ke `apps/client/public/assets`. Untuk melihat hasil visual, script `render_preview.py` menghasilkan PNG di `blender/out/preview/`.

Dimensi meja, bola, dan pocket hanya didefinisikan di [blender/specs.json](blender/specs.json). File ini dibaca oleh Blender dan TypeScript, sehingga geometri visual dan geometri fisika selalu identik. Satuan yang dipakai adalah SI (meter, kg, detik).

## Struktur repo

```
3d-billiards-simulation/
├─ packages/
│  ├─ physics/      # mesin fisika murni (constants, ball, table, cue, motion, collide/, simulate)
│  ├─ rules/        # aturan 9-ball sebagai state machine murni, termasuk rack
│  └─ shared/       # tipe bersama: ShotParams, GameState, ShotResult
├─ apps/
│  ├─ client/       # Vite + Three.js: render, camera, input, ui, audio, sim (Web Worker), game
│  └─ server/       # Fastify: menyajikan client dan API /api
├─ blender/
│  ├─ scripts/      # build_table, build_balls, build_cue, build_room, build_cameras, bake_lighting, ...
│  ├─ specs.json    # sumber kebenaran dimensi dan koefisien
│  ├─ textures/     # tekstur sumber (CC0) dan LICENSES.md
│  └─ out/          # .blend dan preview PNG (hasil build, tidak di-commit)
└─ tools/
   ├─ export-assets.mjs   # menjalankan Blender headless lalu menyalin GLB ke client
   └─ pooltool-compare/   # (opsional) validasi fisika terhadap pooltool
```

## Arsitektur

### Alur satu pukulan

```
Input (aim, power, spin, elevasi)
  → ShotParams { dir, speed, tipOffset, elevation }
  → Web Worker: physics.simulate(tableState, ShotParams)
  → ShotResult { frames[], events[], finalState, duration }
  → rules.applyShot(gameState, events, finalState) → GameState baru
  → Client memutar frames secara real-time, memicu suara dari events
```

Simulasi dihitung sampai semua bola diam, lalu hasilnya diputar ulang. Dengan cara ini replay tidak perlu komputasi tambahan, dan server online nanti cukup menjalankan fungsi `simulate` yang sama.

### Determinisme

- Tidak ada `Math.random()` di paket `physics`. Rack acak di `rules` memakai PRNG ber-seed (mulberry32), dan seed-nya disimpan di `GameState`.
- Urutan iterasi bola selalu berdasarkan id.
- Tidak ada `Date.now()` di simulasi.

### Model fisika

- **Motion state:** `STATIONARY`, `SPINNING`, `ROLLING`, `SLIDING`, `AIRBORNE`, `POCKETED`, `OFF_TABLE`.
- **Simulasi event-based:** waktu tumbukan berikutnya dihitung untuk setiap pasangan bola (persamaan quartic) dan setiap bola–cushion (quadratic). Event terdekat diproses lebih dulu, lalu semua bola dimajukan secara analitik.
- **Cushion:** model Han (2005) atau Mathavan et al. (2010), dengan tinggi nose cushion dan restitusi yang bergantung pada kecepatan.
- **Stik:** impuls dari tumbukan stik–bola, dengan squirt kecil dan miscue jika offset tip melewati 0.5R.

## Aturan 9-ball

- **Rack:** belah ketupat 1-2-3-2-1, bola 1 di apex pada foot spot, bola 9 di tengah, sisanya diacak.
- **Break:** cue ball harus berada di belakang head string. Sah jika ada bola masuk atau minimal empat object ball menyentuh cushion.
- **Push-out:** bisa dinyatakan setelah break yang sah. Lawan memilih melanjutkan dari posisi itu atau mengembalikan giliran.
- **Pukulan sah:** cue ball harus mengenai bola bernomor terendah lebih dulu. Setelah itu harus ada bola yang masuk atau ada bola yang menyentuh cushion.
- **Foul:** scratch, salah bola pertama, tidak ada kontak, tidak ada cushion, atau object ball keluar meja. Hukumannya ball in hand untuk lawan.
- **Bola 9:** masuk secara sah berarti menang rack. Jika masuk saat foul, bola di-spot ke foot spot.
- **Tiga foul berturut-turut:** kalah rack. Bisa dimatikan di pengaturan.

## Kontrol

| Aksi | Kontrol |
|---|---|
| Bidik | Gerak mouse. Tahan `Shift` untuk bidikan halus |
| Power dan pukul | Tahan klik kiri, tarik mouse ke belakang, lalu dorong ke depan. Alternatif: tahan `Space`, lalu lepas |
| Spin (tip offset) | Klik atau drag di panel cue ball, atau tombol `W` `A` `S` `D` |
| Elevasi stik | `Q` / `E` (0–80°) |
| Ball in hand | Drag cue ball |
| Push-out | Tombol di HUD (hanya muncul saat berlaku) |
| Top view | `T` |
| Reset kamera | `R` |
| Replay pukulan terakhir | `P` |
| Menu / pause | `Esc` |

Garis bidik (aim guide) dan ghost ball bisa diatur di pengaturan: On, Pendek, atau Off. Default-nya Pendek.

## Pengujian

Tes fisika yang wajib lulus sebelum visual dikerjakan:

1. Energi kinetik total tidak naik setelah tumbukan mana pun, dan bola diam tetap diam
2. Cue ball sliding berubah menjadi rolling setelah jarak sesuai teori
3. Stop shot: cue ball berhenti hampir di tempat
4. Aturan 90°: stun shot yang terpotong membuat cue ball pergi sekitar 90°
5. Aturan 30°: cut setengah bola membuat cue ball terdefleksi sekitar 30°
6. Draw dan follow menghasilkan arah yang benar
7. Pantulan cushion: sudut datang ≈ sudut pantul tanpa english
8. Throw: cut setengah bola menghasilkan throw sekitar 1–4°
9. Squirt: english samping maksimum menghasilkan defleksi 1–3°
10. Break 9-ball pada 8.5 m/s: tidak ada bola yang saling tembus, tidak ada NaN, dan selesai di bawah 50 ms
11. Determinisme: simulasi yang sama menghasilkan `finalState` yang identik bit per bit
12. Parity: `POST /api/simulate` menghasilkan `finalState` yang sama dengan worker di browser

Jalankan dengan:

```bash
npm test
```

## Roadmap

| Milestone | Isi |
|---|---|
| M0 | Fondasi: workspaces, TypeScript, ESLint, Vitest, skeleton client dan server, pipeline Blender minimal |
| M1 | Mesin fisika lengkap beserta debug viewer 2D dan test fisika |
| M2 | Aset Blender: meja, bola, stik, ruangan, pencahayaan, kamera sinematik |
| M3 | Scene 3D dan playback: memuat aset, postprocessing, kamera gameplay |
| M4 | Kontrol lengkap, aturan 9-ball, alur hot-seat dari menu sampai layar pemenang |
| M5 | Polish: audio, HUD final, kamera sinematik, replay dan slow motion, pengaturan grafis, kalibrasi fisika |
| M6 | Ekstra (opsional): jump dan massé yang lebih kaya, statistik, simpan pertandingan, mode latihan |

Setiap milestone selesai jika semua test lulus dan `npm run build` berhasil.

## Di luar scope saat ini

Multiplayer online, akun dan login, database, AI lawan, mobile dan touch, serta mode 8-ball atau snooker. Arsitektur dibuat agar penambahan online nanti tidak sulit: `physics` dan `rules` tidak bergantung pada DOM atau Three.js, dan tipe di `packages/shared` berbentuk JSON murni.

## Referensi

- Leckie & Greenspan, *An Event-Based Pool Physics Simulator* (2005)
- Han, *Dynamics in Carom and Three Cushion Billiards* (2005)
- Mathavan, Jackson, Parkin, *A theoretical analysis of billiard ball dynamics under cushion impacts* (2010)
- Dr. Dave Alciatore, *Billiards physics technical proofs*
- [pooltool](https://github.com/ekiefl/pooltool), simulator biliar Python berbasis event
- Aturan resmi WPA 9-Ball
- Three.js, gltf-transform, pmndrs/postprocessing

## Lisensi dan aset

Tekstur dan suara yang dipakai harus berlisensi jelas (CC0 atau yang setara). Sumber dan lisensinya dicatat di:

- `blender/textures/LICENSES.md`
- `apps/client/public/assets/sound/LICENSES.md`
