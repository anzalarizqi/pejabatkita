"""Update pejabat.nama_lengkap in Supabase from verified CSV corrections."""
import os, httpx, pathlib

def load_env(path=".env"):
    p = pathlib.Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

load_env()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

CORRECTIONS = [
    # Batch 37
    ("cd0a6e7f-0316-42f9-895d-88c2fef7253c", "Salmanudin Yazid"),        # Wakil Bupati Jombang
    ("cb412c90-20b3-443b-bbb7-ea4cdca112e2", "Dirham Akbar Aksara"),     # Wakil Bupati Lamongan
    ("9efc62d9-7d7b-42c4-9c14-abaf983c14b7", "M. Shobih Asrori"),        # Wakil Bupati Pasuruan
    # Batch 38
    ("a94e0893-977d-4c06-8581-014b80c742c1", "Qowimuddin Thoha"),        # Wakil Walikota Kediri
    # Batch 39
    ("b378441c-f627-4b4f-a717-6498bea88347", "Syamsul Rizal"),           # Wakil Bupati Bengkayang
    ("5b01c835-4a67-4e75-a8dc-a461309965d6", "Sukardi"),                 # Wakil Bupati Kapuas Hulu
    ("368d1d8a-ec50-481f-af2f-0bab0c4c0104", "Erani"),                   # Wakil Bupati Landak
    ("d4037a24-5e35-434a-bf43-95f24357239d", "Malin"),                   # Wakil Bupati Melawi
    ("746bdf2a-d766-49b6-9a3a-612365d9c80a", "Susana Herpena"),          # Wakil Bupati Sanggau
    ("f28c07df-d297-4ef8-9cc9-34196fb3995a", "Said Idrus Al Habsyi"),    # Wakil Bupati Banjar
    ("782619ea-ca8d-4f97-8218-aeb87cd70198", "Suriani"),                 # Wakil Bupati Hulu Sungai Selatan
    # Batch 40
    ("8e21bdfd-ea07-4f91-b21e-1a7e7490feb9", "Bahsanuddin"),             # Wakil Bupati Tanah Bumbu (ejaan)
    ("d79d5214-1fb3-40c5-a5f3-fa41f0349231", "Ananda Krista Algani"),    # Wakil Walikota Banjarmasin (nama tidak lengkap)
    ("4e736620-5278-4082-90c9-4b8a3e5489cd", "Dodo"),                    # Wakil Bupati Kapuas Kalteng (salah orang)
    ("d772bdda-1024-43d8-bfc8-bc0bf37dc950", "Irawati"),                 # Wakil Bupati Kotawaringin Timur (casing)
    ("41137ecb-54fd-45e4-9956-0b68a3423e95", "Abdul Hamid"),             # Wakil Bupati Lamandau (casing)
    ("51e5105a-18c2-44fe-ae39-5ac972290b41", "Rahmanto Muhidin"),        # Wakil Bupati Murung Raya (casing)
    # Batch 41
    ("f390ff67-63d8-4d6c-9fcd-1a0b48a46fb0", "Ahmad Jayadikarta"),      # Wakil Bupati Pulang Pisau (casing)
    ("be3afcf1-814d-409d-b223-5277ace43946", "Suhuk"),                   # Wakil Bupati Mahakam Hulu (PSU - orang baru)
    ("b2aac2ac-84fb-4f30-adad-fdd91f2f8f35", "Abdul Waris Muin"),        # Wakil Bupati Penajam Paser Utara (salah orang)
    ("7f7c2d1b-b989-45c9-adc5-c7a41eca27fe", "Saefuddin Zuhri"),        # Wakil Walikota Samarinda (casing)
    ("f53a9e4b-1c6e-4c05-81ea-3fb20a257b68", "Kilat Bilung"),            # Wakil Bupati Bulungan (nama tidak lengkap)
    ("f0153d92-4b38-40a5-8a82-c21fbaee71e4", "Sabri"),                   # Wakil Bupati Tana Tidung (salah orang)
]

def main():
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    for pejabat_id, new_name in CORRECTIONS:
        url = f"{SUPABASE_URL}/rest/v1/pejabat?id=eq.{pejabat_id}"
        resp = httpx.patch(url, json={"nama_lengkap": new_name}, headers=headers)
        if resp.status_code in (200, 204):
            print(f"OK  {pejabat_id[:8]}... -> {new_name}")
        else:
            print(f"ERR {pejabat_id[:8]}... status={resp.status_code}: {resp.text[:200]}")

if __name__ == "__main__":
    main()
