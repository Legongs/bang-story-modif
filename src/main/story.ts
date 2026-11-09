import { randomUUID } from 'node:crypto'
import { CAMERA_PRESETS, MOTION_STRENGTHS, TRANSITIONS } from '@shared/motion'
import { LANGUAGES, clipCountFor } from '@shared/models'
import { estimateNarrationMs, needsVisual } from '@shared/script'
import { getStyle } from '@shared/styles'
import type { CameraPresetId, Clip, MotionStrength, MusicPrompt, ProjectBundle, TransitionId, RepurposedShort } from '@shared/types'
import { applyVisuals, charactersOf, clipsOf, createProject, getBundle, getProject, replaceScript, updateProjectEditor, type SceneVisual } from './repo'
import { getSettings } from './settings'
import { generateJson } from './services/llm'

const CAMERA_IDS = CAMERA_PRESETS.map((c) => c.id)
const STRENGTH_IDS = MOTION_STRENGTHS.map((m) => m.id)
const TRANSITION_IDS = TRANSITIONS.map((t) => t.id)

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function languageOf(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.english ?? 'Indonesian'
}

// ---------- step 1 → 2: the script ----------

/** JSON Schema written to satisfy OpenAI strict mode (every property required, no extra keys) and Gemini. */
const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Short catchy video title in the target language, max 60 characters.' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Short scene title in the target language.' },
          story: {
            type: 'string',
            description: 'What happens in this scene, one or two sentences in the target language, so the writer can check the plot.'
          },
          narration: {
            type: 'string',
            description:
              'Voice-over for this scene in the target language, 10 to 18 spoken words, natural spoken rhythm. May contain one or two English vocal tags in angle brackets.'
          }
        },
        required: ['title', 'story', 'narration']
      }
    }
  },
  required: ['title', 'scenes']
}

interface ScriptPlan {
  title?: string
  scenes?: { title?: string; story?: string; narration?: string }[]
}

/** Writes the scene-by-scene script (story and voice-over) that the user reviews before any visuals exist. */
export async function generateScript(projectId: string): Promise<ProjectBundle> {
  const project = getProject(projectId)
  if (!project.synopsis.trim() && !project.research.trim()) {
    throw new Error('Tulis ide cerita atau unggah materi riset dulu.')
  }
  const lang = languageOf(project.language)
  const count = clipCountFor(project.durationSec)
  const brand = getSettings().brandMarkdown.trim()
  const brandRule = brand ? ` Strictly follow the brand guidelines (brand.md):\n${brand}\n` : ''
  const researchRule = project.research.trim()
    ? 'Factual research material / source topic notes are provided. You MUST base your narrative, storyline, scene progression, key facts, and voice-over closely on the factual material and insights provided in the research notes.'
    : ''

  const system = [
    'You are a scriptwriter for faceless YouTube storytelling and explainer videos.',
    'You turn an idea into a sequence of short scenes. Each scene has one line of voice-over.',
    'The first scene is a strong hook. The story has a clear beginning, rising tension and a satisfying ending. The last scene can invite viewers to subscribe.',
    'Keep facts accurate for history and science topics, and always call each character by the same name.',
    researchRule,
    'The narration is voiced by an expressive text-to-speech model. Where it helps the delivery, add a few English vocal tags in angle brackets inside the narration, such as <short pause>, <long pause>, <chuckles>, <sigh>, <gasp> or <whispers>. Use them sparingly, at most one or two per scene, and never other markup.',
    brandRule,
    `Write everything in ${lang}, except the vocal tags, which stay in English.`
  ].filter(Boolean).join(' ')
  const prompt = [
    project.synopsis.trim() ? `Idea / synopsis:\n${project.synopsis}` : '',
    project.research.trim() ? `Research material / source topic notes:\n${project.research}` : '',
    `Target video length: about ${project.durationSec} seconds.`,
    `Write exactly ${count} scenes.`
  ].filter(Boolean).join('\n\n')

  const plan = await generateJson<ScriptPlan>({ system, prompt, schema: SCRIPT_SCHEMA, name: 'script' })
  const scenes = (plan.scenes ?? []).filter((c) => str(c.narration) || str(c.story))
  if (!scenes.length) throw new Error('Model tidak menghasilkan adegan. Coba lagi atau pilih model lain di Pengaturan.')

  replaceScript(
    projectId,
    str(plan.title) || project.title,
    scenes.map((c, i) => ({
      title: str(c.title) || `Adegan ${i + 1}`,
      story: str(c.story),
      narration: str(c.narration),
      durationMs: estimateNarrationMs(str(c.narration))
    }))
  )

  // Auto-repurpose 3 YouTube Shorts for long-form / Everyday Empire projects
  if (project.durationSec >= 450 || brand.includes('Everyday Empire') || project.styleId === 'everyday_empire') {
    try {
      await generateRepurposedShorts(projectId)
    } catch (e) {
      console.warn('[story] Auto-repurposing shorts warning:', e)
    }
  }

  return getBundle(projectId)
}

