import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { AspectRatio, KeyTestResult } from '@shared/types'
import { getSettings } from '../settings'
import { sleep } from './http'

const DEFAULT_PORT = 8787
const OUTPUT_ROOT = process.env.FLOW_MCP_OUTPUT || join(homedir(), 'flow-mcp-out')

interface McpRpcResponse<T = any> {
  jsonrpc: '2.0'
  id: number | string
  result?: T
  error?: { code: number; message: string; data?: any }
}

/**
 * Manages interaction with GTAI-1/flow-mcp (Google Flow MCP server).
 * Can interact either via its local HTTP server (port 8787) or via Stdio JSON-RPC.
 */
class FlowMcpClient {
  private proc: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number | string, { resolve: (res: any) => void; reject: (err: any) => void }>()
  private lineBuffer = ''
  private initPromise: Promise<void> | null = null
  private lastStderr = ''
  private knownTools: string[] = []

  private get port(): number {
    return Number(process.env.FLOW_MCP_PORT) || DEFAULT_PORT
  }

  private get httpUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  resetProcess(): void {
    if (this.proc) {
      try {
        this.proc.kill()
      } catch {}
      this.proc = null
    }
    this.pending.clear()
    this.lineBuffer = ''
    this.initPromise = null
    this.knownTools = []
  }

