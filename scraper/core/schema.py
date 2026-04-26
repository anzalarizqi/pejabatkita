from __future__ import annotations

import uuid
from datetime import date, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Level(str, Enum):
    nasional = "nasional"
    provinsi = "provinsi"
    kabupaten = "kabupaten"
    kota = "kota"


class StatusJabatan(str, Enum):
    aktif = "aktif"
    penjabat = "penjabat"
    nonaktif = "nonaktif"


class Jenjang(str, Enum):
    sd = "SD"
    smp = "SMP"
    sma = "SMA"
    d3 = "D3"
    s1 = "S1"
    s2 = "S2"
    s3 = "S3"
    lainnya = "lainnya"


class JenisKelamin(str, Enum):
    l = "L"
    p = "P"


class SourceType(str, Enum):
    wikipedia = "wikipedia"
    pemda = "pemda"
    kpu = "kpu"
    kpk = "kpk"
    news = "news"
    other = "other"


class Jabatan(BaseModel):
    posisi: str
    level: Level
    wilayah: str
    kode_wilayah: str
    partai: Optional[str] = None
    mulai_jabatan: Optional[date] = None
    selesai_jabatan: Optional[date] = None
    status: StatusJabatan


class Biodata(BaseModel):
    tempat_lahir: Optional[str] = None
    tanggal_lahir: Optional[date] = None
    jenis_kelamin: Optional[JenisKelamin] = None
    agama: Optional[str] = None


class Pendidikan(BaseModel):
    jenjang: Jenjang
    institusi: str
    jurusan: Optional[str] = None
    tahun_lulus: Optional[int] = None


class Source(BaseModel):
    url: str
    domain: str
    scraped_at: datetime
    type: SourceType


class ConfidenceScore(BaseModel):
    score: float = Field(ge=0.0, le=1.0)
    completeness: float = Field(ge=0.0, le=1.0)
    corroboration: float = Field(ge=0.0, le=1.0)
    notes: Optional[str] = None


class Metadata(BaseModel):
    sources: list[Source] = Field(default_factory=list)
    confidence: ConfidenceScore
    last_updated: datetime
    needs_review: bool = False


class Pejabat(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    nama_lengkap: str
    gelar_depan: Optional[str] = None
    gelar_belakang: Optional[str] = None
    jabatan: list[Jabatan]
    biodata: Biodata
    pendidikan: list[Pendidikan] = Field(default_factory=list)
    metadata: Metadata
