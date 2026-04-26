import { createServerSupabase } from '@/lib/supabase'
import { FlagWithPejabat } from '@/lib/types'
import ReviewClient from './ReviewClient'

export default async function ReviewPage() {
  const supabase = await createServerSupabase(true)

  const { data } = await supabase
    .from('flags')
    .select(`
      *,
      pejabat:pejabat_id (
        id, nama_lengkap, biodata, metadata
      ),
      jabatan:pejabat_id (
        posisi, status,
        wilayah:wilayah_id ( nama )
      )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  const flags = (data ?? []) as FlagWithPejabat[]

  return <ReviewClient flags={flags} />
}