// ---------- step 2 → 3: visuals for the reviewed script ----------

const VISUAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    world: {
      type: 'string',
      description:
        'One English sentence that fixes the world of the whole video: the place (planet, country, city), the era or year, the technology level and who the people are (for example "humans living in a pressurized colony on Mars around 2150"). Every setting below must agree with it.'
    },
    characters: {
      type: 'array',
      description: 'Every recurring character in the requested scenes, including the existing ones unchanged. Empty if there are none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          identity: {
            type: 'string',
            description:
              'English, what the character is and looks like WITHOUT clothing: species (write "human" for people), gender, age, height and build, skin tone, face, hair, permanent body traits. No clothing, no art-style words.'
          },
          outfit: {
            type: 'string',
            description:
              'English, the default outfit the character wears in MOST of their scenes, with colors and one signature accessory. Choose what fits most scenes: everyday indoor clothes if most scenes are indoors, a spacesuit or armor only if most scenes need it.'
          }
        },
        required: ['name', 'identity', 'outfit']
      }
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scene: { type: 'integer', description: 'The scene number from the script.' },
          setting: {
            type: 'string',
            description:
              'English, self-contained: where and when, always naming the world explicitly (planet or country, era) even if the story makes it obvious, indoor or outdoor, 3 to 5 concrete props or architecture details that prove the world (for example a window showing the red Martian desert), lighting, time of day, color mood.'
          },
          action: {
            type: 'string',
            description:
              'English: the ONE moment shown. Every visible person with role, age, pose and expression, what they are doing, and the concrete visual evidence of what the narration says. Recurring characters by name plus a short role ("Leo, the colony doctor").'
          },
          wardrobe: {
            type: 'array',
            description: 'Clothing of every person visible in the image, including extras.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', description: 'Character name, or a short label for an extra ("the teenager").' },
                source: {
                  type: 'string',
                  enum: ['reference', 'custom'],
                  description:
                    'reference = the recurring character wears their default outfit as on the reference sheet; custom = a different outfit for this scene (always custom for extras).'
                },
                outfit: { type: 'string', description: 'English. For custom: the full outfit with colors. For reference: a few words naming it.' }
              },
              required: ['name', 'source', 'outfit']
            }
          },
          framing: { type: 'string', description: 'English: shot size, camera angle and composition, e.g. "medium full shot, eye level, the height chart fully visible".' },
          avoid: {
            type: 'string',
            description:
              'English, comma-separated: 3 to 6 things an image model is likely to get wrong for THIS scene, e.g. "Earth landscape, aliens, green skin, spacesuits indoors, helmets".'
          },
          characters: { type: 'array', items: { type: 'string' }, description: 'Names of recurring characters visible in the image.' },
          camera: { type: 'string', enum: CAMERA_IDS, description: 'Camera move over the still image that fits the scene mood.' },
          strength: {
            type: 'string',
            enum: STRENGTH_IDS,
            description: 'How strong the camera move is: halus (subtle, calm or emotional), sedang (medium), kuat (strong, action or big reveals).'
          },
          motion: {
            type: 'string',
            description:
              'English direction for animating this still image into a short AI video: what each character does (gesture, expression, small action), what moves in the environment (wind, fire, water, crowd, dust) and one simple camera move. One or two sentences, no dialogue, no on-screen text, never mention music or sound.'
          },
          transition: {
            type: 'string',
            enum: TRANSITION_IDS,
            description: 'Transition into the next scene: fade for calm or time passing, cut for fast action, slideleft for a change of place, zoomin for a dramatic reveal.'
          }
        },
        required: ['scene', 'setting', 'action', 'wardrobe', 'framing', 'avoid', 'characters', 'camera', 'strength', 'motion', 'transition']
      }
    }
  },
  required: ['world', 'characters', 'scenes']
}

