/**
 * MASTER BRAND & SYSTEM ARCHITECTURE MANUAL: THE ECONOMIC EVERYDAY EMPIRE
 * Single Source of Truth (SSOT) for prompts, color palette, storytelling acts, and auto-repurposing.
 */

export const ECONOMIC_EMPIRE_PALETTE = {
  cream: '#FDF7EC',
  sand: '#EADFC8',
  ink: '#1C2B38',
  navy: '#214154',
  gold: '#F7BE3B',
  sea: '#28A4C4',
  cyan: '#7CE4F8',
  coral: '#E85848',
  mint: '#5ED6B3'
} as const

export type GulliverPose = 'inspecting' | 'shocked' | 'pointing' | 'calculating' | 'saluting'

export interface GulliverState {
  pose: GulliverPose
  lipSync: boolean
  monoclePop: boolean
}

export interface SfxCue {
  timeOffsetMs: number
  sfxId: 'whoosh_fast' | 'coin_spring' | 'pop_soft' | 'bloop' | 'data_tick' | 'cash_register'
}

export interface RepurposedShortSegment {
  phase: 'HOOK_0_4S' | 'CORE_MECHANISM_4_35S' | 'BRIDGE_LOOP_35_48S'
  durationSec: number
  narrationText: string
  joke: boolean
  gulliverState: GulliverState
  diegeticText: string
  sfxCues: SfxCue[]
}

export interface RepurposedShort {
  shortId: string
  angle: 'THE_HIDDEN_MECHANISM' | 'THE_SECRET_MONOPOLY' | 'THE_BUTTERFLY_EFFECT'
  title: string
  aspectRatio: '9:16'
  targetDurationSec: number
  linkedLongVideoCTA: string
  segments: RepurposedShortSegment[]
}

export const MASTER_BRAND_MANUAL = `# MASTER BRAND MANUAL: THE ECONOMIC EVERYDAY EMPIRE

## 1. IDENTITAS BRAND & TARGET MONETISASI
* Channel: The Economic Everyday Empire (Investigasi benda sepele, mekanisme tersembunyi, rantai pasok, monopoli industri global).
* Audiens: Global Tier-1 (US, UK, Canada, Australia, Western Europe).
* Bahasa: English (US/UK Natural, cerdas, witty, sedikit sarkas/jenaka, fast-paced).
* Referensi Gaya: Kurzgesagt (Visual & Kinetika) + Vox / Johnny Harris / Wendover (Investigasi & 4-Babak).

## 2. ATURAN VIDEO LONG-FORM (16:9)
* Rasio: 16:9 (1920x1080 @ 60fps).
* Durasi: 8:15 s/d 10:00 (495–600 detik). Batas minimal Mid-Roll Ads adalah 8:00.
* Panggung: 4–5 Babak Utama (@ ~1.5–2 menit). Transisi Whip Pan / Slide 96px + sfx whoosh.
* Pacing: 150–165 WPM. Total naskah: 1.250–1.600 kata.

## 3. ATURAN YOUTUBE SHORTS (9:16)
* Rasio: 9:16 (1080x1920 @ 60fps).
* Durasi: 38–52 detik (1 Scene padat, perubahan komposisi kamera dinamis tiap 3–4s).
* Pacing: 165–180 WPM (100–145 kata).
* Safe Zone: Atas 180px, Bawah 420px, Kanan 180px. Center Safe Box: 720x1100.

## 4. AUTO-REPURPOSING ENGINE (1 LONG = 3 SHORTS)
Pipeline otomatis menghasilkan 3 Shorts dari setiap video Long-Form:
1. Short #1 (The Mechanism Angle): Babak 2 (The Hidden Mechanism).
2. Short #2 (The Monopoly Angle): Babak 3 (The Secret Monopoly).
3. Short #3 (The Paradox/History Angle): Babak 1 & 4 (Asal-usul / Efek Kupu-kupu).
Blok waktu: 0–4s Shock Hook, 4–35s Core Meat, 35–48s Cliffhanger Bridge + Seamless Loop.

## 5. FORMULA 4-BABAK STORYTELLING
* Babak 1 (0-15%): The Mundane Hook. Benda sepele di tangan penonton, Pattern Interrupt di 5 detik pertama.
* Babak 2 (15-45%): The Hidden Mechanism. Bedah mekanis cross-section, presisi mikroskopis, fisika material.
* Babak 3 (45-80%): The Secret Monopoly. Perusahaan bayangan penguasa 50-90% pasar dunia.
* Babak 4 (80-100%): The Butterfly Effect. Skenario jika pabrik berhenti 48 jam, kesimpulan filosofis cerdas.
* Retention Anchors tiap 90 detik. Joke trigger tiap 45–60 detik ditandai "joke": true.

## 6. VISUAL & MASKOT GULLIVER (KURZGESAGT)
* Visual: 2D flat vector, high contrast, zero grain, squircle border-radius, soft geometric shadows, no harsh black outlines.
* Palet Warna: Cream (#FDF7EC), Sand (#EADFC8), Ink (#1C2B38), Navy (#214154), Gold (#F7BE3B), Sea (#28A4C4), Cyan (#7CE4F8), Coral (#E85848), Mint (#5ED6B3).
* Maskot Gulliver: Burung camar kapten kargo, topi Navy #214154, monokel emas #F7BE3B. Lip-sync paruh ke VO, monocle spring pop saat joke: true. Poses: inspecting, shocked, pointing, calculating, saluting.
* Teks Diegetik: Tertanam pada objek fisik (plat kargo, layar monitor, rambu, blueprint). Easing back.out(1.4).

## 7. TATA SUARA SIARAN
* Voiceover: -14.5 s/d -16.0 LUFS (True Peak max -1.0 dBTP).
* BGM: Marimba/kalimba/pizzicato strings 112–124 BPM, level -19 dB dengan auto-ducking.
* SFX: 8–14 SFX/menit (pop_soft, bloop, data_tick, cash_register, coin_spring, whoosh_fast) level -10 s/d -14 dB.`
