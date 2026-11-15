# Lisensi suara

Game ini **tidak memakai rekaman audio eksternal**. Semua suara (tumbukan bola–bola, bola–cushion,
tip stik, break, miscue, bola masuk pocket + menggelinding di rail pengembali, bola mendarat di
slate, dan room tone) **disintesis saat runtime** oleh `apps/client/src/audio/synth.ts`
(model mode teredam + noise terfilter) — karya orisinal proyek ini, tanpa lisensi pihak ketiga.

Untuk mendengarkan/memeriksa hasil sintesis di luar browser:

    npx tsx tools/render-sounds.ts blender/out/wav

Bila ingin mengganti dengan rekaman, taruh berkas di folder ini dan catat sumber + lisensinya di sini.
