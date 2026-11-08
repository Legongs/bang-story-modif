import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
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

  private get port(): number {
    return Number(process.env.FLOW_MCP_PORT) || DEFAULT_PORT
  }

  private get httpUrl(): string {
    return `http://127.0.0.1:${this.port}`
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

  /** Starts or connects to the stdio MCP process if not already running. */
  private async ensureStdio(): Promise<void> {
    if (this.proc && !this.proc.killed) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      const cmdStr = getSettings().flowMcpCommand.trim() || 'npx flow-mcp'
      const isWindows = process.platform === 'win32'

      const child = spawn(isWindows ? 'cmd.exe' : '/bin/sh', [isWindows ? '/c' : '-c', cmdStr], {
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
          } catch {
            // Ignore non-json lines
          }
        }
      })

      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (errChunk: string) => {
        console.warn('[flow-mcp:stderr]', errChunk.trim())
      })

      child.on('error', (err) => {
        console.warn('[flow-mcp:error]', err.message)
        this.proc = null
        for (const [, p] of this.pending) p.reject(new Error(`Gagal menjalankan Flow MCP: ${err.message}. Periksa perintah di Pengaturan.`))
        this.pending.clear()
      })

      child.on('exit', () => {
        this.proc = null
        for (const [, p] of this.pending) p.reject(new Error('Flow MCP process exited'))
        this.pending.clear()
      })

      try {
        await this.sendRpc('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'bang-story', version: '1.0.0' }
        })
        this.sendNotification('notifications/initialized')
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
  /** Tests connection to Google Flow via Flow MCP. */
  async testConnection(): Promise<KeyTestResult> {
    try {
      const status = await this.callTool('flow_status')
      const loggedIn = status.logged_in !== undefined ? !!status.logged_in : status.account != null
      if (!loggedIn) {
        return {
          ok: false,
          message: 'Google Flow belum login di Chrome. Buka Chrome flow-mcp dan masuk dengan akun Google kamu.'
        }
      }
      const parts = ['Terhubung ke Google Flow']
      if (status.account) parts.push(status.account)
      if (status.credits != null) parts.push(`${status.credits} kredit tersisa`)
      return { ok: true, message: parts.join(' · ') }
    } catch (e) {
      const msg = (e as Error).message
      return {
        ok: false,
        message: `Gagal terhubung ke Flow MCP: ${msg}. Pastikan Flow MCP sudah berjalan dan Chrome sudah login ke flow.google.com.`
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

  /** Generates an image via Google Flow. */
  async generateImage(opts: {
    prompt: string
    aspectRatio?: AspectRatio
    referencePath?: string | null
    signal?: AbortSignal
    onProgress?: (progress: number, message: string) => void
  }): Promise<string> {
    opts.onProgress?.(0.1, 'Mengirim permintaan gambar ke Google Flow…')
    const args: Record<string, unknown> = {
      prompt: opts.prompt,
      type: 'image',
      aspect_ratio: opts.aspectRatio === '9:16' ? '9:16' : '16:9'
    }

    if (opts.referencePath && existsSync(opts.referencePath)) {
      args.reference_images = [resolve(opts.referencePath)]
    }

    const genRes = await this.callTool('flow_generate', args)
    if (genRes.error) throw new Error(genRes.error)

    const jobs = Array.isArray(genRes.jobs) ? genRes.jobs : []
    const job = jobs[0]
    const outputDir = genRes.output_dir || (job?.file_stem ? resolve(OUTPUT_ROOT) : OUTPUT_ROOT)

    if (job?.file && existsSync(job.file)) return job.file
    if (job?.job_id) {
      return this.waitForJob(job.job_id, outputDir, opts.signal, opts.onProgress)
    }

    if (genRes.file && existsSync(genRes.file)) return genRes.file
    throw new Error('Google Flow tidak mengembalikan ID pekerjaan')
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
    opts.onProgress?.(0.1, 'Mengirim permintaan video ke Google Flow (Veo)…')
    const validDurations = [4, 6, 8, 10]
    const durSec = opts.durationSec != null ? validDurations.find((d) => d >= (opts.durationSec as number)) ?? 8 : 8

    const args: Record<string, unknown> = {
      prompt: opts.prompt,
      type: 'video',
      duration: durSec,
      aspect_ratio: opts.aspectRatio === '9:16' ? '9:16' : '16:9'
    }

    if (opts.firstFramePath && existsSync(opts.firstFramePath)) {
      args.first_frame = resolve(opts.firstFramePath)
    }

    const genRes = await this.callTool('flow_generate', args)
    if (genRes.error) throw new Error(genRes.error)

    const jobs = Array.isArray(genRes.jobs) ? genRes.jobs : []
    const job = jobs[0]
    const outputDir = genRes.output_dir || (job?.file_stem ? resolve(OUTPUT_ROOT) : OUTPUT_ROOT)

    if (job?.file && existsSync(job.file)) return job.file
    if (job?.job_id) {
      return this.waitForJob(job.job_id, outputDir, opts.signal, opts.onProgress)
    }

    if (genRes.file && existsSync(genRes.file)) return genRes.file
    throw new Error('Google Flow tidak mengembalikan ID video')
  }
}

export const flowMcp = new FlowMcpClient()
