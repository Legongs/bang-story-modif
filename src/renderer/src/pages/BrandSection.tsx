import { useEffect, useState } from 'react'
import { FileText, Trash2, Upload } from 'lucide-react'
import { Badge, Button, confirmDialog, cx, inputCls } from '../components/ui'
import { errorText } from '../lib/format'
import { useApp } from '../store/app'

/** Settings › Panduan Brand (brand.md): guides script tone, visual identity, and music. */
export function BrandSection({
  brandMarkdown,
  onSave
}: {
  brandMarkdown: string
  onSave: (text: string) => Promise<void>
}) {
  const { toast } = useApp()
  const [content, setContent] = useState(brandMarkdown)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    setContent(brandMarkdown)
    setSaved(true)
  }, [brandMarkdown])

  const handleUpload = async (): Promise<void> => {
    try {
      const res = await window.api.settings.uploadBrand()
      if (res) {
        setContent(res.content)
        setSaved(true)
        toast('success', `File ${res.name} berhasil diunggah (${res.content.length} karakter)`)
      }
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const handleSave = async (): Promise<void> => {
    setBusy(true)
    try {
      await onSave(content)
      setSaved(true)
      toast('success', 'Panduan brand berhasil disimpan')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const handleClear = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Hapus panduan brand?',
      body: 'Teks panduan brand.md akan dikosongkan.',
      confirm: 'Hapus',
      danger: true
    })
    if (!ok) return
    setContent('')
    await onSave('')
    setSaved(true)
    toast('info', 'Panduan brand telah dikosongkan')
  }

  return (
    <>
      <div>
        <h1 className="font-display text-[34px] font-bold tracking-[-0.015em]">Panduan Brand (brand.md)</h1>
        <p className="mt-2 max-w-[700px] text-[15px] text-ink-2">
          Unggah atau tulis aturan brand kamu di sini. Nilai ini akan dimasukkan ke dalam setiap pembuatan naskah, arahan visual, dan musik AI agar gaya dan nada video selalu konsisten.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-5 py-[18px]">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="size-4 text-accent-dark" />
            <span>Isi brand.md</span>
            <Badge tone={content.trim() ? 'ok' : 'draft'}>
              {content.trim() ? `${content.length.toLocaleString('id-ID')} karakter` : 'Belum diisi'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button icon={<Upload className="size-4" />} onClick={() => void handleUpload()}>
              Unggah file brand.md
            </Button>
            {content.trim() && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void handleClear()}>
                Hapus
              </Button>
            )}
          </div>
        </div>

        <textarea
          rows={14}
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setSaved(false)
          }}
          placeholder="# Panduan Brand&#10;&#10;## Nada Bicara (Tone of Voice)&#10;- Santai, ramah, edukatif, tidak menggurui&#10;&#10;## Aturan Visual&#10;- Warna dominan biru & kuning hangat&#10;- Hindari nuansa gelap berlebihan&#10;&#10;## Kata yang Dihindari&#10;- Jangan gunakan kata klise seperti 'rahasia sukses'..."
          className={cx(inputCls, 'w-full resize-y font-mono text-xs leading-relaxed')}
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted">
            {saved ? 'Semua perubahan tersimpan' : 'Ada perubahan yang belum disimpan'}
          </span>
          <Button variant="accent" disabled={saved} loading={busy} onClick={() => void handleSave()}>
            Simpan perubahan
          </Button>
        </div>
      </section>
    </>
  )
}
