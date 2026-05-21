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
    # Batch 45
    ("b4b6b9b6-dfba-400b-a6bf-6830f902f3b5", "dr. H. Irfan"),              # Wakil Bupati Bima (tidak lengkap)
    ("f6437343-1dbd-45f7-b3e8-89dbc56e25d1", "Hj. Nurul Adha"),           # Wakil Bupati Lombok Barat (gelar)
    ("9df8cfac-dac5-49d8-9f00-91b812adcb90", "M. Nursiah"),                # Wakil Bupati Lombok Tengah (all-caps)
    ("92f10588-efac-4d34-95d6-79740e07b420", "Moh. Edwin Hadiwijaya"),     # Wakil Bupati Lombok Timur (all-caps + nonaktif harus aktif)
    ("61b6ec74-545f-44f5-b263-4eec10d5557c", "Vicente Hornai Gonsalves"), # Wakil Bupati Belu (all-caps)
    ("ba41b3d8-feca-4699-a423-d9d8970cf96d", "Dominikus Minggu Mere"),    # Wakil Bupati Ende (tidak lengkap)
    ("30eff7a1-89a5-4903-b5ac-81f146f499a2", "Ignasius Boli Uran"),       # Wakil Bupati Flores Timur (tidak lengkap)
    ("d3fd4ce9-b4f7-468c-a56d-438712bebe8f", "Aurum Obe Titu Eki"),       # Wakil Bupati Kupang (O. → Obe)
    ("4ff0ddb8-dcc2-4906-a646-a411f9234826", "Fabianus Abu"),              # Wakil Bupati Manggarai (salah orang - bukan Yulianus Weng)
    # Batch 46
    ("3211b9bb-e7bc-4d72-a0dc-0f7066d041e9", "Gonzalo Gratianus Muga Sada"),  # Wakil Bupati Nagekeo (salah orang - Bernadinus Dhey Ngebu adalah Wabup Ngada)
    ("feb5b166-0ea2-48a8-b9de-e3c35ee38dc1", "Thobias Uly"),               # Wakil Bupati Sabu Raijua (all-caps)
    ("805cdd93-f050-4e96-adaa-e3a62d02d680", "Timotius Tede Ragga"),       # Wakil Bupati Sumba Barat (salah eja + tidak lengkap)
    ("08575728-3099-4850-8c57-05f673f5b2ae", "Yonathan Hani"),             # Wakil Bupati Sumba Timur (all-caps)
    ("ccc62609-8cd2-4470-b134-dbf8719effb3", "Johni Asadoma"),             # Wakil Gubernur NTT (salah eja Johanis → Johni)
    ("7550a300-995e-408d-8ab6-63ef49811ebc", "Daud"),                      # Wakil Bupati Keerom (all-caps single name)
    ("0536e739-31fa-44ef-988d-ec7b4b6be62b", "Roi Palunga"),               # Wakil Bupati Kepulauan Yapen (all-caps)
    # Batch 47
    ("731193d0-1090-48a5-ba47-02592b51826d", "Isak Wariensi"),             # Wakil Bupati Kaimana (salah orang - Hasbulla Furuada periode lama)
    ("911c352e-0c62-4812-b800-7170ef5df818", "Anthonius Alex Marani"),     # Wakil Bupati Teluk Wondama (salah orang - Andarias Kayukatuy periode lama)
    ("acf7f101-c18e-4911-b2e2-98a0f313dace", "Ferdinando Solossa"),        # Wakil Bupati Maybrat (salah orang - Yance Way bukan Wabup)
    ("4b350685-1540-4c03-b99e-dc4f0d0c0a3c", "Ahmad Sutejo"),              # Wakil Bupati Sorong (all-caps + nama lengkap)
    # NOTE: line 902 Ones Pahabol → provinsi harus "Papua Pegunungan" bukan "Papua" (province fix, not name fix)
    # NOTE: line 910 Aryoko Rumaropen → provinsi harus "Papua" bukan "Papua Barat" (province fix, not name fix)
    # Batch 48
    ("eca7f142-7553-4ea9-bbf5-cbf105bf5f0a", "Yoel Manggaprou"),           # Wakil Bupati Asmat (all-caps; aktif bukan nonaktif)
    ("d86448c1-b3f1-4b9f-83f2-d9ea0cdf288d", "Yuliten Anouw"),            # Wakil Bupati Dogiyai (salah eja Anou → Anouw)
    ("d02b71e6-59f5-44d0-828a-071d37e046b7", "Burhanuddin Pawennari"),     # Wakil Bupati Nabire (P. = Pawennari; salah eja Burhaniddin → Burhanuddin)
    # Batch 49
    ("0316ba25-74fd-47ad-9677-7598e52d742c", "Ham Yogi"),                  # Wakil Bupati Paniai (all-caps)
    ("3d2c010b-bc8d-4b89-8491-71d948a8a1b7", "Naftali Akwal"),             # Wakil Bupati Puncak (salah orang - Jaya Mus Kogoy adalah Wabup Puncak Jaya)
    ("126703ad-c07c-47a4-b8d2-fe1e9955f261", "Hendrizal"),                 # Wakil Bupati Indragiri Hulu (all-caps; aktif bukan nonaktif)
    ("7fcbb2e8-f27d-410c-be93-203b02382f2f", "Husni Tamrin"),              # Wakil Bupati Pelalawan (salah eja Thamrin → Tamrin)
    ("13bb29d4-7d84-4a48-900f-02afef70170e", "Sudirman"),                  # Wakil Bupati Mamasa (all-caps)
    # Batch 50
    ("93449789-c04e-4332-bbdd-52ba395431d0", "Askary"),                    # Wakil Bupati Mamuju Tengah (all-caps)
    ("4c282cdf-e182-4f30-b713-2c76da702776", "Herny Agus"),               # Wakil Bupati Pasangkayu (tidak lengkap)
    ("7bc28966-6e7e-4bce-8403-7e4e6714e56b", "Andi Nursami Masdar"),      # Wakil Bupati Polewali Mandar (tidak lengkap)
    ("e67b3dc7-5c54-4cb1-afef-f2041a8654f2", "Salim S. Mengga"),          # Wakil Gubernur Sulawesi Barat (salah orang)
    ("1ac99395-c018-4b92-8aea-0e322f3bd058", "Abustan Andi Bintang"),     # Wakil Bupati Barru (salah orang)
    ("02389164-c4e5-444f-b237-18a4e3504596", "Darmawangsyah Muin"),       # Wakil Bupati Gowa (salah orang + all-caps)
    ("7dfeb0fd-64e3-43e0-a5a4-1f35454ece1f", "Muhtar"),                   # Wakil Bupati Kepulauan Selayar (all-caps)
    ("2a2a2e9b-d5ce-45f7-85d8-210a26c5c376", "Puspawati Husler"),         # Wakil Bupati Luwu Timur (salah orang - Patahuddin adalah Bupati Luwu)
    ("5cbad939-5fb2-46b1-b80f-84412c2ea311", "Muetazim Mansyur"),         # Wakil Bupati Maros (periode lama)
    ("64ed3d4b-9239-4f26-8713-62757e089f3f", "Sudirman Bungi"),           # Wakil Bupati Pinrang (salah peran - Irwan Hamid adalah Bupati)
    ("04833797-d773-4f76-b1a5-b8aa82ab7b37", "Nurkanaah"),                # Wakil Bupati Sidenreng Rappang (salah eja)
    # Batch 51
    ("d212c2b4-7a7a-4df0-adce-a329b483e9a8", "Selle KS Dalle"),           # Wakil Bupati Soppeng (all-caps)
    ("b5647a3f-00b5-4215-944b-416399e1ba19", "Hengky Yasin"),             # Wakil Bupati Takalar (all-caps)
    ("2ad9591c-fc17-46a5-8839-3c907e6c24e1", "Andrew Branch Silambi"),    # Wakil Bupati Toraja Utara (tidak lengkap)
    ("f9acf29c-13bf-4f21-8e57-59d4dd22029c", "Aliyah Mustika Ilham"),     # Wakil Walikota Makassar (all-caps)
    ("f9374963-30d3-4cf4-822c-67371bac8b47", "Hermanto Pasennang"),       # Wakil Walikota Parepare (salah eja)
    ("9f54cae6-f46c-45a0-bde3-e0e9a336e7a7", "Serfi Kambey"),             # Wakil Bupati Banggai Kepulauan (salah eja)
    ("b5487f67-839b-476a-9614-4074f0e76559", "Ablit H. Ilyas"),           # Wakil Bupati Banggai Laut (tidak lengkap)
    ("22762610-ae7c-4a93-b17f-f3e348daba06", "H. Djira K."),              # Wakil Bupati Morowali Utara (format)
    ("6ab4222b-b756-4798-ae2a-3bca6d124c52", "Soeharto Kandar"),          # Wakil Bupati Poso (salah orang - Verna adalah Bupati)
    ("74f7fc29-f784-43e1-a929-30b5ef2577fb", "Samuel Yansen Pongi"),      # Wakil Bupati Sigi (all-caps)
    ("9c5987ce-b953-4a04-8546-5ec465b3dd3e", "Surya Lapasiri"),           # Wakil Bupati Tojo Una-una (tidak lengkap)
    # Batch 52
    ("01263039-9f14-4e90-ab00-78a8b8ac670a", "Mohammad Besar Bantilan"),  # Wakil Bupati Toli-toli (salah eja Mohamad → Mohammad)
    ("8374af77-59dd-43b8-9fe2-d8247a1de9e0", "Imelda Liliana Muhidin Said"), # Wakil Walikota Palu (tidak lengkap + all-caps)
    ("07ea5754-0cc5-4b76-9b2f-a890eaa1d83c", "Syarifudin Saafa"),         # Wakil Bupati Buton (salah eja Syarifuddin → Syarifudin)
    ("2d1645e2-4044-48d5-b6dc-e30e7b0a052e", "Muhammad Adam Basan"),      # Wakil Bupati Buton Tengah (tidak lengkap)
    ("05dfc5c9-6b00-4156-93b3-27e201d0a418", "Yosep Sahaka"),             # Wakil Bupati Kolaka Timur (all-caps)
    ("7c636dcf-1b2d-49be-b64f-7d5b9e2f063f", "Abuhaera"),                 # Wakil Bupati Konawe Utara (all-caps + format)
    ("60da634d-0be1-4b34-847d-87b7fe7a64a6", "La Ode Asrafil Ndoasa"),    # Wakil Bupati Muna (tidak lengkap)
    ("c86ecaaf-aeb4-4bb6-9363-afb20dda50e6", "Ali Basa"),                 # Wakil Bupati Muna Barat (all-caps)
    ("4113f06d-ef71-45c5-9fbf-b394a49aa1c5", "Wa Ode Hamsinah Bolu"),    # Wakil Walikota Baubau (all-caps)
    # Batch 53
    ("cc1eeb3d-d0fd-4b75-a6e9-447dd3e98d83", "Anisa Gretsya Bambungan"), # Wakil Bupati Kepulauan Talaud (salah eja Anisya → Anisa)
    ("4afe5df3-c06a-46f8-af02-093f26821f98", "Theodorus Kawatu"),         # Wakil Bupati Minahasa Selatan (salah orang - Frede Massie kalah Pilkada)
    ("154b561a-ef38-4e4f-9f9b-adaa603cc511", "Kevin William Lotulung"),   # Wakil Bupati Minahasa Utara (tidak lengkap)
    ("5a365390-5e76-46f0-9b66-b9a885227104", "Heronimus Makainas"),       # Wakil Bupati Siau Tagulandang Biaro (salah eja Heronius → Heronimus)
    ("1fa44e52-b990-41fe-9176-b9c13ef24dd0", "Rendy Virgiawan Mangkat"),  # Wakil Walikota Kotamobagu (tidak lengkap)
    ("dcf51025-b1ff-40a4-9aa2-3a4d8aafc753", "Sendy Gladys Adolfina Rumajar"), # Wakil Walikota Tomohon (all-caps)
    # Batch 54
    ("5f98afff-cd09-4270-9db1-a948c81fe4fe", "Parulian Dalimunthe"),      # Wakil Bupati Pasaman (salah orang - Welly Suhery adalah Bupati; PSU)
    ("c7a84a38-c49e-4a5d-a2ee-3a44cbd850ab", "M. Ihpan"),                  # Wakil Bupati Pasaman Barat (salah orang - "Parulian" adalah Wabup Pasaman bukan Pasaman Barat)
    ("23a7cce6-2f72-4e0a-a055-d7acf54f1570", "Candra"),                    # Wakil Bupati Solok (all-caps + hapus H.)
    ("53194ca3-b97f-4497-8801-8a10f2538bc3", "Suryadi Nurdal"),            # Wakil Walikota Solok (salah orang - Ramadhani naik jadi Walikota)
    ("a3cf24c2-9a79-4828-8d13-f6b4b8fc32a8", "Arifa'i"),                   # Wakil Bupati Empat Lawang (all-caps)
    # Batch 55
    ("23637305-710e-44fc-939b-2f54c694122f", "Sumarni"),                   # Wakil Bupati Muara Enim (all-caps)
    ("a9831471-0be2-4a01-b634-e2318ecad8cc", "Abdur Rohman Husen"),        # Wakil Bupati Musi Banyuasin (tidak lengkap)
    ("6d32581c-5e37-4d08-ae2b-65dd18065f29", "Ardani"),                    # Wakil Bupati Ogan Ilir (all-caps)
    ("032ab219-cc71-4ac4-bc84-1a84e1d29dd2", "Supriyanto"),                # Wakil Bupati OKI (salah orang - Muchendi adalah Bupati)
    ("e5479035-30e6-49ec-b91d-66557c493e9a", "Misnadi"),                   # Wakil Bupati OKU Selatan (all-caps)
    ("fed5815c-bb96-449a-8103-16465fe5b1c1", "Iwan Tuaji"),                # Wakil Bupati PALI (salah spasi)
    ("4dce5703-c6f9-48cb-bc57-62fe1d670db9", "Rustam Effendi"),            # Wakil Walikota Lubuklinggau (all-caps)
    ("3ccc4edd-2c4a-4ae9-b2f2-65eb14941588", "Junita Rebeka Marbun"),      # Wakil Bupati Humbang Hasundutan (salah eja Junika → Junita)
    # Batch 56
    ("f3084949-0cf1-4a43-80c1-7c4310e091e1", "Komando Tarigan"),           # Wakil Bupati Karo (salah orang - Theopilus adalah periode 2021-2025)
    ("44d4a222-13a1-4884-94ff-fd34ec2b8c40", "Atika Azmi Utammi Nasution"), # Wakil Bupati Mandailing Natal (tidak lengkap)
    ("bc46136f-f679-40ab-a501-53c51be20cdd", "Yusman Zega"),               # Wakil Bupati Nias Utara (salah orang - Amizaro adalah Bupati)
    ("8e0f5b20-9d45-4df2-aeb0-00ae1f6c59da", "Basri Harahap"),             # Wakil Bupati Padang Lawas Utara (all-caps)
    ("3e366278-835a-499e-922f-dc1f6f070729", "Deni Parlindungan Lumbantoruan"), # Wakil Bupati Tapanuli Utara (all-caps)
    ("669e1527-93f3-4b38-9422-71222c01d727", "Audi Murphy Sitorus"),       # Wakil Bupati Toba (salah orang - Hulman adalah periode 2016-2021)
    # Batch 57
    ("d79f0434-a2a0-4fab-a892-74610c754c27", "Hasanul Jihadi"),            # Wakil Walikota Binjai (all-caps)
    ("d2361c79-a404-4655-9d1e-50e11e8a7aa0", "Harry Pahlevi Harahap"),     # Wakil Walikota Padangsidimpuan (nama kampanye "Levi Sah" bukan nama resmi)
    ("2942f6d1-3929-4f4d-a77e-24bd11a94b51", "Pantas Maruba Lumbantobing"), # Wakil Walikota Sibolga (all-caps)
    ("bb24b848-dd9c-4e2b-ba55-b13bc3573d50", "Muhammad Fadly Abdina"),     # Wakil Walikota Tanjung Balai (all-caps)
    # Batch 58
    ("c47ed55e-459d-4941-8010-7c956ae5b86b", "Kosong"),                    # Wakil Bupati Ciamis (scraper error; jabatan vakum - calon meninggal sebelum dilantik)
    ("1febab7c-4793-4ebf-95d8-ac12fce486ab", "Iskandar Usman Al-Farlaky"), # Bupati Aceh Timur (all-caps + ejaan)
    ("b7a693f1-17b1-4712-8653-14705dd06f85", "Tagore Abu Bakar"),          # Bupati Bener Meriah (hapus prefiks Ir. H.)
    ("c8e26882-91aa-4cf6-ba14-ff04681aa436", "Teuku Raja Keumangan"),      # Bupati Nagan Raya (singkatan TR. → nama lengkap)
    ("fdd96fbc-e97b-42b5-a0ab-e5da8af02e50", "Mohammad Nasrun Mikaris"),   # Bupati Simeulue (all-caps)
    # Batch 59
    ("35954052-b922-4daa-8015-454d225fbfd5", "Zulkifli H. Adam"),          # Walikota Sabang (all-caps)
    ("25a71ae1-a15d-46a6-a5b3-9ae0687ebbbd", "I Made Agus Mahayastra"),    # Bupati Gianyar (tidak lengkap)
    ("7bfef077-3f34-4202-8896-0bd4dc8aae76", "I Komang Gede Sanjaya"),     # Bupati Tabanan (tidak lengkap)
    ("de7c41e2-c5ed-4e2c-85cf-981df83f72fe", "I Gusti Ngurah Jaya Negara"), # Walikota Denpasar (tidak lengkap)
    ("252ffeba-b6d3-4167-862c-c746fe8a8e18", "Mochamad Hasbi Asyidiki Jayabaya"), # Bupati Lebak (tidak lengkap)
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
