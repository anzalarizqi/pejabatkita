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
    # Batch 42
    ("11e00224-fbee-41f2-b880-e253e24e7e8a", "Raja Bayu Febri Gunadian"),  # Wakil Bupati Anambas (tidak lengkap)
    ("427770c4-74fa-4701-b435-8639dc802eb3", "Jarmin Sidik"),              # Wakil Bupati Natuna (tidak lengkap + all-caps)
    ("d22c26d1-0690-4c37-99ad-098f46ca9792", "Li Claudia Chandra"),        # Wakil Walikota Batam (tidak lengkap)
    ("972037cf-ed7d-4cc4-92a8-e4a63a0bfb2d", "Raja Ariza"),                # Wakil Walikota Tanjung Pinang (casing)
    # Batch 43
    ("075fb856-9ad7-4211-9e11-83f285c7315d", "M. Syaiful Anwar"),          # Wakil Bupati Lampung Selatan (tidak lengkap)
    ("660b89f9-f381-4055-9082-e1c366ebb2d6", "I Komang Koheri"),           # Wakil Bupati Lampung Tengah (tidak lengkap)
    ("f849ceb6-3bc4-491a-8609-bbc5d5906e06", "Azwar Hadi"),                # Wakil Bupati Lampung Timur (casing)
    ("21cfa719-d180-49ed-a870-cafe5cf6df5a", "Antonius Muhammad Ali"),     # Wakil Bupati Pesawaran (salah orang - PSU)
    ("0bfbd981-00c1-4ba3-a551-510bf141a733", "Ayu Asalasiyah"),            # Wakil Bupati Way Kanan (ejaan)
    ("2b7fd141-c4c1-41c0-8623-0cd5f45809fc", "Deddy Amarullah Yacub"),     # Wakil Walikota Bandar Lampung (casing + lengkap)
    # Batch 44
    ("c67a0a84-e462-42d3-b200-6aed976c9fd9", "Sudarmo"),                   # Wakil Bupati Buru (ejaan)
    ("b0e6a698-f966-45e7-975b-31d37fb6ede9", "Mohamad Djumpa"),            # Wakil Bupati Kepulauan Aru (tidak lengkap)
    ("ae93a6fb-a56b-4f0a-94c5-25a21937cc3a", "Agustinus Lekwardai Kilikily"), # Wakil Bupati Maluku Barat Daya (ejaan)
    ("38be7b05-6c03-40d7-862c-4366f16ad2f0", "Juliana Chatarina Ratuanak"), # Wakil Bupati Kep. Tanimbar (salah total)
    ("9a40d169-9576-4e01-b71b-2a535aff2071", "Selfinus Kainama"),           # Wakil Bupati Seram Bagian Barat (casing)
    ("01ef0d99-c62c-4a0f-b2a5-b891aab79906", "Muhammad Mifta Thoha R. Wattimena"), # Wakil Bupati SBT (tidak lengkap)
    ("8ba67cfc-94a0-482c-9be9-fa402df4b409", "Djufri Muhammad"),            # Wakil Bupati Halmahera Barat (casing)
    ("aef81f7b-e231-44a6-83a3-c5ba334e4c9d", "Helmi Umar Muchsin"),        # Wakil Bupati Halmahera Selatan (salah orang)
    ("5c45382c-bbfd-4bdc-9fe2-2ba0ef178bc5", "Ahmad Laiman"),               # Wakil Walikota Tidore Kepulauan (salah orang)
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