type VisualScene = {
  scene?: number
  setting?: string
  action?: string
  wardrobe?: { name?: string; source?: string; outfit?: string }[]
  framing?: string
  avoid?: string
  characters?: string[]
  camera?: string
  strength?: string
  motion?: string
  transition?: string
}

interface VisualPlan {
  world?: string
  characters?: { name?: string; identity?: string; outfit?: string }[]
  scenes?: VisualScene[]
}

/** A character description for image prompts: body and face first, then the outfit shown on the reference sheet. */
function characterLook(c: { identity?: string; outfit?: string }): string {
  const who = str(c.identity).replace(/\.$/, '')
  const outfit = str(c.outfit).replace(/\.$/, '')
  return [who && `${who}.`, outfit && `Default outfit: ${outfit}.`].filter(Boolean).join(' ')
}

/**
 * The scene's image prompt as labelled lines the user can read and edit in the storyboard. The image
 * generator reads the Wardrobe and Avoid lines (see clipPrompt in generation.ts).
 */
function visualText(a: VisualScene): string {
  const wardrobe = (a.wardrobe ?? [])
    .filter((w) => str(w.name))
    .map((w) =>
      w.source === 'reference'
        ? `${str(w.name)} - default outfit as on the reference sheet${str(w.outfit) ? ` (${str(w.outfit)})` : ''}`
        : `${str(w.name)} - custom for this scene: ${str(w.outfit)}`
    )
  return [
    str(a.setting) && `Setting: ${str(a.setting)}`,
    str(a.action) && `Action: ${str(a.action)}`,
    wardrobe.length > 0 && `Wardrobe: ${wardrobe.join('; ')}`,
    str(a.framing) && `Framing: ${str(a.framing)}`,
    str(a.avoid) && `Avoid: ${str(a.avoid)}`
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Designs one image per scene (plus camera move, transition and AI-video direction) from the reviewed
 * script. "missing" only covers scenes without a plan or whose story changed since; "all" redoes every scene.
 */
export async function generateVisuals(projectId: string, mode: 'missing' | 'all'): Promise<ProjectBundle> {
  const project = getProject(projectId)
  const clips = clipsOf(projectId)
  if (!clips.length) throw new Error('Naskah masih kosong. Tambahkan adegan dulu.')
  const empty = clips.findIndex((c) => !c.story.trim() && !c.narration.trim())
  if (empty >= 0) throw new Error(`Adegan ${empty + 1} masih kosong. Isi alur atau narasinya dulu.`)
  const targets = clips.map((c, i) => ({ clip: c, n: i + 1 })).filter((t) => mode === 'all' || needsVisual(t.clip))
  if (!targets.length) return getBundle(projectId)

  const known = charactersOf(projectId)
  const system = [
    'You are the storyboard artist for a faceless YouTube video. The script is final; you design the pictures.',
    'For each requested scene you describe ONE still image, choose the camera move and its strength over that image, the transition into the next scene, and write how the image would move if it is animated as an AI video.',
    'Rules for the image descriptions, which go to a text-to-image model that never sees the script:',
    '1. Every scene is self-contained. Always name the world (planet or country, era, technology) in the setting, even when the story makes it obvious, and add background details that prove it. Without this the model falls back to present-day Earth.',
    '2. Turn narration into a literal, showable moment. When the narration is a general statement ("after generations, children grow taller"), invent one concrete situation that shows it with visible evidence (a height chart, a comparison with an adult, an old photo), never a symbol or a vague mood.',
    '3. Describe people plainly as humans. Do not use words an image model may read literally or as fantasy, such as Martian, alien, native, creature, mutant, hybrid or "-born", unless they really are not human; describe the difference concretely instead ("a human teenager, about 2.1 m tall, very slender, long limbs, normal human face").',
    '4. Clothing must suit the place and action: no spacesuits or helmets inside a pressurized room, a spacesuit outside on an airless surface, period clothing for history. A recurring character keeps their default outfit (source "reference") unless the scene needs something else; then use "custom" and describe the new outfit in full. Describe the clothing of every extra too.',
    '5. Keep every recurring character visually consistent: reuse the existing characters exactly as given (same name, identity and outfit) and only add characters that are missing. Characters are only people who appear in several scenes; one-off people are extras described inside the scene.',
    '6. No readable text, signs, captions or labels in the image. Vary shot sizes, angles and camera moves across scenes so the video never feels repetitive.',
    'Write "world", "identity", "outfit", "setting", "action", "wardrobe", "framing", "avoid" and "motion" in English.'
  ].join('\n')
  const script = clips
    .map((c, i) => `Scene ${i + 1}: ${c.title}\nStory: ${c.story || '(none)'}\nNarration (${languageOf(project.language)}): ${c.narration || '(none)'}`)
    .join('\n\n')
  const brand = getSettings().brandMarkdown.trim()
  const prompt = [
    `Visual style of the video (for your framing choices only, do not repeat it in the descriptions): ${getStyle(project.styleId).name}.`,
    `Frame format: ${project.aspectRatio === '9:16' ? 'vertical 9:16' : 'horizontal 16:9'}.`,
    `Idea of the video: ${project.synopsis || '(none)'}`,
    project.research.trim() ? `Topic research context:\n${project.research.slice(0, 1500)}` : '',
    brand ? `Brand visual guidelines:\n${brand}` : '',
    known.length ? `Existing characters (keep them exactly):\n${known.map((c) => `- ${c.name}: ${c.description}`).join('\n')}` : 'There are no existing characters yet.',
    `Full script:\n${script}`,
    `Write visuals for these scenes only: ${targets.map((t) => t.n).join(', ')}.`,
    `Allowed camera values: ${CAMERA_IDS.join(', ')}. Allowed strength values: ${STRENGTH_IDS.join(', ')}. Allowed transition values: ${TRANSITION_IDS.join(', ')}.`
  ].filter(Boolean).join('\n\n')

  const plan = await generateJson<VisualPlan>({ system, prompt, schema: VISUAL_SCHEMA, name: 'visuals' })
  const answers = (plan.scenes ?? []).filter((s) => str(s.setting) || str(s.action))
  if (!answers.length) throw new Error('Model tidak menghasilkan visual. Coba lagi atau pilih model lain di Pengaturan.')

  // Match answers to scenes by number; anything unnumbered fills the remaining targets in order.
  const byNumber = new Map<number, (typeof answers)[number]>()
  const loose: typeof answers = []
  for (const a of answers) {
    const n = Number(a.scene)
    if (Number.isInteger(n) && targets.some((t) => t.n === n) && !byNumber.has(n)) byNumber.set(n, a)
    else loose.push(a)
  }
  const updates: SceneVisual[] = []
  for (const t of targets) {
    const a = byNumber.get(t.n) ?? loose.shift()
    if (!a) continue
    updates.push(toSceneVisual(t.clip, a))
  }

  applyVisuals(
    projectId,
    (plan.characters ?? []).filter((c) => str(c.name)).map((c) => ({ name: str(c.name), description: characterLook(c) })),
    updates
  )
  return getBundle(projectId)
}

function toSceneVisual(clip: Clip, a: NonNullable<VisualPlan['scenes']>[number]): SceneVisual {
  const camera = str(a.camera) as CameraPresetId
  const strength = str(a.strength) as MotionStrength
  const transition = str(a.transition) as TransitionId
  return {
    clipId: clip.id,
    visualPrompt: visualText(a),
    characterNames: Array.isArray(a.characters) ? a.characters.filter((n): n is string => typeof n === 'string') : [],
    cameraPreset: CAMERA_IDS.includes(camera) ? camera : clip.cameraPreset,
    motionStrength: STRENGTH_IDS.includes(strength) ? strength : clip.motionStrength,
    videoPrompt: str(a.motion),
    transition: TRANSITION_IDS.includes(transition) ? transition : clip.transition
  }
}

// ---------- background music ----------

const MUSIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Short English track title, max 40 characters.' },
    style: {
      type: 'string',
      description:
        'Suno "Style of Music" field: 6 to 12 comma-separated English tags covering genre, mood, main instruments, tempo in BPM and "instrumental". Max 180 characters.'
    },
    exclude: { type: 'string', description: 'Suno "Exclude styles" field: comma-separated English tags to avoid, such as vocals or anything that would fight the voice-over. Max 80 characters.' },
    description: {
      type: 'string',
      description:
        'One English paragraph (50 to 90 words) for any text-to-music AI: genre, mood, instruments, tempo, how the energy moves from the opening to the ending, instrumental with no vocals, sits under a narrator, and the target length.'
    },
    reason: { type: 'string', description: 'One sentence in Indonesian telling the creator why this music suits the video.' }
  },
  required: ['title', 'style', 'exclude', 'description', 'reason']
}

