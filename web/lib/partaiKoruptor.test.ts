import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregatePartaiKoruptor } from './partaiKoruptor'
import type { KasusForPartai, KoruptorInfo, JabatanForPartai } from './partaiKoruptor'

const info = (id: string, nama: string): KoruptorInfo => ({
  pejabat_id: id, nama, posisi: 'Bupati', status: 'tersangka',
})

test('counts distinct pejabat per normalized party, ranked desc', () => {
  const cases: KasusForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP',         tanggal_kasus: '2025-01-01' },
    { pejabat_id: 'b', partai: 'PDI-P',        tanggal_kasus: '2025-02-01' }, // alias → PDIP
    { pejabat_id: 'c', partai: 'Gerindra',     tanggal_kasus: '2025-03-01' },
  ]
  const koruptor = [info('a', 'A'), info('b', 'B'), info('c', 'C')]
  const jabatan: JabatanForPartai[] = []
  const res = aggregatePartaiKoruptor(cases, koruptor, jabatan)

  assert.equal(res.belumDikaitkanCount, 0)
  assert.equal(res.rows.length, 2)
  assert.equal(res.rows[0].partai, 'PDIP')
  assert.equal(res.rows[0].koruptorCount, 2)        // a + b, alias-merged
  assert.equal(res.rows[1].partai, 'Gerindra')
  assert.equal(res.rows[1].koruptorCount, 1)
})

test('untagged cases go to belumDikaitkan, not any party', () => {
  const cases: KasusForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP', tanggal_kasus: '2025-01-01' },
    { pejabat_id: 'd', partai: null,   tanggal_kasus: '2025-01-01' },
    { pejabat_id: 'e', partai: '',     tanggal_kasus: '2025-01-01' },
  ]
  const koruptor = [info('a', 'A'), info('d', 'D'), info('e', 'E')]
  const res = aggregatePartaiKoruptor(cases, koruptor, [])

  assert.equal(res.belumDikaitkanCount, 2)
  assert.equal(res.rows.length, 1)
  assert.equal(res.rows[0].koruptorCount, 1)
})

test('party-switcher: numerator party != current jabatan party', () => {
  // pejabat 'a' was PDIP at time of case, now sits in a Golkar seat
  const cases: KasusForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP', tanggal_kasus: '2025-01-01' },
  ]
  const koruptor = [info('a', 'A')]
  const jabatan: JabatanForPartai[] = [
    { pejabat_id: 'a', partai: 'Golkar', status: 'aktif' },
    { pejabat_id: 'z', partai: 'Golkar', status: 'aktif' }, // clean Golkar incumbent
  ]
  const res = aggregatePartaiKoruptor(cases, koruptor, jabatan)

  // koruptor counted under PDIP (party at case), not Golkar
  assert.equal(res.rows.length, 1)
  assert.equal(res.rows[0].partai, 'PDIP')
  assert.equal(res.rows[0].koruptorCount, 1)
  // PDIP terdata is 0 (no active PDIP seats in this fixture); the switcher
  // contributes to Golkar's terdata, but Golkar has no koruptor so no row
  assert.equal(res.rows[0].terdataCount, 0)
})

test('multiple cases for one pejabat count the person once; terdata dedupes seats', () => {
  const cases: KasusForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP', tanggal_kasus: '2025-01-01' },
    { pejabat_id: 'a', partai: 'PDIP', tanggal_kasus: '2025-06-01' },
  ]
  const koruptor = [info('a', 'A')]
  const jabatan: JabatanForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP', status: 'aktif' },
    { pejabat_id: 'a', partai: 'PDIP', status: 'aktif' }, // same person, two seats
    { pejabat_id: 'q', partai: 'PDIP', status: 'nonaktif' }, // inactive — excluded
  ]
  const res = aggregatePartaiKoruptor(cases, koruptor, jabatan)

  assert.equal(res.rows[0].koruptorCount, 1)
  assert.equal(res.rows[0].terdataCount, 1) // 'a' once; 'q' excluded (nonaktif)
})
