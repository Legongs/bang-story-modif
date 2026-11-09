import { useEffect, useState } from 'react'
import { Film } from 'lucide-react'
import { HF_IMAGE_MODELS, HF_VIDEO_MODELS } from '@shared/higgsfield'
import type { ApiProvider, AppSettings, KeyStatus, KeyTestResult } from '@shared/types'
import { ProviderLogo } from '../components/ProviderLogo'
import { Badge, Button, Field, cx, inputCls } from '../components/ui'
import { errorText } from '../lib/format'
import { useApp } from '../store/app'
import { Card, KeyForm, SectionTitle, StatusBadge } from './Settings'

export function MediaSection({
  settings,
  statusOf,
  onChanged,
  onSettings
}: {
  settings: AppSettings
  statusOf: (p: ApiProvider) => KeyStatus | undefined
  onChanged: () => void
  onSettings: (s: AppSettings) => void
}) {
  const { toast } = useApp()
  const provider = settings.mediaProvider || 'higgsfield'
  const hfStatus = statusOf('higgsfield')
  const [testingFlow, setTestingFlow] = useState(false)
  const [flowStatus, setFlowStatus] = useState<KeyTestResult | null>(null)
  const [flowCmd, setFlowCmd] = useState(settings.flowMcpCommand || 'npx flow-mcp')

  const testFlow = async (): Promise<void> => {
    setTestingFlow(true)
    try {
      const res = await window.api.settings.testFlowMcp()
      setFlowStatus(res)
      toast(res.ok ? 'success' : 'error', res.message)
    } catch (e) {
      const msg = errorText(e)
      setFlowStatus({ ok: false, message: msg })
      toast('error', msg)
    } finally {
      setTestingFlow(false)
    }
  }

  const saveFlowCmd = async (): Promise<void> => {
    try {
      const cleanCmd = flowCmd.trim()
      const s = await window.api.settings.set({ flowMcpCommand: cleanCmd })
      onSettings(s)
      toast('info', 'Menyimpan & menguji koneksi Flow MCP…')
      await testFlow()
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  useEffect(() => {
    if (settings.flowMcpCommand) setFlowCmd(settings.flowMcpCommand)
  }, [settings.flowMcpCommand])

  useEffect(() => {
    if (provider === 'google-flow' && !flowStatus && !testingFlow) {
      void testFlow()
    }
  }, [provider])

  return (
    <>
      <SectionTitle
        icon={<Film className="size-5" />}
        title="Gambar dan video"
        sub="Pilih penyedia untuk membuat gambar klip, lembar karakter, dan video AI: Higgsfield (API) atau Google Flow (Flow MCP)."
      />

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={async () => onSettings(await window.api.settings.set({ mediaProvider: 'higgsfield' }))}
          className={cx(
            'flex flex-col gap-2 rounded-2xl border-[1.5px] p-4 text-left transition-all cursor-pointer',
            provider === 'higgsfield' ? 'border-ink bg-surface shadow-ink' : 'border-line bg-paper hover:bg-surface'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ProviderLogo id="higgsfield" size={32} />
              <span className="font-bold text-base">Higgsfield API</span>
            </div>
            <StatusBadge status={hfStatus} />
          </div>
          <p className="text-xs text-ink-2">
            Model Kling, Soul, Seedance, dll. Memerlukan API key dan kredit per request.
          </p>
        </button>

        <button
          type="button"
          onClick={async () => onSettings(await window.api.settings.set({ mediaProvider: 'google-flow' }))}
          className={cx(
            'flex flex-col gap-2 rounded-2xl border-[1.5px] p-4 text-left transition-all cursor-pointer',
            provider === 'google-flow' ? 'border-ink bg-surface shadow-ink' : 'border-line bg-paper hover:bg-surface'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ProviderLogo id="google-flow" size={32} />
              <span className="font-bold text-base">Google Flow (Flow MCP)</span>
            </div>
            {flowStatus && (
              <Badge tone={flowStatus.ok ? 'ok' : 'bad'}>
                {flowStatus.ok ? 'Terhubung' : 'Gagal'}
              </Badge>
            )}
          </div>
          <p className="text-xs text-ink-2">
            Menggunakan akun Google Flow (Veo & Nano Banana) via Flow MCP (GTAI-1/flow-mcp).
          </p>
        </button>
      </div>
      {provider === 'higgsfield' ? (
        <Card>
          <div className="flex items-center gap-3">
            <ProviderLogo id="higgsfield" />
            <div className="flex flex-1 flex-col">
              <span className="text-base font-bold">Higgsfield</span>
              <span className="text-[13px] text-ink-2">GPT Image 2.5, Kling, Seedance, dan model lain dari akun Higgsfield kamu</span>
            </div>
            <StatusBadge status={hfStatus} />
          </div>
          <KeyForm
            provider="higgsfield"
            name="Higgsfield"
            status={hfStatus}
            placeholder="Tempel hasil tombol Copy API key"
            hint={
              <>
                Di console Higgsfield, buka API Keys lalu klik <strong className="text-ink">Copy API key</strong> dan tempel di sini. Formatnya{' '}
                <code className="rounded bg-sand px-1 font-mono text-xs">KEY_ID:KEY_SECRET</code>.
              </>
            }
            help="Kunci dicek dengan permintaan estimasi biaya, tanpa memakai kredit."
            link="https://higgsfield.ai/s/higgsfield-api-yt-bangtutorial-lPMrHK"
            linkLabel="Buka console Higgsfield"
            onChanged={onChanged}
          />
          <p className="flex items-start gap-2.5 border-t border-dashed border-line pt-4 text-[13px] leading-relaxed text-ink-2">
            <Film className="mt-0.5 size-4 shrink-0" />
            <span>
              Semua {HF_IMAGE_MODELS.length} model gambar dan {HF_VIDEO_MODELS.length} model video Higgsfield bisa dipakai.
            </span>
          </p>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-3">
            <ProviderLogo id="google-flow" />
            <div className="flex flex-1 flex-col">
              <span className="text-base font-bold">Google Flow via Flow MCP</span>
              <span className="text-[13px] text-ink-2">Veo 3.1 & Nano Banana Pro melalui GTAI-1/flow-mcp</span>
            </div>
            {flowStatus && (
              <Badge tone={flowStatus.ok ? 'ok' : 'bad'}>
                {flowStatus.ok ? 'Terhubung' : 'Gagal'}
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-3 border-t border-dashed border-line pt-3">
            <div className="flex items-end gap-2">
              <Field label="Perintah Flow MCP (Node script atau GTAI-1/flow-mcp)" className="flex-1">
                <input
                  value={flowCmd}
                  onChange={(e) => setFlowCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveFlowCmd()
                  }}
                  placeholder='Contoh: node "C:\Users\...\mcp\google-flow-mcp\src\index.js"'
                  className={cx(inputCls, 'h-11 font-mono text-sm')}
                />
              </Field>
              <Button className="h-11" loading={testingFlow} onClick={() => void saveFlowCmd()}>
                Simpan & Uji
              </Button>
              <Button variant="secondary" className="h-11" loading={testingFlow} onClick={() => void testFlow()}>
                Uji Koneksi
              </Button>
            </div>
            {flowStatus && (
              <p className={cx('text-[13px]', flowStatus.ok ? 'text-ok-ink' : 'text-bad-ink')}>
                {flowStatus.message}
              </p>
            )}
            <div className="rounded-xl bg-sand p-3.5 text-xs text-ink-2 leading-relaxed flex flex-col gap-1.5">
              <p className="font-semibold text-ink">Langkah menghubungkan Google Flow:</p>
              <p>1. Jalankan Flow MCP di komputermu (misalnya lewat <code className="bg-paper px-1 py-0.5 rounded font-mono">Flow Studio.cmd</code> dari repositori GTAI-1/flow-mcp, atau <code className="bg-paper px-1 py-0.5 rounded font-mono">npx flow-mcp</code>).</p>
              <p>2. Pastikan sesi Chrome terbuka dan kamu sudah login ke akun Google Flow (flow.google.com).</p>
              <p>3. Klik tombol &quot;Uji Koneksi&quot; di atas untuk memastikan Bang Story siap membuat gambar dan video melalui Google Flow.</p>
            </div>
          </div>
        </Card>
      )}
    </>
  )
}