/** A prompt for background music that suits the story, to paste into Suno or another music AI. */
export async function generateMusicPrompt(projectId: string): Promise<MusicPrompt> {
  const b = getBundle(projectId)
  const p = b.project
  const clips = b.clips
  if (!clips.some((c) => c.narration.trim() || c.story.trim()) && !p.synopsis.trim() && !p.research.trim()) throw new Error('Naskah masih kosong.')
  const durationSec = Math.max(10, Math.round(clips.reduce((n, c) => n + c.durationMs, 0) / 1000) || p.durationSec)
  const style = getStyle(p.styleId)
  const brand = getSettings().brandMarkdown.trim()
  const system = [
    'You are a music supervisor for faceless YouTube storytelling videos.',
    'You pick background music that supports a voice-over without competing with it: instrumental, no vocals or choirs with words, clear space in the mid range where the voice sits.',
    brand ? `Ensure the music mood, era, and tone strictly match the brand guidelines:\n${brand}` : '',
    'Match the setting and era of the story (for example gamelan or kendang colours for an old Javanese kingdom, orchestral for epic history, lo-fi for a calm explainer) and follow its emotional arc from the hook to the ending.',
    'Write the music fields in English, because music AIs understand English best. Never name real artists or copyrighted songs.'
  ].filter(Boolean).join(' ')
  const scenes = clips
    .map((c, i) => `${i + 1}. ${c.title}: ${c.story || c.narration}`.slice(0, 260))
    .join('\n')
  const prompt = [
    `Video title: ${p.title || '(untitled)'}`,
    `Idea: ${p.synopsis || '(none)'}`,
    p.research.trim() ? `Research topic: ${p.research.slice(0, 500)}` : '',
    `Visual style: ${style.name}.`,
    `Video length: about ${durationSec} seconds.`,
    `Scenes:\n${scenes}`
  ].filter(Boolean).join('\n\n')
  const r = await generateJson<Partial<MusicPrompt>>({ system, prompt, schema: MUSIC_SCHEMA, name: 'music' })
  const out: MusicPrompt = {
    title: str(r.title),
    style: str(r.style),
    exclude: str(r.exclude),
    description: str(r.description),
    reason: str(r.reason),
    durationSec
  }
  if (!out.style && !out.description) throw new Error('Model tidak menghasilkan prompt musik. Coba lagi.')
  return out
}

