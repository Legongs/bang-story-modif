import { useEffect, useState } from 'react'
import { Plus, Trash2, Upload, Users } from 'lucide-react'
import type { GlobalCharacter } from '@shared/types'
import { Badge, Button, Field, confirmDialog, cx, inputCls } from '../components/ui'
import { errorText } from '../lib/format'
import { useApp } from '../store/app'

/** Settings › Pemeran Tetap: characters always available and used across all generated videos. */
export function GlobalCharactersSection() {
  const { toast } = useApp()
  const [characters, setCharacters] = useState<GlobalCharacter[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isDefault, setIsDefault] = useState(true)

  const reload = async (): Promise<void> => {
    try {
      setLoading(true)
      const list = await window.api.settings.globalCharacters.list()
      setCharacters(list)
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const handleSaveNew = async (): Promise<void> => {
    if (!name.trim()) {
      toast('error', 'Nama karakter tidak boleh kosong')
      return
    }
    try {
      await window.api.settings.globalCharacters.save({ name, description, isDefault })
      setName('')
      setDescription('')
      setAdding(false)
      await reload()
      toast('success', `Karakter "${name}" berhasil ditambahkan`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const handlePickImage = async (id: string): Promise<void> => {
    try {
      const updated = await window.api.settings.globalCharacters.pickImage(id)
      if (updated) {
        await reload()
        toast('success', `Foto untuk "${updated.name}" berhasil diunggah`)
      }
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const handleToggleDefault = async (char: GlobalCharacter): Promise<void> => {
    try {
      await window.api.settings.globalCharacters.save({
        id: char.id,
        name: char.name,
        description: char.description,
        isDefault: !char.isDefault
      })
      await reload()
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const handleDelete = async (char: GlobalCharacter): Promise<void> => {
    const ok = await confirmDialog({
      title: `Hapus karakter ${char.name}?`,
      body: 'Karakter tetap ini akan dihapus dari perpustakaan global.',
      confirm: 'Hapus',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.settings.globalCharacters.remove(char.id)
      await reload()
      toast('info', `Karakter ${char.name} dihapus`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[34px] font-bold tracking-[-0.015em]">Pemeran Tetap (Karakter)</h1>
          <p className="mt-2 max-w-[700px] text-[15px] text-ink-2">
            Unggah karakter atau pemeran tetapmu di sini. Karakter yang ditandai aktif akan selalu otomatis disertakan di setiap proyek dan video baru yang digenerate.
          </p>
        </div>
        <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setAdding(!adding)}>
          {adding ? 'Tutup form' : 'Tambah pemeran'}
        </Button>
      </div>
      {adding && (
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-5 py-[18px]">
          <div className="flex items-center justify-between border-b border-line pb-3 font-semibold text-sm">
            <span>Tambah Karakter Baru</span>
          </div>
          <div className="flex flex-col gap-3">
            <Field label="Nama Karakter">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Budi, Sarah, Dr. Anton"
                className={cx(inputCls, 'h-11 text-sm')}
              />
            </Field>
            <Field label="Deskripsi Ciri & Penampilan" hint="Wajah, rambut, bentuk tubuh, warna kulit, dan pakaian khas">
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Pria berusia 30 tahun, kacamata bingkai hitam, rambut ikal rapi, mengenakan kemeja biru muda..."
                className={cx(inputCls, 'resize-none py-2 text-sm leading-relaxed')}
              />
            </Field>
            <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="size-4 rounded border-line"
              />
              <span>Selalu gunakan karakter ini di setiap video baru yang digenerate</span>
            </label>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button onClick={() => setAdding(false)}>Batal</Button>
              <Button variant="accent" onClick={() => void handleSaveNew()}>
                Simpan Karakter
              </Button>
            </div>
          </div>
        </section>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-muted">Memuat daftar karakter…</div>
      ) : characters.length === 0 ? (
        <section className="flex flex-col items-center justify-center gap-2 py-10 text-center rounded-2xl border border-line bg-surface px-5">
          <Users className="size-10 text-muted" />
          <p className="font-semibold text-ink">Belum ada karakter tetap</p>
          <p className="text-sm text-ink-2 max-w-[420px]">
            Klik tombol &quot;Tambah pemeran&quot; di atas untuk mendaftarkan karakter yang ingin selalu muncul di video-video kamu.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-3">
          {characters.map((c) => (
            <section key={c.id} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-5 py-[18px]">
              <div className="flex items-start gap-4">
                <div className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-line bg-paper flex items-center justify-center">
                  {c.imageUrl ? (
                    <img src={c.imageUrl} alt={c.name} className="size-full object-cover" />
                  ) : (
                    <Users className="size-8 text-muted" />
                  )}
                </div>
                <div className="flex flex-1 min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-base">{c.name}</span>
                    {c.isDefault && <Badge tone="ok">Otomatis di setiap video</Badge>}
                  </div>
                  <p className="text-sm text-ink-2 line-clamp-2">{c.description || 'Tidak ada deskripsi'}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => void handlePickImage(c.id)}>
                      {c.imageUrl ? 'Ganti foto karakter' : 'Unggah foto karakter'}
                    </Button>
                    <Button size="sm" onClick={() => void handleToggleDefault(c)}>
                      {c.isDefault ? 'Nonaktifkan otomatis' : 'Jadikan otomatis'}
                    </Button>
                    <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => void handleDelete(c)}>
                      Hapus
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