  /** Checks if the Flow MCP HTTP server is already running. */
  async isHttpAlive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.httpUrl}/api/status`, { signal: AbortSignal.timeout(1500) })
      return res.ok
    } catch {
      return false
    }
  }

  /** Calls a tool via the local Flow Studio HTTP server if alive. */
  private async callHttp(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(`${this.httpUrl}/api/tool/${toolName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Flow MCP HTTP ${res.status}: ${text || res.statusText}`)
    }
    return res.json()
  }

  /** Resolves executable, arguments and working directory to avoid cmd.exe quoting bugs on Windows. */
  private resolveSpawnParams(): { exec: string; args: string[]; cwd: string } {
    const localGoogleFlowDir = join(homedir(), 'mcp', 'google-flow-mcp')
    const localGoogleFlowJs = join(localGoogleFlowDir, 'src', 'index.js')
    const localGtaiDir = join(homedir(), 'flow-mcp')
    const localGtaiJs = join(localGtaiDir, 'src', 'index.js')

    const rawCmd = getSettings().flowMcpCommand.trim()

    // Priority 1: User explicitly points to a file or node command
    if (rawCmd && !rawCmd.startsWith('npx')) {
      const clean = rawCmd.replace(/^node\s+/i, '').replace(/^"|"$/g, '')
      if (existsSync(clean)) {
        return { exec: 'node', args: [clean], cwd: dirname(clean) }
      }
    }

    // Priority 2: Auto-detect installed google-flow-mcp or flow-mcp
    if (existsSync(localGoogleFlowJs)) {
      return { exec: 'node', args: [localGoogleFlowJs], cwd: localGoogleFlowDir }
    }
    if (existsSync(localGtaiJs)) {
      return { exec: 'node', args: [localGtaiJs], cwd: localGtaiDir }
    }

    // Fallback: command string
    const isWindows = process.platform === 'win32'
    return {
      exec: isWindows ? 'cmd.exe' : '/bin/sh',
      args: [isWindows ? '/c' : '-c', rawCmd || 'npx flow-mcp'],
      cwd: process.cwd()
    }
  }

  /** Starts or connects to the stdio MCP process if not already running. */
  private async ensureStdio(): Promise<void> {
    if (this.proc && !this.proc.killed) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      this.lastStderr = ''
      const { exec, args, cwd } = this.resolveSpawnParams()

      const child = spawn(exec, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FLOW_MCP_PORT: String(this.port) },
        windowsHide: true
      })

      this.proc = child

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        this.lineBuffer += chunk
        const lines = this.lineBuffer.split('\n')
        this.lineBuffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('{')) continue
          try {
            const msg = JSON.parse(trimmed) as McpRpcResponse
            if (msg.id != null && this.pending.has(msg.id)) {
              const { resolve, reject } = this.pending.get(msg.id)!
              this.pending.delete(msg.id)
              if (msg.error) reject(new Error(msg.error.message || 'MCP Error'))
              else resolve(msg.result)
            }
          } catch {}
        }
      })

      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (errChunk: string) => {
        const text = errChunk.trim()
        if (text) {
          this.lastStderr = text
          console.warn('[flow-mcp:stderr]', text)
        }
      })

      child.on('error', (err) => {
        this.proc = null
        for (const [, p] of this.pending) p.reject(new Error(`Gagal menjalankan Flow MCP: ${err.message}`))
        this.pending.clear()
      })

      child.on('exit', (code) => {
        this.proc = null
        const reason = this.lastStderr ? `: ${this.lastStderr}` : code ? ` (kode keluar ${code})` : ''
        for (const [, p] of this.pending) p.reject(new Error(`Flow MCP process exited${reason}`))
        this.pending.clear()
      })

      try {
        await this.sendRpc('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'bang-story', version: '1.0.0' }
        })
        this.sendNotification('notifications/initialized')
        const listRes = await this.sendRpc<{ tools?: Array<{ name: string }> }>('tools/list', {}).catch(() => null)
        this.knownTools = (listRes?.tools ?? []).map((t) => t.name)
      } catch (e) {
        this.proc?.kill()
        this.proc = null
        throw e
      }
    })()

    try {
      await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  private sendRpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.proc || this.proc.killed || !this.proc.stdin) {
      throw new Error('Flow MCP process belum berjalan')
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP call ${method} timed out`))
      }, 120_000)

      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timeout)
          resolve(val)
        },
        reject: (err) => {
          clearTimeout(timeout)
          reject(err)
        }
      })

      const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
      this.proc!.stdin!.write(frame)
    })
  }

  private sendNotification(method: string, params: Record<string, unknown> = {}): void {
    if (!this.proc || this.proc.killed || !this.proc.stdin) return
    const frame = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'
    this.proc.stdin.write(frame)
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    if (await this.isHttpAlive()) return this.callHttp(name, args)
    await this.ensureStdio()
    const res = await this.sendRpc('tools/call', { name, arguments: args })
    const textPart = res?.content?.find((c: any) => c.type === 'text')
    if (textPart?.text) {
      try {
        return JSON.parse(textPart.text)
      } catch {
        return textPart.text
      }
    }
    return res
  }

  /** Ensures connection to Chrome via flow_connect if supported. */
  async ensureConnected(onProgress?: (msg: string) => void): Promise<void> {
    await this.ensureStdio()
    if (this.knownTools.includes('flow_connect')) {
      onProgress?.('Membuka & menyambungkan browser Chrome ke Google Flow…')
      try {
        await this.callTool('flow_connect', { headless: false })
      } catch (e) {
        console.warn('[flow-mcp] flow_connect error:', (e as Error).message)
      }
    }
  }

  /** Tests connection to Google Flow via Flow MCP. */
  async testConnection(): Promise<KeyTestResult> {
    this.resetProcess()
    try {
      await this.ensureConnected()
      const status = await this.callTool('flow_status')
      const account = status.account || status.expectedAccount
      const parts = ['Terhubung ke Flow MCP']
      if (account) parts.push(`Akun: ${account}`)
      if (status.credits != null) parts.push(`${status.credits} kredit`)
      if (status.browser) parts.push('Chrome terhubung')
      else if (status.flowAccessible) parts.push('Flow siap')
      return { ok: true, message: parts.join(' · ') }
    } catch (e) {
      const msg = (e as Error).message
      return {
        ok: false,
        message: `Gagal terhubung ke Flow MCP: ${msg}`
      }
    }
  }

  /** Waits for jobs to complete and finds the generated file. */
  private async waitForJob(
    jobId: string,
    outputDir: string,
    signal?: AbortSignal,
    onProgress?: (progress: number, message: string) => void
  ): Promise<string> {
    const started = Date.now()
    onProgress?.(0.2, 'Menghubungi Google Flow…')

    while (!signal?.aborted) {
      await sleep(3000, signal)
      const elapsed = Math.round((Date.now() - started) / 1000)
      const waitRes = await this.callTool('flow_wait', { job_ids: [jobId], timeout_seconds: 15 }).catch(() => null)

      const jobs = Array.isArray(waitRes) ? waitRes : waitRes?.jobs ?? []
      const targetJob = jobs.find((j: any) => j.job_id === jobId || j.id === jobId)

      if (targetJob?.status === 'failed') {
        throw new Error(`Google Flow gagal: ${targetJob.error || 'Terjadi kesalahan'}`)
      }

      if (targetJob?.file && existsSync(targetJob.file)) {
        return targetJob.file
      }

      if (existsSync(outputDir)) {
        const files = readdirSync(outputDir)
          .map((f) => join(outputDir, f))
          .filter((f) => statSync(f).isFile() && statSync(f).size > 1000 && statSync(f).mtimeMs >= started - 5000)
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)

        if (files[0] && (targetJob?.status === 'done' || elapsed > 15)) {
          return files[0]
        }
      }

      onProgress?.(Math.min(0.85, 0.2 + elapsed * 0.015), `Google Flow sedang membuat media (${elapsed} dtk)…`)
    }

    throw new Error('Dibatalkan')
  }

  /** Generates an image via Google Flow. Supports both google-flow-mcp and GTAI-1/flow-mcp. */
  async generateImage(opts: {
    prompt: string
    aspectRatio?: AspectRatio
    referencePath?: string | null
    signal?: AbortSignal
    onProgress?: (progress: number, message: string) => void
  }): Promise<string> {
    opts.onProgress?.(0.1, 'Menyiapkan permintaan gambar ke Google Flow…')
    await this.ensureConnected((msg) => opts.onProgress?.(0.15, msg))

    const ratio = opts.aspectRatio === '9:16' ? '9:16' : '16:9'
    const hasImageTool = this.knownTools.includes('flow_generate_image')

    // Branch A: google-flow-mcp (Direct CDP)
    if (hasImageTool) {
      opts.onProgress?.(0.2, 'Mengirim ke Nano Banana / Flow…')
      const args: Record<string, unknown> = {
        prompt: opts.prompt,
        ratio,
        auto_confirm: true,
        model: 'Nano Banana 2'
      }
      if (opts.referencePath && existsSync(opts.referencePath)) {
        args.reference_images = [resolve(opts.referencePath)]
      }
      const res = await this.callTool('flow_generate_image', args)
      if (res?.error) throw new Error(res.error)
      const artifact = res?.artifacts?.[0]?.path || res?.files?.[0]
      if (artifact && existsSync(artifact)) return artifact
      if (res?.screenshot && existsSync(res.screenshot)) return res.screenshot
      throw new Error(res?.message || 'Gagal mengunduh gambar hasil dari Google Flow')
    }

    // Branch B: GTAI-1/flow-mcp
    const args: Record<string, unknown> = {
      prompt: opts.prompt,
      type: 'image',
      aspect_ratio: ratio
    }
    if (opts.referencePath && existsSync(opts.referencePath)) {
      args.reference_images = [resolve(opts.referencePath)]
    }

    const genRes = await this.callTool('flow_generate', args)
    if (genRes?.error) throw new Error(genRes.error)

    const jobs = Array.isArray(genRes?.jobs) ? genRes.jobs : []
    const job = jobs[0]
    const outputDir = genRes?.output_dir || (job?.file_stem ? resolve(OUTPUT_ROOT) : OUTPUT_ROOT)

    if (job?.file && existsSync(job.file)) return job.file
    if (job?.job_id) {
      return this.waitForJob(job.job_id, outputDir, opts.signal, opts.onProgress)
    }

    if (genRes?.file && existsSync(genRes.file)) return genRes.file
    throw new Error('Google Flow tidak mengembalikan hasil gambar')
  }

  /** Generates an AI video via Google Flow (Veo / Omni Flash). */
  async generateVideo(opts: {
    prompt: string
    firstFramePath?: string | null
    durationSec?: number
    aspectRatio?: AspectRatio
    signal?: AbortSignal
    onProgress?: (progress: number, message: string) => void
  }): Promise<string> {
    opts.onProgress?.(0.1, 'Menyiapkan permintaan video ke Google Flow (Veo)…')
    await this.ensureConnected((msg) => opts.onProgress?.(0.15, msg))

    const ratio = opts.aspectRatio === '9:16' ? '9:16' : '16:9'
    const hasVideoTool = this.knownTools.includes('flow_generate_video')

    // Branch A: google-flow-mcp
    if (hasVideoTool) {
      opts.onProgress?.(0.2, 'Mengirim ke Veo 3.1 / Flow…')
      const dur = opts.durationSec && opts.durationSec <= 4 ? '4s' : opts.durationSec && opts.durationSec <= 6 ? '6s' : '8s'
      const args: Record<string, unknown> = {
        prompt: opts.prompt,
        ratio,
        duration: dur,
        model: 'Veo 3.1 - Fast',
        auto_confirm: true
      }
      const res = await this.callTool('flow_generate_video', args)
      if (res?.error) throw new Error(res.error)
      const artifact = res?.artifacts?.[0]?.path || res?.files?.[0] || res?.video
      if (artifact && existsSync(artifact)) return artifact
      throw new Error(res?.message || 'Gagal mengunduh video hasil dari Google Flow')
    }

    // Branch B: GTAI-1/flow-mcp
    const validDurations = [4, 6, 8, 10]
    const durSec = opts.durationSec != null ? validDurations.find((d) => d >= (opts.durationSec as number)) ?? 8 : 8

    const args: Record<string, unknown> = {
      prompt: opts.prompt,
      type: 'video',
      duration: durSec,
      aspect_ratio: ratio
    }
    if (opts.firstFramePath && existsSync(opts.firstFramePath)) {
      args.first_frame = resolve(opts.firstFramePath)
    }

    const genRes = await this.callTool('flow_generate', args)
    if (genRes?.error) throw new Error(genRes.error)

    const jobs = Array.isArray(genRes?.jobs) ? genRes.jobs : []
    const job = jobs[0]
    const outputDir = genRes?.output_dir || (job?.file_stem ? resolve(OUTPUT_ROOT) : OUTPUT_ROOT)

    if (job?.file && existsSync(job.file)) return job.file
    if (job?.job_id) {
      return this.waitForJob(job.job_id, outputDir, opts.signal, opts.onProgress)
    }

    if (genRes?.file && existsSync(genRes.file)) return genRes.file
    throw new Error('Google Flow tidak mengembalikan hasil video')
  }
}

export const flowMcp = new FlowMcpClient()