// ---------- Long-to-Shorts Auto-Repurposing Engine ----------

const REPURPOSE_SHORTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shorts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          shortId: { type: 'string' },
          angle: {
            type: 'string',
            enum: ['THE_HIDDEN_MECHANISM', 'THE_SECRET_MONOPOLY', 'THE_BUTTERFLY_EFFECT']
          },
          title: { type: 'string' },
          targetDurationSec: { type: 'integer' },
          linkedLongVideoCTA: { type: 'string' },
          segments: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                phase: {
                  type: 'string',
                  enum: ['HOOK_0_4S', 'CORE_MECHANISM_4_35S', 'BRIDGE_LOOP_35_48S']
                },
                durationSec: { type: 'integer' },
                narrationText: { type: 'string' },
                joke: { type: 'boolean' },
                diegeticText: { type: 'string' },
                gulliverPose: {
                  type: 'string',
                  enum: ['inspecting', 'shocked', 'pointing', 'calculating', 'saluting']
                }
              },
              required: ['phase', 'durationSec', 'narrationText', 'joke', 'diegeticText', 'gulliverPose']
            }
          }
        },
        required: ['shortId', 'angle', 'title', 'targetDurationSec', 'linkedLongVideoCTA', 'segments']
      }
    }
  },
  required: ['shorts']
}

