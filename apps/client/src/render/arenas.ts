/** Daftar arena pertandingan. Semua visual orisinal & polos (tanpa logo/teks merek). */
export type ArenaId = 'private' | 'red' | 'blue';

export interface ArenaDef {
  id: ArenaId;
  name: string;
  /** keterangan singkat di menu */
  desc: string;
  scene: string;
  room: string;
  table: string;
  /** pengali warna kain (linear) untuk meja pro yang berkain netral */
  cloth?: [number, number, number];
  /** pengali refleksi IBL untuk permukaan ruangan non-logam (probe di atas meja terlalu terang untuk lantai/dinding jauh) */
  roomEnv?: number;
  /** pengali refleksi IBL untuk meja (light bank besar di probe membuat kain/rail tampak pucat) */
  tableEnv?: number;
  /** warna aksen kartu menu */
  accent: string;
}

export const ARENAS: readonly ArenaDef[] = [
  { id: 'private', name: 'Lokal Privat', desc: 'Ruang biliar privat, lampu gantung hangat', scene: 'scene.json', room: 'room.glb', table: 'table.glb', accent: '#c9a45c' },
  {
    id: 'red',
    name: 'CARABAO WNT Indonesia',
    desc: 'Aula turnamen, truss & papan LED merah',
    scene: 'scene_red.json',
    room: 'room_red.glb',
    table: 'table_pro.glb',
    cloth: [0.12, 0.19, 0.34],
    roomEnv: 0.25,
    tableEnv: 0.2,
    accent: '#e0323a',
  },
  {
    id: 'blue',
    name: '49th US Open',
    desc: 'Arena tribun, sorotan biru & merah',
    scene: 'scene_blue.json',
    room: 'room_blue.glb',
    table: 'table_pro.glb',
    cloth: [0.3, 0.27, 0.21],
    roomEnv: 0.25,
    tableEnv: 0.2,
    accent: '#3d6ff0',
  },
];

export function arenaDef(id: string | null | undefined): ArenaDef {
  return ARENAS.find((a) => a.id === id) ?? ARENAS[0];
}