export async function generateRepurposedShorts(projectId: string): Promise<RepurposedShort[]> {
  const b = getBundle(projectId)
  const p = b.project
  const clips = b.clips
  const scenesText = clips.map((c, i) => `Scene ${i + 1} (${c.title}): ${c.narration || c.story}`).join('\n')

  const system = [
    'You are the Master Auto-Repurposing Engine for "The Economic Everyday Empire".',
    'From the provided long-form investigative script, extract exactly 3 YouTube Shorts according to the Single Source of Truth architecture:',
    '1. Short #1 (THE_HIDDEN_MECHANISM): Extract the single craziest engineering or physics mechanism from Act 2.',
    '2. Short #2 (THE_SECRET_MONOPOLY): Extract the shadowy monopoly / giant company controlling 50% to 90% of the world from Act 3.',
    '3. Short #3 (THE_BUTTERFLY_EFFECT): Extract the origin paradox or the catastrophic supply chain collapse if the object stopped for 48 hours from Act 1 & 4.',
    'Each Short must be strictly 38 to 50 seconds in length and contain exactly 3 segments in sequence:',
    '- HOOK_0_4S: 0-4 seconds. Instant pattern interrupt or bizarre contrasting number. Absolutely no hello or greeting.',
    '- CORE_MECHANISM_4_35S: 4-35 seconds. Super dense, fast-paced technical or business revelation. Include a physical diegetic text phrase (e.g. "50% MARKET SHARE", "30 DEGREE ANGLE"). Set joke to true if there is a sharp funny punchline or shocking stat.',
    '- BRIDGE_LOOP_35_48S: 35-48 seconds. Cliffhanger CTA pointing to the related video button below. The very last words of this segment MUST seamlessly loop back grammatically to the first word of the 0-4s hook!',
    'Write narration in energetic, intelligent, fast-paced English (165-180 WPM).'
  ].join(' ')

  const prompt = [
    `Video topic: ${p.title || p.synopsis}`,
    `Long-form script scenes:\n${scenesText}`
  ].join('\n\n')

  const res = await generateJson<{ shorts?: Array<any> }>({
    system,
    prompt,
    schema: REPURPOSE_SHORTS_SCHEMA,
    name: 'auto_generated_shorts'
  })

  const rawShorts = res.shorts ?? []
  const outShorts: RepurposedShort[] = rawShorts.slice(0, 3).map((s, idx) => {
    const angle = s.angle ?? (idx === 0 ? 'THE_HIDDEN_MECHANISM' : idx === 1 ? 'THE_SECRET_MONOPOLY' : 'THE_BUTTERFLY_EFFECT')
    return {
      shortId: s.shortId || `short_${idx + 1}_${angle.toLowerCase()}`,
      angle,
      title: str(s.title) || `Short #${idx + 1}: ${p.title || 'Everyday Empire'}`,
      aspectRatio: '9:16',
      targetDurationSec: typeof s.targetDurationSec === 'number' ? s.targetDurationSec : 45,
      linkedLongVideoCTA: str(s.linkedLongVideoCTA) || 'Tap the related video below to watch the full investigation.',
      segments: Array.isArray(s.segments)
        ? s.segments.map((seg: any) => ({
            phase: seg.phase ?? 'CORE_MECHANISM_4_35S',
            durationSec: typeof seg.durationSec === 'number' ? seg.durationSec : 15,
            narrationText: str(seg.narrationText),
            joke: !!seg.joke,
            diegeticText: str(seg.diegeticText) || 'THE EVERYDAY EMPIRE',
            gulliverState: {
              pose: seg.gulliverPose ?? (seg.joke ? 'shocked' : 'pointing'),
              lipSync: true,
              monoclePop: !!seg.joke
            },
            sfxCues: [
              { timeOffsetMs: 300, sfxId: (seg.joke ? 'coin_spring' : 'pop_soft') as any },
              ...(seg.phase === 'BRIDGE_LOOP_35_48S' ? [{ timeOffsetMs: 1500, sfxId: 'whoosh_fast' as const }] : [])
            ]
          }))
        : []
    }
  })

  updateProjectEditor(projectId, { autoGeneratedShorts: outShorts })
  return outShorts
}
export async function createProjectFromShort(projectId: string, shortId: string): Promise<ProjectBundle> {
  const longBundle = getBundle(projectId)
  const shorts = longBundle.project.editor.autoGeneratedShorts ?? []
  const short = shorts.find((s) => s.shortId === shortId) ?? shorts[0]
  if (!short) throw new Error('Shorts tidak ditemukan')

  const newProject = createProject({
    synopsis: `${short.title} (${short.angle}) — Repurposed from ${longBundle.project.title}`,
    durationSec: short.targetDurationSec,
    language: 'en',
    aspectRatio: '9:16',
    styleId: longBundle.project.styleId || 'everyday_empire',
    ttsProvider: longBundle.project.ttsProvider,
    mediaProvider: longBundle.project.mediaProvider
  })

  const scenes = short.segments.map((seg: any, i: number) => ({
    title: `Part ${i + 1}: ${seg.phase.replace(/_/g, ' ')}`,
    story: `[${seg.phase}] ${seg.diegeticText}`,
    narration: seg.narrationText,
    durationMs: seg.durationSec * 1000
  }))

  replaceScript(newProject.id, short.title, scenes)

  const overlays = short.segments
    .filter((seg: any) => seg.diegeticText?.trim())
    .map((seg: any, i: number) => {
      let start = 0
      for (let j = 0; j < i; j++) start += short.segments[j].durationSec
      return {
        id: randomUUID(),
        kind: 'text' as const,
        anchor: 5 as const,
        x: 0.5,
        y: 0.38,
        start,
        end: start + seg.durationSec,
        text: seg.diegeticText.toUpperCase(),
        size: 0.038,
        color: '#F7BE3B',
        style: 'box' as const,
        bold: true
      }
    })

  updateProjectEditor(newProject.id, { overlays })
  return getBundle(newProject.id)
}


